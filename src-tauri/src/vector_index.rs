use std::path::Path;
use rusqlite::{Connection, OptionalExtension};
use usearch::{Index, IndexOptions, MetricKind, ScalarKind};

#[derive(Debug, thiserror::Error)]
pub enum VectorIndexError {
    #[error("USearch error: {0}")]
    USearch(String),
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid path: path contains invalid UTF-8 characters")]
    InvalidPath,
}

/// Helper to create a new USearch Index configured for the vibeNote embedding model.
pub fn create_default_index() -> Result<Index, VectorIndexError> {
    let mut options = IndexOptions::default();
    options.dimensions = 384;
    options.metric = MetricKind::Cos;
    options.quantization = ScalarKind::F32;

    Index::new(&options).map_err(|e| VectorIndexError::USearch(format!("{:?}", e)))
}

/// Loads an existing index or creates a new one at `<vibe_path>/vibe.usearch` with a capacity of 100,000 vectors.
pub fn load_or_create_index(vibe_path: &Path) -> Result<Index, VectorIndexError> {
    let usearch_path = vibe_path.join("vibe.usearch");
    let index = create_default_index()?;

    if usearch_path.exists() {
        let path_str = usearch_path.to_str().ok_or(VectorIndexError::InvalidPath)?;
        index.load(path_str).map_err(|e| VectorIndexError::USearch(format!("Failed to load index from {}: {:?}", path_str, e)))?;
    } else {
        // New index: pre-allocate memory for 100,000 vectors
        index.reserve(100_000).map_err(|e| VectorIndexError::USearch(format!("Failed to reserve capacity: {:?}", e)))?;
    }

    Ok(index)
}

/// Saves the index to `<vibe_path>/vibe.usearch`.
pub fn save_index(index: &Index, vibe_path: &Path) -> Result<(), VectorIndexError> {
    let usearch_path = vibe_path.join("vibe.usearch");
    let path_str = usearch_path.to_str().ok_or(VectorIndexError::InvalidPath)?;
    index.save(path_str).map_err(|e| VectorIndexError::USearch(format!("Failed to save index to {}: {:?}", path_str, e)))?;
    Ok(())
}

/// Maps a string Piece ID (UUID) to a `u64` vector key.
/// If the mapping does not exist, a new auto-incremented mapping is created.
pub fn get_or_create_vector_id(conn: &Connection, piece_id: &str) -> Result<u64, rusqlite::Error> {
    let existing: Option<i64> = conn.query_row(
        "SELECT vector_id FROM vector_mapping WHERE piece_id = ?;",
        [piece_id],
        |row| row.get(0),
    ).optional()?;

    if let Some(vid) = existing {
        Ok(vid as u64)
    } else {
        conn.execute(
            "INSERT INTO vector_mapping (piece_id) VALUES (?);",
            [piece_id],
        )?;
        let last_id = conn.last_insert_rowid();
        Ok(last_id as u64)
    }
}

/// Maps a `u64` vector key back to its string Piece ID (UUID).
pub fn get_piece_id(conn: &Connection, vector_id: u64) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT piece_id FROM vector_mapping WHERE vector_id = ?;",
        [vector_id as i64],
        |row| row.get(0),
    ).optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use uuid::Uuid;
    use std::path::PathBuf;
    use std::fs;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("vibenote_test_vector_index_{}", Uuid::new_v4().simple()));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn test_index_creation_and_reservation() {
        let index = create_default_index().unwrap();
        assert_eq!(index.dimensions(), 384);
        
        index.reserve(10_000).unwrap();
        assert!(index.capacity() >= 10_000);
    }

    #[test]
    fn test_save_load_and_vector_ops() {
        let dir = TestDir::new();
        let vibe_path = &dir.path;
        
        // 1. Create and add vector
        let index = load_or_create_index(vibe_path).unwrap();
        assert!(index.capacity() >= 100_000);
        assert_eq!(index.size(), 0);

        let mut vec = vec![0.0f32; 384];
        vec[0] = 1.0f32; // Unit vector on first axis
        
        index.add(42, &vec).unwrap();
        assert_eq!(index.size(), 1);

        // 2. Save
        save_index(&index, vibe_path).unwrap();
        assert!(vibe_path.join("vibe.usearch").exists());

        // 3. Load from disk
        let loaded_index = load_or_create_index(vibe_path).unwrap();
        assert_eq!(loaded_index.size(), 1);

        // 4. Search check
        let search_results = loaded_index.search(&vec, 1).unwrap();
        assert_eq!(search_results.keys.len(), 1);
        assert_eq!(search_results.keys[0], 42);

        // 5. Remove vector
        loaded_index.remove(42).unwrap();
        assert_eq!(loaded_index.size(), 0);
    }

    #[test]
    fn test_sqlite_mappings() {
        let dir = TestDir::new();
        let db_path = dir.path.join("vibe.db");
        let conn = init_db(&db_path).unwrap();

        // Register a fake piece in pieces first due to foreign key constraints
        // Let's create a category
        conn.execute(
            "INSERT INTO categories (id, name, type, folder_path) VALUES ('cat-1', 'Notes', 'text', 'notes');",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO pieces (id, category_id, created_at, is_active) VALUES ('piece-1', 'cat-1', '2026-07-12T17:00:00Z', 1);",
            [],
        ).unwrap();

        // Verify mapping operations
        let v1 = get_or_create_vector_id(&conn, "piece-1").unwrap();
        let v2 = get_or_create_vector_id(&conn, "piece-1").unwrap();
        assert_eq!(v1, v2);

        let p1 = get_piece_id(&conn, v1).unwrap();
        assert_eq!(p1, Some("piece-1".to_string()));

        let p_none = get_piece_id(&conn, 9999).unwrap();
        assert!(p_none.is_none());
    }
}
