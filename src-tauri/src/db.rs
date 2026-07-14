use rusqlite::{Connection, Result};
use std::path::Path;

const MIGRATIONS: &[&str] = &[
    // Version 1: Base schemas
    r#"
    PRAGMA foreign_keys = ON;

    CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text', 'contacts', 'calendar')),
        folder_path TEXT NOT NULL
    );

    CREATE TABLE pieces (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL,
        uri TEXT,
        created_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE piece_metadata (
        piece_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (piece_id, key),
        FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    );

    CREATE TABLE piece_history (
        parent_piece_id TEXT NOT NULL,
        child_piece_id TEXT NOT NULL,
        change_type TEXT NOT NULL CHECK(change_type IN ('replacement', 'extension')),
        timestamp TEXT NOT NULL,
        PRIMARY KEY (parent_piece_id, child_piece_id),
        FOREIGN KEY (parent_piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
        FOREIGN KEY (child_piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    );

    CREATE TABLE relations (
        source_piece_id TEXT NOT NULL,
        target_piece_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (source_piece_id, target_piece_id, relation_type),
        FOREIGN KEY (source_piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
        FOREIGN KEY (target_piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_pieces_category_id ON pieces(category_id);
    CREATE INDEX idx_pieces_is_active ON pieces(is_active);
    CREATE INDEX idx_piece_metadata_key ON piece_metadata(key);
    CREATE INDEX idx_piece_history_parent ON piece_history(parent_piece_id);
    CREATE INDEX idx_piece_history_child ON piece_history(child_piece_id);
    CREATE INDEX idx_relations_source ON relations(source_piece_id);
    CREATE INDEX idx_relations_target ON relations(target_piece_id);
    "#,
    // Version 2: Vector mapping schema
    r#"
    CREATE TABLE vector_mapping (
        vector_id INTEGER PRIMARY KEY AUTOINCREMENT,
        piece_id TEXT NOT NULL UNIQUE,
        FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_vector_mapping_piece_id ON vector_mapping(piece_id);
    "#,
    // Version 3: Rename categories to collections and category_id to collection_id
    r#"
    PRAGMA foreign_keys = OFF;
    ALTER TABLE categories RENAME TO collections;
    ALTER TABLE pieces RENAME COLUMN category_id TO collection_id;
    DROP INDEX IF EXISTS idx_pieces_category_id;
    CREATE INDEX idx_pieces_collection_id ON pieces(collection_id);
    PRAGMA foreign_keys = ON;
    "#,
];

/// Initializes the SQLite connection and runs migration scripts.
pub fn init_db<P: AsRef<Path>>(db_path: P) -> Result<Connection> {
    let mut conn = Connection::open(db_path)?;
    conn.execute("PRAGMA foreign_keys = ON;", [])?;
    run_migrations(&mut conn)?;
    Ok(conn)
}

/// A lightweight migration runner utilizing SQLite's user_version PRAGMA.
fn run_migrations(conn: &mut Connection) -> Result<()> {
    let current_version: i32 = conn.query_row("PRAGMA user_version;", [], |row| row.get(0))?;
    let target_version = MIGRATIONS.len() as i32;

    if current_version < target_version {
        for (version, migration) in MIGRATIONS.iter().enumerate().skip(current_version as usize) {
            let tx = conn.transaction()?;
            // Execute the migration SQL
            tx.execute_batch(migration)?;
            // Update user_version
            tx.execute(&format!("PRAGMA user_version = {};", version + 1), [])?;
            tx.commit()?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    #[test]
    fn test_init_db_in_memory() {
        let conn = init_db(":memory:").expect("Failed to initialize database");
        let version: i32 = conn
            .query_row("PRAGMA user_version;", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i32);
    }

    #[test]
    fn test_multiple_initializations() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("vibenote_test_migrations.db");
        if db_path.exists() {
            let _ = std::fs::remove_file(&db_path);
        }

        {
            let conn = init_db(&db_path).expect("First init failed");
            let version: i32 = conn
                .query_row("PRAGMA user_version;", [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, MIGRATIONS.len() as i32);
        }

        {
            let conn = init_db(&db_path).expect("Second init failed");
            let version: i32 = conn
                .query_row("PRAGMA user_version;", [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, MIGRATIONS.len() as i32);
        }

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_foreign_keys_and_constraints() {
        let conn = init_db(":memory:").unwrap();

        // Inserting collection should succeed
        conn.execute(
            "INSERT INTO collections (id, name, type, folder_path) VALUES (?, ?, ?, ?);",
            ["cat-1", "My Notes", "text", "/path/to/notes"],
        )
        .unwrap();

        // Inserting invalid collection type should fail check constraint
        let bad_cat = conn.execute(
            "INSERT INTO collections (id, name, type, folder_path) VALUES (?, ?, ?, ?);",
            ["cat-2", "Bad Notes", "invalid_type", "/path/to/notes"],
        );
        assert!(bad_cat.is_err());

        // Inserting piece with existing collection_id should succeed
        conn.execute(
            "INSERT INTO pieces (id, collection_id, uri, created_at, is_active) VALUES (?, ?, ?, ?, ?);",
            params!["piece-1", "cat-1", "/path/to/notes/1.md", "2026-07-12T17:00:00Z", 1],
        )
        .unwrap();

        // Inserting piece with non-existent collection_id should fail foreign key constraint
        let bad_piece = conn.execute(
            "INSERT INTO pieces (id, collection_id, uri, created_at, is_active) VALUES (?, ?, ?, ?, ?);",
            params!["piece-2", "non-existent-cat", "/path/to/notes/2.md", "2026-07-12T17:00:00Z", 1],
        );
        assert!(bad_piece.is_err());

        // Inserting piece_metadata should succeed
        conn.execute(
            "INSERT INTO piece_metadata (piece_id, key, value) VALUES (?, ?, ?);",
            ["piece-1", "token_count", "450"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO piece_metadata (piece_id, key, value) VALUES (?, ?, ?);",
            ["piece-1", "content_hash", "abc123hash"],
        )
        .unwrap();

        // Verify cascading delete: deleting collection deletes pieces and piece_metadata
        conn.execute("DELETE FROM collections WHERE id = ?;", ["cat-1"])
            .unwrap();

        let piece_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pieces WHERE id = ?;",
                ["piece-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(piece_count, 0);

        let metadata_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM piece_metadata WHERE piece_id = ?;",
                ["piece-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(metadata_count, 0);
    }
}
