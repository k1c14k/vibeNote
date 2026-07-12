use std::path::Path;
use rusqlite::Connection;
use uuid::Uuid;
use crate::pieces::{Piece, PieceError};

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

/// Ingests a contact piece: serializes payload to vCard, saves it on disk, and registers it in SQLite.
pub fn ingest_contact_piece(
    conn: &mut Connection,
    vibe_path: &Path,
    category_id: &str,
    contact: &ContactJson,
    uri: Option<&str>,
) -> Result<Piece, ContactError> {
    // 1. Resolve category info
    let (folder_path, cat_type): (String, String) = conn.query_row(
        "SELECT folder_path, type FROM categories WHERE id = ?;",
        [category_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => PieceError::CategoryNotFound(category_id.to_string()),
        _ => PieceError::Db(e),
    })?;

    // 2. Validate category type is 'contacts'
    if cat_type != "contacts" {
        return Err(ContactError::Piece(PieceError::InvalidCategoryType(
            category_id.to_string(),
            cat_type,
            "contacts".to_string(),
        )));
    }

    // 3. Verify category directory exists
    let category_dir = vibe_path.join(&folder_path);
    if !category_dir.exists() || !category_dir.is_dir() {
        return Err(ContactError::Piece(PieceError::CategoryFolderMissing(folder_path)));
    }

    // 4. Generate Piece ID and output file path (.vcf)
    let piece_id = Uuid::new_v4().to_string();
    let file_name = format!("{}.vcf", piece_id);
    let piece_file_path = category_dir.join(&file_name);

    // 5. Serialize contact and write to disk
    let vcard_content = serialize_vcard(contact);
    std::fs::write(&piece_file_path, &vcard_content).map_err(PieceError::Io)?;

    // 6. Database updates inside transaction
    let db_result = (|| -> Result<String, rusqlite::Error> {
        let tx = conn.transaction()?;

        // Retrieve current timestamp
        let created_at: String = tx.query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now');",
            [],
            |row| row.get(0),
        )?;

        // Insert piece record
        tx.execute(
            "INSERT INTO pieces (id, category_id, uri, created_at, is_active) VALUES (?, ?, ?, ?, 1);",
            rusqlite::params![&piece_id, category_id, uri, &created_at],
        )?;

        // Extract metadata: Name (FN), Email, Phone, Organization, Title
        tx.execute(
            "INSERT INTO piece_metadata (piece_id, key, value) VALUES (?, 'name', ?);",
            [&piece_id, &contact.formatted_name],
        )?;

        if let Some(ref email) = contact.email {
            tx.execute(
                "INSERT INTO piece_metadata (piece_id, key, value) VALUES (?, 'email', ?);",
                [&piece_id, email],
            )?;
        }

        if let Some(ref phone) = contact.phone {
            tx.execute(
                "INSERT INTO piece_metadata (piece_id, key, value) VALUES (?, 'phone', ?);",
                [&piece_id, phone],
            )?;
        }

        if let Some(ref org) = contact.organization {
            tx.execute(
                "INSERT INTO piece_metadata (piece_id, key, value) VALUES (?, 'organization', ?);",
                [&piece_id, org],
            )?;
        }

        if let Some(ref title) = contact.title {
            tx.execute(
                "INSERT INTO piece_metadata (piece_id, key, value) VALUES (?, 'title', ?);",
                [&piece_id, title],
            )?;
        }

        tx.commit()?;
        Ok(created_at)
    })();

    match db_result {
        Ok(created_at) => Ok(Piece {
            id: piece_id,
            category_id: category_id.to_string(),
            uri: uri.map(String::from),
            created_at,
            is_active: true,
        }),
        Err(err) => {
            // Cleanup disk file on DB insert failure
            let _ = std::fs::remove_file(&piece_file_path);
            Err(ContactError::Piece(PieceError::Db(err)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use crate::categories::create_category;
    use std::fs;
    use std::path::PathBuf;

    struct TestEnv {
        vibe_root: PathBuf,
        conn: Connection,
        category_id: String,
    }

    impl TestEnv {
        fn new(name: &str) -> Self {
            let temp_dir = std::env::temp_dir();
            let vibe_root = temp_dir.join(format!("vibenote_test_contacts_{}_{}", name, Uuid::new_v4().simple()));
            fs::create_dir_all(&vibe_root).unwrap();

            let db_path = vibe_root.join("vibe.db");
            let conn = init_db(&db_path).unwrap();

            let cat = create_category(&conn, &vibe_root, "My Contacts", "contacts", "contacts").unwrap();

            TestEnv { vibe_root, conn, category_id: cat.id }
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
            &env.category_id,
            &contact,
            Some("file:///doc/contact1.json"),
        ).unwrap();

        // 1. Verify returned piece metadata
        assert_eq!(piece.category_id, env.category_id);
        assert_eq!(piece.uri, Some("file:///doc/contact1.json".to_string()));
        assert!(piece.is_active);

        // 2. Verify file content on disk (.vcf)
        let expected_file_path = env.vibe_root.join("contacts").join(format!("{}.vcf", piece.id));
        assert!(expected_file_path.is_file());
        let disk_content = fs::read_to_string(&expected_file_path).unwrap();
        assert!(disk_content.contains("FN:Alice Smith\n"));
        assert!(disk_content.contains("EMAIL;TYPE=INTERNET:alice@example.com\n"));

        // 3. Verify SQLite metadata entries
        let name: String = env.conn.query_row(
            "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'name';",
            [&piece.id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(name, "Alice Smith");

        let email: String = env.conn.query_row(
            "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'email';",
            [&piece.id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(email, "alice@example.com");

        let phone: String = env.conn.query_row(
            "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'phone';",
            [&piece.id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(phone, "+987654321");
    }

    #[test]
    fn test_ingest_contact_invalid_category_type() {
        let mut env = TestEnv::new("invalid_cat");

        // Create a 'text' category
        let text_cat = create_category(&env.conn, &env.vibe_root, "My Notes", "text", "notes").unwrap();

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
        ).unwrap_err();

        assert!(matches!(err, ContactError::Piece(PieceError::InvalidCategoryType(_, _, _))));
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
            &env.category_id,
            &contact,
            None,
        ).unwrap_err();

        assert!(matches!(err, ContactError::Piece(PieceError::Db(_))));

        // Confirms that the created vcf file was deleted
        assert_eq!(fs::read_dir(&contact_dir).unwrap().count(), 0);
    }
}
