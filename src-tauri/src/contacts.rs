use crate::pieces::{Piece, PieceError};
use ort::session::Session;
use rusqlite::Connection;
use std::path::Path;
use usearch::Index;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ContactError {
    #[error("Piece error: {0}")]
    Piece(#[from] PieceError),
    #[error("JSON deserialization error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq, Eq)]
pub struct ContactJson {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub formatted_name: String, // FN is required in vCard
    pub email: Option<String>,
    pub phone: Option<String>,
    pub organization: Option<String>,
    pub title: Option<String>,
}

/// Formats a ContactJson payload into standard vCard 3.0 string.
pub fn serialize_vcard(contact: &ContactJson) -> String {
    let mut vcard = String::new();
    vcard.push_str("BEGIN:VCARD\n");
    vcard.push_str("VERSION:3.0\n");
    vcard.push_str(&format!("FN:{}\n", contact.formatted_name));

    let family = contact.last_name.as_deref().unwrap_or("");
    let given = contact.first_name.as_deref().unwrap_or("");
    vcard.push_str(&format!("N:{};{};;;\n", family, given));

    if let Some(ref email) = contact.email {
        vcard.push_str(&format!("EMAIL;TYPE=INTERNET:{}\n", email));
    }
    if let Some(ref phone) = contact.phone {
        vcard.push_str(&format!("TEL;TYPE=CELL:{}\n", phone));
    }
    if let Some(ref org) = contact.organization {
        vcard.push_str(&format!("ORG:{}\n", org));
    }
    if let Some(ref title) = contact.title {
        vcard.push_str(&format!("TITLE:{}\n", title));
    }
    vcard.push_str("END:VCARD\n");
    vcard
}

/// Converts a ContactJson payload into a natural language description paragraph.
pub fn contact_to_text(contact: &ContactJson) -> String {
    let mut parts = Vec::new();
    parts.push(format!("Contact profile for {}.", contact.formatted_name));
    if let Some(ref email) = contact.email {
        parts.push(format!("Email: {}.", email));
    }
    if let Some(ref phone) = contact.phone {
        parts.push(format!("Phone: {}.", phone));
    }
    if let Some(ref org) = contact.organization {
        parts.push(format!("Organization: {}.", org));
    }
    if let Some(ref title) = contact.title {
        parts.push(format!("Title: {}.", title));
    }
    parts.join(" ")
}

/// Ingests a contact piece: serializes payload to vCard, saves it on disk, and registers it in SQLite.
pub fn ingest_contact_piece(
    conn: &mut Connection,
    vibe_path: &Path,
    collection_id: &str,
    contact: &ContactJson,
    uri: Option<&str>,
    metadata: &[(&str, &str)],
    session: &mut Session,
    index: &Index,
) -> Result<Piece, ContactError> {
    // 0. Validate fail-fast character and precise token limits of the natural language conversion
    let nl_text = contact_to_text(contact);
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

    // 2. Validate collection type is 'contacts'
    if cat_type != "contacts" {
        return Err(ContactError::Piece(PieceError::InvalidCollectionType(
            collection_id.to_string(),
            cat_type,
            "contacts".to_string(),
        )));
    }

    // 3. Verify collection directory exists
    let collection_dir = vibe_path.join(&folder_path);
    if !collection_dir.exists() || !collection_dir.is_dir() {
        return Err(ContactError::Piece(PieceError::CollectionFolderMissing(
            folder_path,
        )));
    }

    // 4. Generate Piece ID and output file path (.vcf)
    let piece_id = Uuid::new_v4().to_string();
    let file_name = format!("{}.vcf", piece_id);
    let piece_file_path = collection_dir.join(&file_name);

    // 5. Serialize contact and write to disk
    let vcard_content = serialize_vcard(contact);
    std::fs::write(&piece_file_path, &vcard_content).map_err(PieceError::Io)?;

    // 6. DB changes + Vector changes inside transaction coordinator
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

    match run_tx_sequence(conn, &mut vector_id_opt).map_err(ContactError::Piece) {
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
                "vibenote_test_contacts_{}_{}",
                name,
                Uuid::new_v4().simple()
            ));
            fs::create_dir_all(&vibe_root).unwrap();

            let db_path = vibe_root.join("vibe.db");
            let conn = init_db(&db_path).unwrap();

            let cat = create_collection(&conn, &vibe_root, "My Contacts", "contacts", "contacts")
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
    fn test_serialize_vcard() {
        let contact = ContactJson {
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            formatted_name: "John Doe".to_string(),
            email: Some("john@example.com".to_string()),
            phone: Some("+123456789".to_string()),
            organization: Some("Acme Corp".to_string()),
            title: Some("Engineer".to_string()),
        };

        let vcard = serialize_vcard(&contact);
        assert!(vcard.starts_with("BEGIN:VCARD\n"));
        assert!(vcard.contains("VERSION:3.0\n"));
        assert!(vcard.contains("FN:John Doe\n"));
        assert!(vcard.contains("N:Doe;John;;;\n"));
        assert!(vcard.contains("EMAIL;TYPE=INTERNET:john@example.com\n"));
        assert!(vcard.contains("TEL;TYPE=CELL:+123456789\n"));
        assert!(vcard.contains("ORG:Acme Corp\n"));
        assert!(vcard.contains("TITLE:Engineer\n"));
        assert!(vcard.ends_with("END:VCARD\n"));
    }

    #[test]
    fn test_ingest_contact_piece_success() {
        let mut env = TestEnv::new("success");
        let contact = ContactJson {
            first_name: Some("Alice".to_string()),
            last_name: Some("Smith".to_string()),
            formatted_name: "Alice Smith".to_string(),
            email: Some("alice@example.com".to_string()),
            phone: Some("+987654321".to_string()),
            organization: Some("Hedgehog Inc".to_string()),
            title: Some("Researcher".to_string()),
        };

        let piece = ingest_contact_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            &contact,
            Some("file:///doc/contact1.json"),
            &[("role", "admin"), ("status", "active")],
            &mut env.session,
            &env.index,
        )
        .unwrap();

        // 1. Verify returned piece metadata
        assert_eq!(piece.collection_id, env.collection_id);
        assert_eq!(piece.uri, Some("file:///doc/contact1.json".to_string()));
        assert!(piece.is_active);

        // 2. Verify file content on disk (.vcf)
        let expected_file_path = env
            .vibe_root
            .join("contacts")
            .join(format!("{}.vcf", piece.id));
        assert!(expected_file_path.is_file());
        let disk_content = fs::read_to_string(&expected_file_path).unwrap();
        assert!(disk_content.contains("FN:Alice Smith\n"));
        assert!(disk_content.contains("EMAIL;TYPE=INTERNET:alice@example.com\n"));

        // 3. Verify SQLite metadata entries (custom only, no auto-extracted)
        let role: String = env
            .conn
            .query_row(
                "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'role';",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(role, "admin");

        let status: String = env
            .conn
            .query_row(
                "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'status';",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "active");

        let has_extracted: bool = env
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM piece_metadata WHERE piece_id = ? AND key = 'name');",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!has_extracted);

        // 4. Verify vector was added to index
        assert!(env.index.size() >= 1);
    }

    #[test]
    fn test_ingest_contact_invalid_collection_type() {
        let mut env = TestEnv::new("invalid_cat");

        // Create a 'text' collection
        let text_cat =
            create_collection(&env.conn, &env.vibe_root, "My Notes", "text", "notes").unwrap();

        let contact = ContactJson {
            first_name: None,
            last_name: None,
            formatted_name: "Generic User".to_string(),
            email: None,
            phone: None,
            organization: None,
            title: None,
        };

        let err = ingest_contact_piece(
            &mut env.conn,
            &env.vibe_root,
            &text_cat.id,
            &contact,
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap_err();

        assert!(matches!(
            err,
            ContactError::Piece(PieceError::InvalidCollectionType(_, _, _))
        ));
    }

    #[test]
    fn test_ingest_contact_rollback_on_db_error() {
        let mut env = TestEnv::new("rollback");

        // We trigger an error by violating unique key constraints in the database using a duplicate category registration or mock insert error.
        // In this case, we'll configure a connection query that manually drops the pieces table before insert, or we can just trigger a DB error
        // by passing duplicate values in metadata? Wait, in `ingest_contact_piece` the metadata keys are hardcoded: 'name', 'email', 'phone', etc.
        // So they are always distinct. How can we trigger a SQLite write error?
        // We can create a table lock or close the connection? Or drop the pieces table during execution?
        // Let's drop the `pieces` table to cause the query to fail!
        env.conn.execute("DROP TABLE pieces;", []).unwrap();

        let contact = ContactJson {
            first_name: Some("Rollback".to_string()),
            last_name: Some("User".to_string()),
            formatted_name: "Rollback User".to_string(),
            email: Some("rollback@example.com".to_string()),
            phone: None,
            organization: None,
            title: None,
        };

        // Ensure folders exist
        let contact_dir = env.vibe_root.join("contacts");
        assert_eq!(fs::read_dir(&contact_dir).unwrap().count(), 0);

        let err = ingest_contact_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            &contact,
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap_err();

        assert!(matches!(err, ContactError::Piece(PieceError::Db(_))));

        // Confirms that the created vcf file was deleted
        assert_eq!(fs::read_dir(&contact_dir).unwrap().count(), 0);
    }

    #[test]
    fn test_contact_to_text() {
        let contact_full = ContactJson {
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            formatted_name: "John Doe".to_string(),
            email: Some("john@example.com".to_string()),
            phone: Some("+123456789".to_string()),
            organization: Some("Acme Corp".to_string()),
            title: Some("Engineer".to_string()),
        };

        let text_full = contact_to_text(&contact_full);
        assert_eq!(
            text_full,
            "Contact profile for John Doe. Email: john@example.com. Phone: +123456789. Organization: Acme Corp. Title: Engineer."
        );

        let contact_min = ContactJson {
            first_name: None,
            last_name: None,
            formatted_name: "Minimal Contact".to_string(),
            email: None,
            phone: None,
            organization: None,
            title: None,
        };

        let text_min = contact_to_text(&contact_min);
        assert_eq!(text_min, "Contact profile for Minimal Contact.");
    }
}
