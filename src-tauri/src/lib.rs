pub mod calendar;
pub mod collections;
pub mod contacts;
pub mod db;
pub mod mcp;
pub mod model;
pub mod pieces;
pub mod sse;
pub mod vector_index;

use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, State,
};

pub struct AppState {
    pub vibe_path: std::sync::Arc<std::sync::Mutex<PathBuf>>,
    pub model_session: std::sync::Arc<std::sync::Mutex<ort::session::Session>>,
    pub db_conn: std::sync::Arc<std::sync::Mutex<Connection>>,
    pub index_cache: std::sync::Arc<
        std::sync::Mutex<
            std::collections::HashMap<String, std::sync::Arc<crate::vector_index::VectorIndex>>,
        >,
    >,
}

fn get_config_file_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".vibenote_config.json");
    }
    PathBuf::from(".vibenote_config.json")
}

fn load_config_path() -> Option<PathBuf> {
    let config_path = get_config_file_path();
    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(config_path) {
            if let Ok(val) = serde_json::from_str::<Value>(&content) {
                if let Some(path_str) = val.get("active_vibe_path").and_then(|v| v.as_str()) {
                    let path = PathBuf::from(path_str);
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
    }
    None
}

fn save_config_path(path: &Path) -> Result<(), String> {
    let config_path = get_config_file_path();
    let data = json!({
        "active_vibe_path": path.to_string_lossy().to_string()
    });
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_active_vibe_path(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.vibe_path.lock().unwrap();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn is_workspace_configured() -> Result<bool, String> {
    Ok(get_config_file_path().exists())
}

#[tauri::command]
async fn pick_vibe_directory() -> Result<Option<String>, String> {
    let result = rfd::FileDialog::new()
        .set_title("Select or Create vibeNote Workspace (Vibe)")
        .pick_folder();
    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn change_vibe_directory(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let new_path = PathBuf::from(path);
    let db_path = new_path.join("vibe.db");
    let conn = crate::db::init_db(&db_path)
        .map_err(|e| format!("Failed to initialize database: {}", e))?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM collections;", [], |row| row.get(0))
        .unwrap_or(0);
    if count == 0 {
        let _ = crate::collections::create_collection(&conn, &new_path, "Notes", "text", "notes");
    }

    state.index_cache.lock().unwrap().clear();

    *state.vibe_path.lock().unwrap() = new_path.clone();
    *state.db_conn.lock().unwrap() = conn;

    save_config_path(&new_path)?;
    Ok(())
}

#[tauri::command]
async fn get_collections(state: State<'_, AppState>) -> Result<Value, String> {
    let conn = state.db_conn.lock().unwrap();
    crate::mcp::call_list_collections(&conn)
}

#[tauri::command]
async fn get_graph_data(state: State<'_, AppState>) -> Result<Value, String> {
    let vibe_path = state.vibe_path.lock().unwrap().clone();
    let conn = state.db_conn.lock().unwrap();

    // Query all pieces (active & inactive)
    let mut stmt = conn
        .prepare("SELECT id, collection_id, uri, created_at, is_active FROM pieces;")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)? == 1,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut nodes = Vec::new();
    for (id, collection_id, uri, created_at, is_active) in rows.flatten() {
        // Get piece title/label and content using get_piece_info
        let info = crate::mcp::get_piece_info(&vibe_path, &conn, &id).unwrap_or_else(|_| {
            crate::mcp::PieceDetail {
                id: id.clone(),
                collection_id: collection_id.clone(),
                uri: uri.clone(),
                created_at: created_at.clone(),
                is_active,
                content: "".to_string(),
                metadata: HashMap::new(),
            }
        });

        // Extract a clean title for the node label
        let mut title = info.content.trim().to_string();
        if let Some(fn_val) = info.metadata.get("formatted_name") {
            title = fn_val.clone();
        } else if let Some(sum_val) = info.metadata.get("summary") {
            title = sum_val.clone();
        } else {
            if let Some(first_line) = title.lines().next() {
                let mut cleaned = first_line.trim_start_matches('#').trim().to_string();
                if cleaned.len() > 35 {
                    cleaned.truncate(32);
                    cleaned.push_str("...");
                }
                if !cleaned.is_empty() {
                    title = cleaned;
                }
            }
            if title.is_empty() {
                title = format!("Note ({})", &id[..8]);
            }
        }

        nodes.push(json!({
            "id": id,
            "collection_id": collection_id,
            "uri": uri,
            "created_at": created_at,
            "is_active": is_active,
            "title": title,
            "content": info.content,
            "metadata": info.metadata,
        }));
    }

    // Query all relations
    let mut stmt = conn
        .prepare(
            "SELECT source_piece_id, target_piece_id, relation_type, created_at FROM relations;",
        )
        .map_err(|e| e.to_string())?;
    let rel_rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "source": row.get::<_, String>(0)?,
                "target": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "created_at": row.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut edges = Vec::new();
    for val in rel_rows.flatten() {
        edges.push(val);
    }

    // Query all piece_history
    let mut stmt = conn
        .prepare(
            "SELECT parent_piece_id, child_piece_id, change_type, timestamp FROM piece_history;",
        )
        .map_err(|e| e.to_string())?;
    let hist_rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "parent": row.get::<_, String>(0)?,
                "child": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "timestamp": row.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut history_edges = Vec::new();
    for val in hist_rows.flatten() {
        history_edges.push(val);
    }

    Ok(json!({
        "nodes": nodes,
        "edges": edges,
        "history_edges": history_edges,
    }))
}

#[tauri::command]
async fn create_piece(
    state: State<'_, AppState>,
    collection_id: String,
    content: String,
    piece_type: String,
) -> Result<Value, String> {
    let vibe_path = state.vibe_path.lock().unwrap().clone();
    let mut conn = state.db_conn.lock().unwrap();

    let mut session = state.model_session.lock().unwrap();

    let folder_path: String = conn
        .query_row(
            "SELECT folder_path FROM collections WHERE id = ?;",
            [&collection_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Collection not found: {}", e))?;

    let index =
        crate::vector_index::get_or_create_index(&vibe_path, &folder_path, &state.index_cache)
            .map_err(|e| e.to_string())?;

    if piece_type == "text" {
        let piece = crate::pieces::ingest_text_piece(
            &mut conn,
            &vibe_path,
            &collection_id,
            &content,
            None,
            &[],
            &mut session,
            &index,
        )
        .map_err(|e| e.to_string())?;
        Ok(json!(piece))
    } else if piece_type == "contacts" {
        let contact: crate::contacts::ContactJson =
            serde_json::from_str(&content).map_err(|e| format!("Invalid contact JSON: {}", e))?;
        let mut metadata = vec![("formatted_name", contact.formatted_name.as_str())];
        let email_str;
        if let Some(ref email) = contact.email {
            email_str = email.clone();
            metadata.push(("email", &email_str));
        }
        let phone_str;
        if let Some(ref phone) = contact.phone {
            phone_str = phone.clone();
            metadata.push(("phone", &phone_str));
        }
        let org_str;
        if let Some(ref org) = contact.organization {
            org_str = org.clone();
            metadata.push(("organization", &org_str));
        }
        let title_str;
        if let Some(ref title) = contact.title {
            title_str = title.clone();
            metadata.push(("title", &title_str));
        }

        let piece = crate::contacts::ingest_contact_piece(
            &mut conn,
            &vibe_path,
            &collection_id,
            &contact,
            None,
            &metadata,
            &mut session,
            &index,
        )
        .map_err(|e| e.to_string())?;
        Ok(json!(piece))
    } else if piece_type == "calendar" {
        let event: crate::calendar::CalendarJson =
            serde_json::from_str(&content).map_err(|e| format!("Invalid calendar JSON: {}", e))?;
        let mut metadata = vec![
            ("summary", event.summary.as_str()),
            ("start_date", event.start_date.as_str()),
            ("end_date", event.end_date.as_str()),
        ];
        let desc_str;
        if let Some(ref desc) = event.description {
            desc_str = desc.clone();
            metadata.push(("description", &desc_str));
        }
        let loc_str;
        if let Some(ref loc) = event.location {
            loc_str = loc.clone();
            metadata.push(("location", &loc_str));
        }

        let piece = crate::calendar::ingest_calendar_piece(
            &mut conn,
            &vibe_path,
            &collection_id,
            &event,
            None,
            &metadata,
            &mut session,
            &index,
        )
        .map_err(|e| e.to_string())?;
        Ok(json!(piece))
    } else {
        Err(format!("Unsupported piece type: {}", piece_type))
    }
}

#[tauri::command]
async fn replace_piece(
    state: State<'_, AppState>,
    old_piece_id: String,
    content: String,
) -> Result<Value, String> {
    let vibe_path = state.vibe_path.lock().unwrap().clone();
    let mut conn = state.db_conn.lock().unwrap();

    let mut session = state.model_session.lock().unwrap();

    let (_collection_id, folder_path, col_type): (String, String, String) = conn
        .query_row(
            "SELECT pieces.collection_id, collections.folder_path, collections.type 
         FROM pieces 
         JOIN collections ON pieces.collection_id = collections.id 
         WHERE pieces.id = ?;",
            [&old_piece_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("Old piece not found: {}", e))?;

    let index =
        crate::vector_index::get_or_create_index(&vibe_path, &folder_path, &state.index_cache)
            .map_err(|e| e.to_string())?;

    if col_type == "text" {
        let piece = crate::pieces::replace_piece(
            &mut conn,
            &vibe_path,
            &old_piece_id,
            &content,
            None,
            &[],
            &mut session,
            &index,
        )
        .map_err(|e| e.to_string())?;
        Ok(json!(piece))
    } else if col_type == "contacts" {
        let contact: crate::contacts::ContactJson =
            serde_json::from_str(&content).map_err(|e| format!("Invalid contact JSON: {}", e))?;
        let vcard = crate::contacts::serialize_vcard(&contact);

        let mut metadata = vec![("formatted_name", contact.formatted_name.as_str())];
        let email_str;
        if let Some(ref email) = contact.email {
            email_str = email.clone();
            metadata.push(("email", &email_str));
        }
        let phone_str;
        if let Some(ref phone) = contact.phone {
            phone_str = phone.clone();
            metadata.push(("phone", &phone_str));
        }
        let org_str;
        if let Some(ref org) = contact.organization {
            org_str = org.clone();
            metadata.push(("organization", &org_str));
        }
        let title_str;
        if let Some(ref title) = contact.title {
            title_str = title.clone();
            metadata.push(("title", &title_str));
        }

        let piece = crate::pieces::replace_piece(
            &mut conn,
            &vibe_path,
            &old_piece_id,
            &vcard,
            None,
            &metadata,
            &mut session,
            &index,
        )
        .map_err(|e| e.to_string())?;
        Ok(json!(piece))
    } else if col_type == "calendar" {
        let event: crate::calendar::CalendarJson =
            serde_json::from_str(&content).map_err(|e| format!("Invalid calendar JSON: {}", e))?;
        let created_at: String = conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now');", [], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        let ics = crate::calendar::serialize_ical(&event, &old_piece_id, &created_at);

        let mut metadata = vec![
            ("summary", event.summary.as_str()),
            ("start_date", event.start_date.as_str()),
            ("end_date", event.end_date.as_str()),
        ];
        let desc_str;
        if let Some(ref desc) = event.description {
            desc_str = desc.clone();
            metadata.push(("description", &desc_str));
        }
        let loc_str;
        if let Some(ref loc) = event.location {
            loc_str = loc.clone();
            metadata.push(("location", &loc_str));
        }

        let piece = crate::pieces::replace_piece(
            &mut conn,
            &vibe_path,
            &old_piece_id,
            &ics,
            None,
            &metadata,
            &mut session,
            &index,
        )
        .map_err(|e| e.to_string())?;
        Ok(json!(piece))
    } else {
        Err(format!(
            "Unsupported collection type for replacement: {}",
            col_type
        ))
    }
}

#[tauri::command]
async fn tombstone_piece(state: State<'_, AppState>, piece_id: String) -> Result<(), String> {
    let vibe_path = state.vibe_path.lock().unwrap().clone();
    let mut conn = state.db_conn.lock().unwrap();

    let folder_path: String = conn
        .query_row(
            "SELECT collections.folder_path 
         FROM pieces 
         JOIN collections ON pieces.collection_id = collections.id 
         WHERE pieces.id = ?;",
            [&piece_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Piece or collection not found: {}", e))?;

    let index =
        crate::vector_index::get_or_create_index(&vibe_path, &folder_path, &state.index_cache)
            .map_err(|e| e.to_string())?;

    crate::pieces::tombstone_piece(&mut conn, &vibe_path, &piece_id, &index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn link_pieces(
    state: State<'_, AppState>,
    source_id: String,
    target_id: String,
    relation_type: String,
) -> Result<(), String> {
    let conn = state.db_conn.lock().unwrap();

    crate::pieces::link_pieces(&conn, &source_id, &target_id, &relation_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_vibe(
    state: State<'_, AppState>,
    query: String,
    collection_id: Option<String>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let vibe_path = state.vibe_path.lock().unwrap().clone();
    let conn = state.db_conn.lock().unwrap();

    let mut session = state.model_session.lock().unwrap();

    let options = crate::vector_index::QueryOptions {
        collection_id,
        top_k: limit.unwrap_or(10),
    };

    let vector_results = crate::vector_index::query_pieces(
        &conn,
        &vibe_path,
        &mut session,
        &query,
        options,
        &state.index_cache,
    )
    .map_err(|e| format!("Semantic search failed: {}", e))?;

    let mut details = Vec::new();
    for res in vector_results {
        if let Ok(info) = crate::mcp::get_piece_info(&vibe_path, &conn, &res.piece_id) {
            details.push(json!({
                "piece": info,
                "similarity": res.similarity
            }));
        }
    }

    Ok(json!(details))
}

#[tauri::command]
async fn seed_demo_data(state: State<'_, AppState>) -> Result<(), String> {
    let vibe_path = state.vibe_path.lock().unwrap().clone();
    let mut conn = state.db_conn.lock().unwrap();

    let mut session = state.model_session.lock().unwrap();

    // Create collections if they don't exist
    let notes_col_id: String = conn
        .query_row(
            "SELECT id FROM collections WHERE folder_path = 'notes';",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| {
            let col =
                crate::collections::create_collection(&conn, &vibe_path, "Notes", "text", "notes")
                    .unwrap();
            col.id
        });

    let contacts_col_id: String = conn
        .query_row(
            "SELECT id FROM collections WHERE folder_path = 'contacts';",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| {
            let col = crate::collections::create_collection(
                &conn, &vibe_path, "Contacts", "contacts", "contacts",
            )
            .unwrap();
            col.id
        });

    let calendar_col_id: String = conn
        .query_row(
            "SELECT id FROM collections WHERE folder_path = 'calendar';",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| {
            let col = crate::collections::create_collection(
                &conn, &vibe_path, "Calendar", "calendar", "calendar",
            )
            .unwrap();
            col.id
        });

    // Ingest text pieces
    let index_notes =
        crate::vector_index::get_or_create_index(&vibe_path, "notes", &state.index_cache)
            .map_err(|e| e.to_string())?;

    let p1 = crate::pieces::ingest_text_piece(
        &mut conn,
        &vibe_path,
        &notes_col_id,
        "# Project Alpha Core Vision\nProject Alpha aims to build a fully local-first, privacy-respecting desktop database. It stores items as atomic, immutable Pieces and structures them dynamically with an association graph.",
        None,
        &[],
        &mut session,
        &index_notes,
    ).map_err(|e| e.to_string())?;

    let p2 = crate::pieces::ingest_text_piece(
        &mut conn,
        &vibe_path,
        &notes_col_id,
        "# Architecture: USearch Vector Index\nWe use the USearch library (HNSW graph) to perform high-speed similarity searches locally on standard consumer computers, mapping embeddings using SSD-backed files.",
        None,
        &[],
        &mut session,
        &index_notes,
    ).map_err(|e| e.to_string())?;

    let p3 = crate::pieces::ingest_text_piece(
        &mut conn,
        &vibe_path,
        &notes_col_id,
        "# Performance Bottleneck: High Capacity HNSW Rebuilding\nWhen the memory-mapped vector index reaches 100k vectors, memory constraints start causing significant page faults on lower-end devices. We need to implement vector quantization.",
        None,
        &[],
        &mut session,
        &index_notes,
    ).map_err(|e| e.to_string())?;

    // Ingest contacts
    let index_contacts =
        crate::vector_index::get_or_create_index(&vibe_path, "contacts", &state.index_cache)
            .map_err(|e| e.to_string())?;

    let contact_alice = crate::contacts::ContactJson {
        first_name: Some("Alice".to_string()),
        last_name: Some("Smith".to_string()),
        formatted_name: "Alice Smith".to_string(),
        email: Some("alice@codesmart.tech".to_string()),
        phone: Some("+1-555-0199".to_string()),
        organization: Some("Codesmart Tech".to_string()),
        title: Some("Principal Architect".to_string()),
    };

    let p_alice = crate::contacts::ingest_contact_piece(
        &mut conn,
        &vibe_path,
        &contacts_col_id,
        &contact_alice,
        None,
        &[],
        &mut session,
        &index_contacts,
    )
    .map_err(|e| e.to_string())?;

    let contact_bob = crate::contacts::ContactJson {
        first_name: Some("Bob".to_string()),
        last_name: Some("Jones".to_string()),
        formatted_name: "Bob Jones".to_string(),
        email: Some("bob@codesmart.tech".to_string()),
        phone: Some("+1-555-0144".to_string()),
        organization: Some("Codesmart Tech".to_string()),
        title: Some("Infrastructure Engineer".to_string()),
    };

    let p_bob = crate::contacts::ingest_contact_piece(
        &mut conn,
        &vibe_path,
        &contacts_col_id,
        &contact_bob,
        None,
        &[],
        &mut session,
        &index_contacts,
    )
    .map_err(|e| e.to_string())?;

    // Ingest calendar events
    let index_calendar =
        crate::vector_index::get_or_create_index(&vibe_path, "calendar", &state.index_cache)
            .map_err(|e| e.to_string())?;

    let event_launch = crate::calendar::CalendarJson {
        summary: "Project Alpha Launch".to_string(),
        start_date: "2026-08-01T09:00:00Z".to_string(),
        end_date: "2026-08-01T10:00:00Z".to_string(),
        description: Some(
            "Final release and production deployment of Project Alpha local database engines."
                .to_string(),
        ),
        location: Some("War Room 1A".to_string()),
    };

    let p_event = crate::calendar::ingest_calendar_piece(
        &mut conn,
        &vibe_path,
        &calendar_col_id,
        &event_launch,
        None,
        &[],
        &mut session,
        &index_calendar,
    )
    .map_err(|e| e.to_string())?;

    // Link pieces together
    let _ = crate::pieces::link_pieces(&conn, &p2.id, &p1.id, "part_of");
    let _ = crate::pieces::link_pieces(&conn, &p3.id, &p2.id, "contradicts");
    let _ = crate::pieces::link_pieces(&conn, &p_alice.id, &p1.id, "manages");
    let _ = crate::pieces::link_pieces(&conn, &p_bob.id, &p2.id, "implements");
    let _ = crate::pieces::link_pieces(&conn, &p_event.id, &p1.id, "schedules");
    let _ = crate::pieces::link_pieces(&conn, &p_alice.id, &p_bob.id, "colleague_of");

    // Replace p3 with quantization fix to demonstrate replacement history path
    let p3_replaced = crate::pieces::replace_piece(
        &mut conn,
        &vibe_path,
        &p3.id,
        "# Performance Bottleneck: Quantization Fix Applied\nWe implemented int8 vector quantization, which successfully resolved page faulting and reduced index RAM usage from 2.5GB to 550MB on target devices.",
        None,
        &[],
        &mut session,
        &index_notes,
    ).map_err(|e| e.to_string())?;

    // Link the new replacement piece
    let _ = crate::pieces::link_pieces(&conn, &p3_replaced.id, &p2.id, "optimizes");

    Ok(())
}

fn resolve_workspace_path() -> PathBuf {
    let args: Vec<String> = std::env::args().collect();
    for i in 0..args.len() {
        if (args[i] == "--workspace" || args[i] == "-w") && i + 1 < args.len() {
            return PathBuf::from(&args[i + 1]);
        }
    }
    if let Ok(path_str) = std::env::var("VIBE_PATH") {
        return PathBuf::from(path_str);
    }
    if let Ok(path_str) = std::env::var("VIBENOTE_WORKSPACE") {
        return PathBuf::from(path_str);
    }
    if let Some(config_path) = load_config_path() {
        return config_path;
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join(".vibenote");
        if p.exists() {
            return p;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}
#[tauri::command]
async fn add_collection(
    state: State<'_, AppState>,
    name: String,
    collection_type: String,
    folder_name: String,
) -> Result<Value, String> {
    let vibe_path = state.vibe_path.lock().unwrap().clone();
    let conn = state.db_conn.lock().unwrap();

    let collection = crate::collections::create_collection(
        &conn,
        &vibe_path,
        &name,
        &collection_type,
        &folder_name,
    )
    .map_err(|e| e.to_string())?;

    Ok(json!(collection))
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let is_mcp = std::env::args().any(|arg| arg == "--mcp");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_active_vibe_path,
            is_workspace_configured,
            pick_vibe_directory,
            change_vibe_directory,
            get_collections,
            get_graph_data,
            create_piece,
            replace_piece,
            tombstone_piece,
            link_pieces,
            seed_demo_data,
            search_vibe,
            add_collection
        ])
        .setup(move |app| {
            let vibe_path = resolve_workspace_path();

            let session = crate::model::init_model()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            let shared_session = std::sync::Arc::new(std::sync::Mutex::new(session));

            // Initialize DB connection once at startup
            let db_path = vibe_path.join("vibe.db");
            let conn = crate::db::init_db(&db_path)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            // Auto-create default collection if empty
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM collections;", [], |row| row.get(0))
                .unwrap_or(0);
            if count == 0 {
                let _ = crate::collections::create_collection(
                    &conn, &vibe_path, "Notes", "text", "notes",
                );
            }
            let shared_conn = std::sync::Arc::new(std::sync::Mutex::new(conn));

            // Build system tray with Quit option
            let quit_i = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).item(&quit_i).build()?;

            let icon = app.default_window_icon().cloned().unwrap_or_else(|| {
                let bytes = include_bytes!("../icons/32x32.png");
                tauri::image::Image::from_bytes(bytes).expect("Failed to load fallback icon")
            });

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.cleanup_before_exit();
                        std::process::exit(0);
                    }
                })
                .build(app)?;

            if is_mcp {
                // Register app state for Tauri commands using Arc<Mutex>
                let shared_path = std::sync::Arc::new(std::sync::Mutex::new(vibe_path.clone()));
                let shared_cache =
                    std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
                app.manage(AppState {
                    vibe_path: shared_path.clone(),
                    model_session: shared_session.clone(),
                    db_conn: shared_conn.clone(),
                    index_cache: shared_cache.clone(),
                });

                // Spawn stdio loop background thread
                let vibe_path_cloned = vibe_path.clone();
                let mcp_session = shared_session.clone();
                let mcp_conn = shared_conn.clone();
                let cache_cloned = shared_cache.clone();
                std::thread::spawn(move || {
                    let stdin = std::io::stdin();
                    let mut stdout = std::io::stdout();
                    use std::io::BufRead;

                    let mut session = mcp_session.lock().unwrap();

                    for line_str in stdin.lock().lines().map_while(Result::ok) {
                        let mut conn = mcp_conn.lock().unwrap();
                        let response = crate::mcp::handle_mcp_message(
                            &vibe_path_cloned,
                            &mut conn,
                            &mut session,
                            &line_str,
                            &cache_cloned,
                        );
                        use std::io::Write;
                        let _ = writeln!(stdout, "{}", response);
                        let _ = stdout.flush();
                    }
                });
            } else {
                // Register app state for Tauri commands using Arc<Mutex>
                let shared_path = std::sync::Arc::new(std::sync::Mutex::new(vibe_path.clone()));
                let shared_cache =
                    std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
                app.manage(AppState {
                    vibe_path: shared_path.clone(),
                    model_session: shared_session.clone(),
                    db_conn: shared_conn.clone(),
                    index_cache: shared_cache.clone(),
                });

                // Spawn background SSE server passing Arc<Mutex> path and connection
                let vibe_path_cloned = shared_path.clone();
                let db_conn_cloned = shared_conn.clone();
                let cache_cloned = shared_cache.clone();
                std::thread::spawn(move || {
                    if let Err(e) =
                        crate::sse::start_sse_server(vibe_path_cloned, db_conn_cloned, cache_cloned)
                    {
                        eprintln!("Failed to start SSE server: {}", e);
                    }
                });

                // Build main window programmatically in normal mode
                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("vibeNote")
                .inner_size(800.0, 600.0)
                .build()?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if is_mcp {
                api.prevent_exit();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_workspace_path_defaults() {
        let path = resolve_workspace_path();
        assert!(path.exists() || path.parent().is_some());
    }
}
