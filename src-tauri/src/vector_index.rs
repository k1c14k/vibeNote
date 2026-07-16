use rusqlite::{Connection, OptionalExtension};
use std::collections::HashSet;
use std::path::Path;
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
    #[error("ONNX model error: {0}")]
    OnnxModel(String),
}

/// Helper to create a new USearch Index configured for the vibeNote embedding model.
pub fn create_default_index() -> Result<Index, VectorIndexError> {
    let options = IndexOptions {
        dimensions: 384,
        metric: MetricKind::Cos,
        quantization: ScalarKind::F32,
        ..Default::default()
    };

    Index::new(&options).map_err(|e| VectorIndexError::USearch(format!("{:?}", e)))
}

/// Loads an existing index or creates a new one at `<vibe_path>/<index_name>.usearch` with an initial capacity of 500 vectors.
pub fn load_or_create_index(vibe_path: &Path, index_name: &str) -> Result<Index, VectorIndexError> {
    let usearch_path = vibe_path.join(format!("{}.usearch", index_name));
    let index = create_default_index()?;

    if usearch_path.exists() {
        let path_str = usearch_path.to_str().ok_or(VectorIndexError::InvalidPath)?;
        index.load(path_str).map_err(|e| {
            VectorIndexError::USearch(format!("Failed to load index from {}: {:?}", path_str, e))
        })?;
    } else {
        // New index: pre-allocate memory for 500 vectors
        index.reserve(500).map_err(|e| {
            VectorIndexError::USearch(format!("Failed to reserve capacity: {:?}", e))
        })?;
    }

    Ok(index)
}

pub struct VectorIndex(pub Index);

unsafe impl Send for VectorIndex {}
unsafe impl Sync for VectorIndex {}

impl std::ops::Deref for VectorIndex {
    type Target = Index;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

/// Returns the cached index for `index_name`, loading or creating it if not cached.
pub fn get_or_create_index(
    vibe_path: &Path,
    index_name: &str,
    cache: &std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<VectorIndex>>>,
) -> Result<std::sync::Arc<VectorIndex>, VectorIndexError> {
    let mut lock = cache.lock().unwrap();
    if let Some(index) = lock.get(index_name) {
        Ok(index.clone())
    } else {
        let index = load_or_create_index(vibe_path, index_name)?;
        let wrapped = std::sync::Arc::new(VectorIndex(index));
        lock.insert(index_name.to_string(), wrapped.clone());
        Ok(wrapped)
    }
}

/// Saves the index to `<vibe_path>/<index_name>.usearch`.
pub fn save_index(
    index: &Index,
    vibe_path: &Path,
    index_name: &str,
) -> Result<(), VectorIndexError> {
    let usearch_path = vibe_path.join(format!("{}.usearch", index_name));
    let path_str = usearch_path.to_str().ok_or(VectorIndexError::InvalidPath)?;
    index.save(path_str).map_err(|e| {
        VectorIndexError::USearch(format!("Failed to save index to {}: {:?}", path_str, e))
    })?;
    Ok(())
}

/// Adds a vector to the USearch index, dynamically growing capacity by 500 when size reaches capacity.
pub fn add_vector(index: &Index, vector_id: u64, vector: &[f32]) -> Result<(), VectorIndexError> {
    let size = index.size();
    let capacity = index.capacity();
    if size >= capacity {
        index
            .reserve(capacity + 500)
            .map_err(|e| VectorIndexError::USearch(format!("Failed to grow capacity: {:?}", e)))?;
    }
    index
        .add(vector_id, vector)
        .map_err(|e| VectorIndexError::USearch(format!("Failed to add vector: {:?}", e)))?;
    Ok(())
}

/// Maps a string Piece ID (UUID) to a `u64` vector key.
/// If the mapping does not exist, a new auto-incremented mapping is created.
pub fn get_or_create_vector_id(conn: &Connection, piece_id: &str) -> Result<u64, rusqlite::Error> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT vector_id FROM vector_mapping WHERE piece_id = ?;",
            [piece_id],
            |row| row.get(0),
        )
        .optional()?;

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
    )
    .optional()
}

/// The result of a semantic similarity query.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq)]
pub struct QueryResult {
    pub piece_id: String,
    /// Cosine similarity in [0.0, 1.0]. Higher = more similar.
    pub similarity: f32,
}

/// Options to control the behaviour of [`query_pieces`].
pub struct QueryOptions {
    /// If set, restrict results to pieces belonging to this category (collection) ID.
    pub collection_id: Option<String>,
    /// Maximum number of results to return.
    pub top_k: usize,
}

impl Default for QueryOptions {
    fn default() -> Self {
        Self {
            collection_id: None,
            top_k: 10,
        }
    }
}

/// Queries the USearch index for pieces semantically similar to `query_text`.
///
/// * `conn` - SQLite database connection.
/// * `vibe_path` - Root path of the Vibe workspace (used to locate `vibe.usearch`).
/// * `session` - ONNX runtime session for generating query embeddings.
/// * `query_text` - The natural language query string.
/// * `options` - [`QueryOptions`] controlling collection filter and result count.
///
/// Returns a list of [`QueryResult`] sorted by descending similarity (best match first).
/// Tombstoned pieces (`is_active = 0`) are never returned.
pub fn query_pieces(
    conn: &Connection,
    vibe_path: &Path,
    session: &mut ort::session::Session,
    query_text: &str,
    options: QueryOptions,
    index_cache: &std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<VectorIndex>>>,
) -> Result<Vec<QueryResult>, VectorIndexError> {
    // 1. Generate query embedding
    let embedding = crate::model::generate_embedding(session, query_text)
        .map_err(|e| VectorIndexError::OnnxModel(e.to_string()))?;

    // 2. Load index/indexes and search for candidates
    let mut candidates = Vec::new();

    if let Some(ref cid) = options.collection_id {
        // Look up collection's folder path
        let folder_path_opt: Option<String> = conn
            .query_row(
                "SELECT folder_path FROM collections WHERE id = ?;",
                [cid],
                |row| row.get(0),
            )
            .optional()?;

        let folder_path = match folder_path_opt {
            Some(path) => path,
            None => return Ok(vec![]),
        };

        let index = get_or_create_index(vibe_path, &folder_path, index_cache)?;
        let search_results = index
            .search(&embedding, options.top_k)
            .map_err(|e| VectorIndexError::USearch(format!("{:?}", e)))?;
        for (key, dist) in search_results
            .keys
            .iter()
            .zip(search_results.distances.iter())
        {
            if let Some(piece_id) = get_piece_id(conn, *key)? {
                candidates.push((piece_id, *dist));
            }
        }
    } else {
        // Query globally: get all collections
        let mut stmt = conn.prepare("SELECT folder_path FROM collections;")?;
        let folder_paths = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect::<Vec<String>>();

        for folder_path in folder_paths {
            let usearch_path = vibe_path.join(format!("{}.usearch", folder_path));
            if usearch_path.exists() {
                let index = get_or_create_index(vibe_path, &folder_path, index_cache)?;
                let search_results = index
                    .search(&embedding, options.top_k)
                    .map_err(|e| VectorIndexError::USearch(format!("{:?}", e)))?;
                for (key, dist) in search_results
                    .keys
                    .iter()
                    .zip(search_results.distances.iter())
                {
                    if let Some(piece_id) = get_piece_id(conn, *key)? {
                        candidates.push((piece_id, *dist));
                    }
                }
            }
        }

        // Sort all candidates by distance ascending
        candidates.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        candidates.truncate(options.top_k);
    }

    if candidates.is_empty() {
        return Ok(vec![]);
    }

    // 3. SQL filter: active status + optional collection
    let candidate_ids: Vec<&str> = candidates.iter().map(|(id, _)| id.as_str()).collect();

    // Build parameterised IN clause
    let placeholders = candidate_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");

    let mut sql = format!(
        "SELECT p.id FROM pieces p WHERE p.id IN ({}) AND p.is_active = 1",
        placeholders
    );

    if options.collection_id.is_some() {
        sql.push_str(" AND p.collection_id = ?");
    }

    // Collect surviving piece IDs
    let mut stmt = conn.prepare(&sql)?;

    let surviving: HashSet<String> = if let Some(ref cid) = options.collection_id {
        let params: Vec<&dyn rusqlite::types::ToSql> = candidate_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .chain(std::iter::once(cid as &dyn rusqlite::types::ToSql))
            .collect();
        stmt.query_map(params.as_slice(), |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        let params: Vec<&dyn rusqlite::types::ToSql> = candidate_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        stmt.query_map(params.as_slice(), |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect()
    };

    // 4. Re-rank: preserve USearch order, convert distance -> similarity
    let results: Vec<QueryResult> = candidates
        .into_iter()
        .filter(|(piece_id, _)| surviving.contains(piece_id))
        .map(|(piece_id, dist)| QueryResult {
            piece_id,
            similarity: 1.0 - dist,
        })
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collections::create_collection;
    use crate::db::init_db;
    use crate::model::init_model;
    use crate::pieces::ingest_text_piece;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "vibenote_test_vector_index_{}",
                Uuid::new_v4().simple()
            ));
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
    fn test_dynamic_resizing_add_vector() {
        let index = create_default_index().unwrap();
        index.reserve(5).unwrap();
        let initial_capacity = index.capacity();

        let vec = vec![0.0f32; 384];

        for i in 0..initial_capacity {
            add_vector(&index, i as u64, &vec).unwrap();
        }
        assert_eq!(index.size(), initial_capacity);
        assert_eq!(index.capacity(), initial_capacity);

        add_vector(&index, initial_capacity as u64, &vec).unwrap();
        assert_eq!(index.size(), initial_capacity + 1);
        assert!(index.capacity() >= initial_capacity + 500);
    }

    #[test]
    fn test_save_load_and_vector_ops() {
        let dir = TestDir::new();
        let vibe_path = &dir.path;

        // 1. Create and add vector
        let index = load_or_create_index(vibe_path, "vibe").unwrap();
        assert!(index.capacity() >= 500);
        assert_eq!(index.size(), 0);

        let mut vec = vec![0.0f32; 384];
        vec[0] = 1.0f32; // Unit vector on first axis

        index.add(42, &vec).unwrap();
        assert_eq!(index.size(), 1);

        // 2. Save
        save_index(&index, vibe_path, "vibe").unwrap();
        assert!(vibe_path.join("vibe.usearch").exists());

        // 3. Load from disk
        let loaded_index = load_or_create_index(vibe_path, "vibe").unwrap();
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
        // Let's create a collection
        conn.execute(
            "INSERT INTO collections (id, name, type, folder_path) VALUES ('cat-1', 'Notes', 'text', 'notes');",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO pieces (id, collection_id, created_at, is_active) VALUES ('piece-1', 'cat-1', '2026-07-12T17:00:00Z', 1);",
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

    // -------------------------------------------------------------------------
    // Query engine tests
    // -------------------------------------------------------------------------

    struct QueryTestEnv {
        vibe_root: PathBuf,
        conn: Connection,
        session: ort::session::Session,
        index: Index,
        collection_id: String,
    }

    impl QueryTestEnv {
        fn new(name: &str) -> Self {
            let vibe_root = std::env::temp_dir().join(format!(
                "vibenote_query_test_{}_{}",
                name,
                Uuid::new_v4().simple()
            ));
            fs::create_dir_all(&vibe_root).unwrap();

            let db_path = vibe_root.join("vibe.db");
            let conn = init_db(&db_path).unwrap();

            let cat = create_collection(&conn, &vibe_root, "Notes", "text", "notes").unwrap();

            let session = init_model().expect("Failed to init model");
            let index = load_or_create_index(&vibe_root, &cat.folder_path)
                .expect("Failed to load/create index");

            QueryTestEnv {
                vibe_root,
                conn,
                session,
                index,
                collection_id: cat.id,
            }
        }
    }

    impl Drop for QueryTestEnv {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.vibe_root);
        }
    }

    #[test]
    fn test_query_returns_ranked_results() {
        let mut env = QueryTestEnv::new("ranked");

        // Ingest 3 semantically distinct pieces
        ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            "The Eiffel Tower is a famous landmark in Paris, France.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();
        let target = ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            "Rust is a systems programming language focused on safety and performance.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();
        ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            "Chocolate cake is a delicious dessert enjoyed worldwide.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();

        let results = query_pieces(
            &env.conn,
            &env.vibe_root,
            &mut env.session,
            "systems programming language memory safety",
            QueryOptions {
                top_k: 3,
                ..Default::default()
            },
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        )
        .unwrap();

        assert!(!results.is_empty(), "Should return results");
        assert_eq!(
            results[0].piece_id, target.id,
            "Most relevant piece should rank first"
        );
        assert!(
            results[0].similarity > 0.0,
            "Top result should have a positive similarity score"
        );
        // Results must be in descending similarity order
        for w in results.windows(2) {
            assert!(w[0].similarity >= w[1].similarity);
        }
    }

    #[test]
    fn test_query_filters_by_collection() {
        let mut env = QueryTestEnv::new("collection_filter");

        // Create a second collection
        let cat2 = create_collection(
            &env.conn,
            &env.vibe_root,
            "Work Notes",
            "text",
            "work_notes",
        )
        .unwrap();

        let p1 = ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            "Rust programming language overview.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();
        let _p2 = ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &cat2.id,
            "Rust programming language details.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();

        let results = query_pieces(
            &env.conn,
            &env.vibe_root,
            &mut env.session,
            "Rust programming",
            QueryOptions {
                collection_id: Some(env.collection_id.clone()),
                top_k: 10,
                ..Default::default()
            },
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        )
        .unwrap();

        assert!(!results.is_empty());
        for r in &results {
            assert_eq!(
                r.piece_id, p1.id,
                "Only pieces from the filtered collection should be returned"
            );
        }
    }

    #[test]
    fn test_query_excludes_tombstoned() {
        let mut env = QueryTestEnv::new("tombstone");

        let p = ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            "Rust is a great systems language.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();

        // Tombstone the piece
        env.conn
            .execute("UPDATE pieces SET is_active = 0 WHERE id = ?;", [&p.id])
            .unwrap();

        let results = query_pieces(
            &env.conn,
            &env.vibe_root,
            &mut env.session,
            "Rust systems language",
            QueryOptions {
                top_k: 5,
                ..Default::default()
            },
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        )
        .unwrap();

        assert!(
            results.iter().all(|r| r.piece_id != p.id),
            "Tombstoned piece must not appear in query results"
        );
    }

    #[test]
    fn test_query_empty_index() {
        let mut env = QueryTestEnv::new("empty");

        let results = query_pieces(
            &env.conn,
            &env.vibe_root,
            &mut env.session,
            "anything",
            QueryOptions::default(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        )
        .unwrap();

        assert!(results.is_empty(), "Empty index should return no results");
    }

    #[test]
    fn test_query_no_collection_returns_all() {
        let mut env = QueryTestEnv::new("all_collections");

        let cat2 = create_collection(
            &env.conn,
            &env.vibe_root,
            "Work Notes",
            "text",
            "work_notes",
        )
        .unwrap();

        let p1 = ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &env.collection_id,
            "Rust programming language overview.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();
        let p2 = ingest_text_piece(
            &mut env.conn,
            &env.vibe_root,
            &cat2.id,
            "Rust memory safety and concurrency.",
            None,
            &[],
            &mut env.session,
            &env.index,
        )
        .unwrap();

        let results = query_pieces(
            &env.conn,
            &env.vibe_root,
            &mut env.session,
            "Rust programming",
            QueryOptions {
                top_k: 10,
                ..Default::default()
            },
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        )
        .unwrap();

        let ids: Vec<&str> = results.iter().map(|r| r.piece_id.as_str()).collect();
        assert!(
            ids.contains(&p1.id.as_str()),
            "Result should include piece from collection 1"
        );
        assert!(
            ids.contains(&p2.id.as_str()),
            "Result should include piece from collection 2"
        );
    }
}
