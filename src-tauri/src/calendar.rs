use crate::pieces::{Piece, PieceError};
use ort::session::Session;
use rusqlite::Connection;
use std::path::Path;
use usearch::Index;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CalendarError {
    #[error("Piece error: {0}")]
    Piece(#[from] PieceError),
    #[error("JSON deserialization error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq, Eq)]
pub struct CalendarJson {
    pub summary: String,    // Event Title
    pub start_date: String, // ISO-8601 string
    pub end_date: String,   // ISO-8601 string
    pub description: Option<String>,
    pub location: Option<String>,
}

/// Formats a CalendarJson payload into standard iCal/ICS v2.0 format.
pub fn serialize_ical(event: &CalendarJson, piece_id: &str, dtstamp: &str) -> String {
    let mut ics = String::new();
    ics.push_str("BEGIN:VCALENDAR\n");
    ics.push_str("VERSION:2.0\n");
    ics.push_str("PRODID:-//vibeNote//Calendar Ingest//EN\n");
    ics.push_str("BEGIN:VEVENT\n");
    ics.push_str(&format!("UID:{}\n", piece_id));

    let format_date = |d: &str| d.replace("-", "").replace(":", "");

    ics.push_str(&format!("DTSTAMP:{}\n", format_date(dtstamp)));
    ics.push_str(&format!("DTSTART:{}\n", format_date(&event.start_date)));
    ics.push_str(&format!("DTEND:{}\n", format_date(&event.end_date)));
    ics.push_str(&format!("SUMMARY:{}\n", event.summary));

    if let Some(ref desc) = event.description {
        ics.push_str(&format!("DESCRIPTION:{}\n", desc));
    }
    if let Some(ref loc) = event.location {
        ics.push_str(&format!("LOCATION:{}\n", loc));
    }
    ics.push_str("END:VEVENT\n");
    ics.push_str("END:VCALENDAR\n");
    ics
}

/// Converts a CalendarJson payload into a natural language description paragraph.
pub fn calendar_to_text(event: &CalendarJson) -> String {
    let mut parts = Vec::new();
    parts.push(format!("Calendar event: {}.", event.summary));
    parts.push(format!("Start time: {}.", event.start_date));
    parts.push(format!("End time: {}.", event.end_date));
    if let Some(ref desc) = event.description {
        parts.push(format!("Description: {}.", desc));
    }
    if let Some(ref loc) = event.location {
        parts.push(format!("Location: {}.", loc));
    }
    parts.join(" ")
}

/// Ingests a calendar piece: serializes payload to ICS, saves it on disk, and registers it in SQLite.
pub fn ingest_calendar_piece(
    conn: &mut Connection,
    vibe_path: &Path,
    collection_id: &str,
    event: &CalendarJson,
    uri: Option<&str>,
    metadata: &[(&str, &str)],
    session: &mut Session,
    index: &Index,
) -> Result<Piece, CalendarError> {
    // 0. Validate fail-fast character and precise token limits of the natural language conversion
    let nl_text = calendar_to_text(event);
    crate::model::validate_limits(&nl_text, None, None)?;

    // 1. Resolve collection info
    let (folder_path, cat_type): (String, String) = conn
        .query_row(
            "SELECT folder_path, type FROM collections WHERE id = ?;",
            [collection_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                PieceError::CollectionNotFound(collection_id.to_string())
            }
            _ => PieceError::Db(e),
        })?;

    // 2. Validate collection type is 'calendar'
    if cat_type != "calendar" {
        return Err(CalendarError::Piece(PieceError::InvalidCollectionType(
            collection_id.to_string(),
            cat_type,
            "calendar".to_string(),
        )));
    }

    // 3. Verify collection directory exists
    let collection_dir = vibe_path.join(&folder_path);
    if !collection_dir.exists() || !collection_dir.is_dir() {
        return Err(CalendarError::Piece(PieceError::CollectionFolderMissing(
            folder_path,
        )));
    }

    // 4. Generate Piece ID and output file path (.ics)
    let piece_id = Uuid::new_v4().to_string();
    let file_name = format!("{}.ics", piece_id);
    let piece_file_path = collection_dir.join(&file_name);

    // 5. DB changes + Vector changes inside transaction coordinator
    let mut vector_id_opt = None;
    let mut run_tx_sequence = |conn: &mut Connection,
                               vector_id_opt: &mut Option<u64>|
     -> Result<String, PieceError> {
        let tx = conn.transaction()?;

        // Retrieve current timestamp
        let created_at: String =
            tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now');", [], |row| {
                row.get(0)
            })?;

        // Serialize calendar and write to disk (timestamp is needed for DTSTAMP)
        let ics_content = serialize_ical(event, &piece_id, &created_at);
        std::fs::write(&piece_file_path, &ics_content).map_err(PieceError::Io)?;

        // Insert piece record
        tx.execute(
            "INSERT INTO pieces (id, collection_id, uri, created_at, is_active) VALUES (?, ?, ?, ?, 1);",
            rusqlite::params![&piece_id, collection_id, uri, &created_at],
        )?;

        // Write custom metadata key-value pairs using INSERT OR REPLACE
        for &(key, val) in metadata {
            tx.execute(
                "INSERT OR REPLACE INTO piece_metadata (piece_id, key, value) VALUES (?, ?, ?);",
                [&piece_id, key, val],
            )?;
        }

        // Get/create vector ID mapping
        let vector_id = crate::vector_index::get_or_create_vector_id(&tx, &piece_id)?;
        *vector_id_opt = Some(vector_id);

        // Generate embedding from natural language text representation
        let embedding =
            crate::model::generate_embedding(session, &nl_text).map_err(PieceError::Onnx)?;

        // Add to memory index
        crate::vector_index::add_vector(index, vector_id, &embedding)?;

        tx.commit()?;
        Ok(created_at)
    };

    match run_tx_sequence(conn, &mut vector_id_opt).map_err(CalendarError::Piece) {
        Ok(created_at) => {
            if let Err(e) = crate::vector_index::save_index(index, vibe_path, &folder_path) {
                eprintln!(
                    "Warning: Failed to save USearch index to disk after SQLite commit: {:?}",
                    e
                );
            }
            Ok(Piece {
                id: piece_id,
                collection_id: collection_id.to_string(),
                uri: uri.map(String::from),
                created_at,
                is_active: true,
            })
        }
        Err(err) => {
            // Cleanup disk file on failure
            let _ = std::fs::remove_file(&piece_file_path);

            // Revert memory index
            let usearch_path = vibe_path.join(format!("{}.usearch", folder_path));
            if usearch_path.exists() {
                if let Some(path_str) = usearch_path.to_str() {
                    let _ = index.load(path_str);
                }
            } else if let Some(vid) = vector_id_opt {
                let _ = index.remove(vid);
            }

            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collections::create_collection;
    use crate::db::init_db;
    use std::fs;
    use std::path::PathBuf;

    struct TestEnv {
        vibe_root: PathBuf,
        conn: Connection,
        collection_id: String,
        session: ort::session::Session,
        index: usearch::Index,
    }

    impl TestEnv {
        fn new(name: &str) -> Self {
            let temp_dir = std::env::temp_dir();
            let vibe_root = temp_dir.join(format!(
                "vibenote_test_calendar_{}_{}",
                name,
                Uuid::new_v4().simple()
            ));
            fs::create_dir_all(&vibe_root).unwrap();

            let db_path = vibe_root.join("vibe.db");
            let conn = init_db(&db_path).unwrap();

            let cat = create_collection(&conn, &vibe_root, "My Calendar", "calendar", "calendar")
                .unwrap();

            let session = crate::model::init_model().expect("Failed to init model in TestEnv");
            let index = crate::vector_index::load_or_create_index(&vibe_root, &cat.folder_path)
                .expect("Failed to load/create vector index in TestEnv");

            TestEnv {
                vibe_root,
                conn,
                collection_id: cat.id,
                session,
                index,
            }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.vibe_root);
        }
    }

    #[test]
    fn test_serialize_ical() {
        let event = CalendarJson {
            summary: "Launch Party".to_string(),
            start_date: "2026-07-12T18:00:00Z".to_string(),
            end_date: "2026-07-12T22:00:00Z".to_string(),
            description: Some("Celebrate vibeNote MVP launch".to_string()),
            location: Some("Tauri HQ".to_string()),
        };

        let ics = serialize_ical(&event, "event-123", "2026-07-12T17:00:00Z");
        assert!(ics.starts_with("BEGIN:VCALENDAR\n"));
        assert!(ics.contains("VERSION:2.0\n"));
        assert!(ics.contains("UID:event-123\n"));
        assert!(ics.contains("DTSTAMP:20260712T170000Z\n"));
        assert!(ics.contains("DTSTART:20260712T180000Z\n"));
        assert!(ics.contains("DTEND:20260712T220000Z\n"));
        assert!(ics.contains("SUMMARY:Launch Party\n"));
        assert!(ics.contains("DESCRIPTION:Celebrate vibeNote MVP launch\n"));
        assert!(ics.contains("LOCATION:Tauri HQ\n"));
        assert!(ics.ends_with("END:VCALENDAR\n"));
    }

    #[test]
    fn test_ingest_calendar_piece_success() {
        let mut env = TestEnv::new("success");
        let event = CalendarJson {
            summary: "Strategy Meeting".to_string(),
            start_date: "2026-07-13T09:00:00Z".to_string(),
            end_date: "2026-07-13T10:00:00Z".to_string(),
            description: Some("Discuss Epics 4 and 5".to_string()),
            location: Some("Online".to_string()),
        };

        let piece = ingest_calendar_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            &event,
            Some("file:///doc/cal1.json"),
            &[("priority", "high"), ("category", "work")],
            &mut env.session,
            &env.index,
        )
        .unwrap();

        // 1. Verify returned piece metadata
        assert_eq!(piece.collection_id, env.collection_id);
        assert_eq!(piece.uri, Some("file:///doc/cal1.json".to_string()));
        assert!(piece.is_active);

        // 2. Verify file content on disk (.ics)
        let expected_file_path = env
            .vibe_root
            .join("calendar")
            .join(format!("{}.ics", piece.id));
        assert!(expected_file_path.is_file());
        let disk_content = fs::read_to_string(&expected_file_path).unwrap();
        assert!(disk_content.contains("SUMMARY:Strategy Meeting\n"));
        assert!(disk_content.contains("DTSTART:20260713T090000Z\n"));

        // 3. Verify SQLite metadata entries (custom only, no auto-extracted)
        let priority: String = env
            .conn
            .query_row(
                "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'priority';",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(priority, "high");

        let category: String = env
            .conn
            .query_row(
                "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'category';",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(category, "work");

        let has_extracted: bool = env
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM piece_metadata WHERE piece_id = ? AND key = 'title');",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!has_extracted);

        // 4. Verify vector was added to index
        assert!(env.index.size() >= 1);
    }

    #[test]
    fn test_ingest_calendar_invalid_collection_type() {
        let mut env = TestEnv::new("invalid_cat");

        // Create a 'contacts' collection
        let contact_cat = create_collection(
            &env.conn,
            &env.vibe_root,
            "My Contacts",
            "contacts",
            "contacts",
        )
        .unwrap();

        let event = CalendarJson {
            summary: "Generic Event".to_string(),
            start_date: "2026-07-12T18:00:00Z".to_string(),
            end_date: "2026-07-12T19:00:00Z".to_string(),
            description: None,
            location: None,
        };

        let err = ingest_calendar_piece(
            &mut env.conn,
            &env.vibe_root,
            &contact_cat.id,
            &event,
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap_err();

        assert!(matches!(
            err,
            CalendarError::Piece(PieceError::InvalidCollectionType(_, _, _))
        ));
    }

    #[test]
    fn test_ingest_calendar_rollback_on_db_error() {
        let mut env = TestEnv::new("rollback");

        // Drop the pieces table to trigger insert error
        env.conn.execute("DROP TABLE pieces;", []).unwrap();

        let event = CalendarJson {
            summary: "Rollback Event".to_string(),
            start_date: "2026-07-12T18:00:00Z".to_string(),
            end_date: "2026-07-12T19:00:00Z".to_string(),
            description: None,
            location: None,
        };

        let calendar_dir = env.vibe_root.join("calendar");
        assert_eq!(fs::read_dir(&calendar_dir).unwrap().count(), 0);

        let err = ingest_calendar_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            &event,
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap_err();

        assert!(matches!(err, CalendarError::Piece(PieceError::Db(_))));

        // Confirms that the created ics file was deleted
        assert_eq!(fs::read_dir(&calendar_dir).unwrap().count(), 0);
    }

    #[test]
    fn test_calendar_to_text() {
        let event_full = CalendarJson {
            summary: "Project Launch".to_string(),
            start_date: "2026-07-12T18:00:00Z".to_string(),
            end_date: "2026-07-12T20:00:00Z".to_string(),
            description: Some("Launch party for vibeNote MVP".to_string()),
            location: Some("Tauri HQ".to_string()),
        };

        let text_full = calendar_to_text(&event_full);
        assert_eq!(
            text_full,
            "Calendar event: Project Launch. Start time: 2026-07-12T18:00:00Z. End time: 2026-07-12T20:00:00Z. Description: Launch party for vibeNote MVP. Location: Tauri HQ."
        );

        let event_min = CalendarJson {
            summary: "Minimal Event".to_string(),
            start_date: "2026-07-12T18:00:00Z".to_string(),
            end_date: "2026-07-12T19:00:00Z".to_string(),
            description: None,
            location: None,
        };

        let text_min = calendar_to_text(&event_min);
        assert_eq!(
            text_min,
            "Calendar event: Minimal Event. Start time: 2026-07-12T18:00:00Z. End time: 2026-07-12T19:00:00Z."
        );
    }
}
