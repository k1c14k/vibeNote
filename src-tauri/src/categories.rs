use std::path::{Path, PathBuf};
use rusqlite::Connection;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CategoryError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid category type: {0}. Must be 'text', 'contacts', or 'calendar'")]
    InvalidType(String),
    #[error("Category nesting is not allowed. Folder name '{0}' must be a single flat directory")]
    NestedCategory(String),
    #[error("Category folder name cannot be empty")]
    EmptyFolderName,
    #[error("Category name '{0}' is already registered")]
    NameAlreadyExists(String),
    #[error("Category folder '{0}' is already registered in database")]
    FolderAlreadyRegistered(String),
    #[error("A file already exists at category path: {0}")]
    FileExistsAtPath(PathBuf),
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq, Eq)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub folder_path: String,
}

/// Creates a flat directory category and registers it in the SQLite database.
///
/// * `conn` - SQLite connection.
/// * `vibe_path` - The root directory of the Vibe workspace.
/// * `name` - The user-friendly name of the category.
/// * `category_type` - The category type, constrained to 'text', 'contacts', or 'calendar'.
/// * `folder_name` - The name of the category subdirectory (must not contain path separators).
pub fn create_category(
    conn: &Connection,
    vibe_path: &Path,
    name: &str,
    category_type: &str,
    folder_name: &str,
) -> Result<Category, CategoryError> {
    // 1. Validate category type
    match category_type {
        "text" | "contacts" | "calendar" => {}
        _ => return Err(CategoryError::InvalidType(category_type.to_string())),
    }

    // 2. Validate folder name (prevent nesting)
    if folder_name.is_empty() {
        return Err(CategoryError::EmptyFolderName);
    }
    if folder_name.contains('/') || folder_name.contains('\\') || folder_name == "." || folder_name == ".." {
        return Err(CategoryError::NestedCategory(folder_name.to_string()));
    }

    // 3. Database uniqueness checks
    let name_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM categories WHERE name = ?);",
        [name],
        |row| row.get(0),
    )?;
    if name_exists {
        return Err(CategoryError::NameAlreadyExists(name.to_string()));
    }

    let folder_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM categories WHERE folder_path = ?);",
        [folder_name],
        |row| row.get(0),
    )?;
    if folder_exists {
        return Err(CategoryError::FolderAlreadyRegistered(folder_name.to_string()));
    }

    // 4. Physical folder checks & creation
    let category_dir = vibe_path.join(folder_name);
    if category_dir.exists() {
        if category_dir.is_file() {
            return Err(CategoryError::FileExistsAtPath(category_dir));
        }
    } else {
        std::fs::create_dir(&category_dir)?;
    }

    // 5. Database registration
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO categories (id, name, type, folder_path) VALUES (?, ?, ?, ?);",
        [&id, name, category_type, folder_name],
    )?;

    Ok(Category {
        id,
        name: name.to_string(),
        r#type: category_type.to_string(),
        folder_path: folder_name.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use std::fs;

    struct TestEnv {
        vibe_root: PathBuf,
        conn: Connection,
    }

    impl TestEnv {
        fn new(name: &str) -> Self {
            let temp_dir = std::env::temp_dir();
            let vibe_root = temp_dir.join(format!("vibenote_test_vibe_{}_{}", name, Uuid::new_v4().simple()));
            fs::create_dir_all(&vibe_root).unwrap();

            let db_path = vibe_root.join("vibe.db");
            let conn = init_db(&db_path).unwrap();

            TestEnv { vibe_root, conn }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.vibe_root);
        }
    }

    #[test]
    fn test_create_categories_success() {
        let env = TestEnv::new("success");

        // Create Text Category
        let cat_text = create_category(&env.conn, &env.vibe_root, "My Notes", "text", "notes").unwrap();
        assert_eq!(cat_text.name, "My Notes");
        assert_eq!(cat_text.r#type, "text");
        assert_eq!(cat_text.folder_path, "notes");
        assert!(env.vibe_root.join("notes").is_dir());

        // Create Contacts Category
        let cat_contacts = create_category(&env.conn, &env.vibe_root, "Work Contacts", "contacts", "contacts_work").unwrap();
        assert_eq!(cat_contacts.name, "Work Contacts");
        assert_eq!(cat_contacts.r#type, "contacts");
        assert_eq!(cat_contacts.folder_path, "contacts_work");
        assert!(env.vibe_root.join("contacts_work").is_dir());

        // Create Calendar Category
        let cat_calendar = create_category(&env.conn, &env.vibe_root, "Shared Schedule", "calendar", "calendar_shared").unwrap();
        assert_eq!(cat_calendar.name, "Shared Schedule");
        assert_eq!(cat_calendar.r#type, "calendar");
        assert_eq!(cat_calendar.folder_path, "calendar_shared");
        assert!(env.vibe_root.join("calendar_shared").is_dir());
    }

    #[test]
    fn test_prevent_nested_category() {
        let env = TestEnv::new("nested");

        // Try nested path folder_name "notes/nested"
        let err_slash = create_category(&env.conn, &env.vibe_root, "Nested Note", "text", "notes/nested").unwrap_err();
        assert!(matches!(err_slash, CategoryError::NestedCategory(_)));

        // Try parent traversal ".."
        let err_parent = create_category(&env.conn, &env.vibe_root, "Parent Note", "text", "..").unwrap_err();
        assert!(matches!(err_parent, CategoryError::NestedCategory(_)));

        // Try backslash
        let err_backslash = create_category(&env.conn, &env.vibe_root, "Backslash Note", "text", "notes\\nested").unwrap_err();
        assert!(matches!(err_backslash, CategoryError::NestedCategory(_)));

        // Try empty folder name
        let err_empty = create_category(&env.conn, &env.vibe_root, "Empty Note", "text", "").unwrap_err();
        assert!(matches!(err_empty, CategoryError::EmptyFolderName));
    }

    #[test]
    fn test_invalid_type() {
        let env = TestEnv::new("invalid_type");

        let err = create_category(&env.conn, &env.vibe_root, "My Notes", "bad_type", "notes").unwrap_err();
        assert!(matches!(err, CategoryError::InvalidType(_)));
    }

    #[test]
    fn test_duplicate_names_and_folders() {
        let env = TestEnv::new("duplicates");

        // Create first category
        create_category(&env.conn, &env.vibe_root, "Notes", "text", "notes").unwrap();

        // Duplicate name
        let err_name = create_category(&env.conn, &env.vibe_root, "Notes", "text", "different_folder").unwrap_err();
        assert!(matches!(err_name, CategoryError::NameAlreadyExists(_)));

        // Duplicate folder
        let err_folder = create_category(&env.conn, &env.vibe_root, "Other Notes", "text", "notes").unwrap_err();
        assert!(matches!(err_folder, CategoryError::FolderAlreadyRegistered(_)));
    }

    #[test]
    fn test_file_exists_at_path() {
        let env = TestEnv::new("file_exists");

        // Create a physical file where the folder wants to be created
        let file_path = env.vibe_root.join("notes");
        fs::write(&file_path, "I am a file, not a directory").unwrap();

        let err = create_category(&env.conn, &env.vibe_root, "Notes", "text", "notes").unwrap_err();
        assert!(matches!(err, CategoryError::FileExistsAtPath(_)));
    }
}
