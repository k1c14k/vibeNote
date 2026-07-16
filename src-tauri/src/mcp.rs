use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
    pub id: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
    pub id: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PieceDetail {
    pub id: String,
    pub collection_id: String,
    pub uri: Option<String>,
    pub created_at: String,
    pub is_active: bool,
    pub content: String,
    pub metadata: HashMap<String, String>,
}

/// Helper to load a Piece's full details and raw content from the workspace filesystem.
pub fn get_piece_info(
    vibe_path: &Path,
    conn: &Connection,
    id: &str,
) -> Result<PieceDetail, String> {
    let piece_row: (String, Option<String>, String, i32) = conn
        .query_row(
            "SELECT collection_id, uri, created_at, is_active FROM pieces WHERE id = ?;",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("Piece not found in database: {}", e))?;

    let (collection_id, uri, created_at, is_active_int) = piece_row;
    let is_active = is_active_int == 1;

    let col_row: (String, String) = conn
        .query_row(
            "SELECT folder_path, type FROM collections WHERE id = ?;",
            [&collection_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Collection details not found for piece: {}", e))?;

    let (folder_path, col_type) = col_row;

    let ext = match col_type.as_str() {
        "text" => "md",
        "contacts" => "vcf",
        "calendar" => "ics",
        _ => "txt",
    };

    let file_path = vibe_path.join(&folder_path).join(format!("{}.{}", id, ext));
    let raw_content = std::fs::read_to_string(&file_path).unwrap_or_else(|_| "".to_string());

    let content = match col_type.as_str() {
        "contacts" => parse_vcard_to_text(&raw_content),
        "calendar" => parse_ical_to_text(&raw_content),
        _ => raw_content,
    };

    let mut meta_stmt = conn
        .prepare("SELECT key, value FROM piece_metadata WHERE piece_id = ?;")
        .map_err(|e| e.to_string())?;
    let meta_rows = meta_stmt
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut metadata = HashMap::new();
    for (k, v) in meta_rows.flatten() {
        metadata.insert(k, v);
    }

    Ok(PieceDetail {
        id: id.to_string(),
        collection_id,
        uri,
        created_at,
        is_active,
        content,
        metadata,
    })
}

/// The main entry point to route and handle MCP requests.
pub fn handle_mcp_message(
    vibe_path: &Path,
    conn: &mut Connection,
    session: &mut ort::session::Session,
    message_str: &str,
    index_cache: &std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<crate::vector_index::VectorIndex>>,
    >,
) -> String {
    let req: JsonRpcRequest = match serde_json::from_str(message_str) {
        Ok(parsed) => parsed,
        Err(e) => {
            let res = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError {
                    code: -32700,
                    message: format!("Parse error: {}", e),
                    data: None,
                }),
                id: None,
            };
            return serde_json::to_string(&res).unwrap_or_default();
        }
    };

    let req_id = req.id.clone();

    // Verify jsonrpc protocol version
    if req.jsonrpc != "2.0" {
        let res = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code: -32600,
                message: "Invalid Request: jsonrpc version must be '2.0'".to_string(),
                data: None,
            }),
            id: req_id,
        };
        return serde_json::to_string(&res).unwrap_or_default();
    }

    let result = match req.method.as_str() {
        "initialize" => handle_initialize(),
        "notifications/initialized" | "initialized" => {
            // Acknowledge notification without creating response
            return "".to_string();
        }
        "tools/list" => handle_tools_list(),
        "tools/call" => handle_tools_call(
            vibe_path,
            conn,
            session,
            req.params.unwrap_or(Value::Null),
            index_cache,
        ),
        "ping" => Ok(json!({})),
        _ => Err((-32601, format!("Method not found: {}", req.method))),
    };

    match result {
        Ok(res_val) => {
            let res = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: Some(res_val),
                error: None,
                id: req_id,
            };
            serde_json::to_string(&res).unwrap_or_default()
        }
        Err((code, message)) => {
            let res = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError {
                    code,
                    message,
                    data: None,
                }),
                id: req_id,
            };
            serde_json::to_string(&res).unwrap_or_default()
        }
    }
}

fn handle_initialize() -> Result<Value, (i64, String)> {
    Ok(json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "vibeNote Server",
            "version": "0.2.0"
        }
    }))
}

fn handle_tools_list() -> Result<Value, (i64, String)> {
    Ok(json!({
        "tools": [
            {
                "name": "search_vibe",
                "description": "Runs a semantic search query across all active pieces in the current Vibe.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The natural language search query."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of results to return (default 10)."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "search_collection",
                "description": "Runs a semantic search query restricted to a specific collection.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The natural language search query."
                        },
                        "collection_id": {
                            "type": "string",
                            "description": "The UUID of the collection to search in."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of results to return (default 10)."
                        }
                    },
                    "required": ["query", "collection_id"]
                }
            },
            {
                "name": "create_piece",
                "description": "Creates a new piece in a collection. For text collections, content is plain text. For contacts and calendar collections, content must be a JSON string representing the contact or calendar object.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The content of the piece (text or serialized JSON)."
                        },
                        "collection_id": {
                            "type": "string",
                            "description": "The UUID of the collection this piece belongs to."
                        },
                        "metadata": {
                            "type": "object",
                            "description": "Optional custom metadata key-value pairs (only saved for text pieces).",
                            "additionalProperties": {
                                "type": "string"
                            }
                        }
                    },
                    "required": ["content", "collection_id"]
                }
            },
            {
                "name": "get_piece_details",
                "description": "Retrieves a specific piece, its full metadata, history, relations, and raw file content.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "The UUID of the piece."
                        }
                    },
                    "required": ["id"]
                }
            },
            {
                "name": "link_pieces",
                "description": "Explicitly creates a typed semantic relationship between two pieces.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "source_id": {
                            "type": "string",
                            "description": "The UUID of the source piece."
                        },
                        "target_id": {
                            "type": "string",
                            "description": "The UUID of the target piece."
                        },
                        "relation_type": {
                            "type": "string",
                            "description": "The type of the relationship (e.g. 'refers_to', 'supports')."
                        }
                    },
                    "required": ["source_id", "target_id", "relation_type"]
                }
            },
            {
                "name": "get_relations_graph",
                "description": "Returns the local network of related pieces (nodes and edges).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "piece_id": {
                            "type": "string",
                            "description": "The UUID of the piece to center the graph on."
                        }
                    },
                    "required": ["piece_id"]
                }
            },
            {
                "name": "list_collections",
                "description": "Lists all collections in the current Vibe workspace.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "set_metadata",
                "description": "Sets/updates a metadata key-value pair for a piece.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "piece_id": {
                            "type": "string",
                            "description": "The UUID of the piece."
                        },
                        "key": {
                            "type": "string",
                            "description": "The metadata key to set."
                        },
                        "value": {
                            "type": "string",
                            "description": "The value to set."
                        }
                    },
                    "required": ["piece_id", "key", "value"]
                }
            },
            {
                "name": "delete_metadata",
                "description": "Deletes a metadata key from a piece.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "piece_id": {
                            "type": "string",
                            "description": "The UUID of the piece."
                        },
                        "key": {
                            "type": "string",
                            "description": "The metadata key to delete."
                        }
                    },
                    "required": ["piece_id", "key"]
                }
            }
        ]
    }))
}

fn handle_tools_call(
    vibe_path: &Path,
    conn: &mut Connection,
    session: &mut ort::session::Session,
    params: Value,
    index_cache: &std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<crate::vector_index::VectorIndex>>,
    >,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (-32602, "Missing parameter: name".to_string()))?;

    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);

    let res = match name {
        "search_vibe" => call_search_vibe(vibe_path, conn, session, arguments, index_cache),
        "search_collection" => {
            call_search_collection(vibe_path, conn, session, arguments, index_cache)
        }
        "create_piece" => call_create_piece(vibe_path, conn, session, arguments, index_cache),
        "get_piece_details" => call_get_piece_details(vibe_path, conn, arguments),
        "link_pieces" => call_link_pieces(conn, arguments),
        "get_relations_graph" => call_get_relations_graph(vibe_path, conn, arguments),
        "list_collections" => call_list_collections(conn),
        "set_metadata" => call_set_metadata(conn, arguments),
        "delete_metadata" => call_delete_metadata(conn, arguments),
        _ => Err(format!("Tool not found: {}", name)),
    };

    match res {
        Ok(val) => Ok(json!({
            "content": [
                {
                    "type": "text",
                    "text": serde_json::to_string_pretty(&val).unwrap_or_default()
                }
            ],
            "isError": false
        })),
        Err(err_msg) => Ok(json!({
            "content": [
                {
                    "type": "text",
                    "text": err_msg
                }
            ],
            "isError": true
        })),
    }
}

fn call_search_vibe(
    vibe_path: &Path,
    conn: &Connection,
    session: &mut ort::session::Session,
    args: Value,
    index_cache: &std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<crate::vector_index::VectorIndex>>,
    >,
) -> Result<Value, String> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: query".to_string())?;

    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

    let options = crate::vector_index::QueryOptions {
        collection_id: None,
        top_k: limit,
    };

    let vector_results =
        crate::vector_index::query_pieces(conn, vibe_path, session, query, options, index_cache)
            .map_err(|e| format!("Semantic search failed: {}", e))?;

    let mut details = Vec::new();
    for res in vector_results {
        if let Ok(info) = get_piece_info(vibe_path, conn, &res.piece_id) {
            details.push(json!({
                "piece": info,
                "similarity": res.similarity
            }));
        }
    }

    Ok(json!(details))
}

fn call_search_collection(
    vibe_path: &Path,
    conn: &Connection,
    session: &mut ort::session::Session,
    args: Value,
    index_cache: &std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<crate::vector_index::VectorIndex>>,
    >,
) -> Result<Value, String> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: query".to_string())?;

    let collection_id = args
        .get("collection_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: collection_id".to_string())?;

    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

    let options = crate::vector_index::QueryOptions {
        collection_id: Some(collection_id.to_string()),
        top_k: limit,
    };

    let vector_results =
        crate::vector_index::query_pieces(conn, vibe_path, session, query, options, index_cache)
            .map_err(|e| format!("Semantic search failed: {}", e))?;

    let mut details = Vec::new();
    for res in vector_results {
        if let Ok(info) = get_piece_info(vibe_path, conn, &res.piece_id) {
            details.push(json!({
                "piece": info,
                "similarity": res.similarity
            }));
        }
    }

    Ok(json!(details))
}

fn call_create_piece(
    vibe_path: &Path,
    conn: &mut Connection,
    session: &mut ort::session::Session,
    args: Value,
    index_cache: &std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<crate::vector_index::VectorIndex>>,
    >,
) -> Result<Value, String> {
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: content".to_string())?;

    let collection_id = args
        .get("collection_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: collection_id".to_string())?;

    // Look up collection details
    let col_row: (String, String) = conn
        .query_row(
            "SELECT folder_path, type FROM collections WHERE id = ?;",
            [collection_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Collection not found in database: {}", e))?;

    let (folder_path, col_type) = col_row;

    // Load vector index for the collection
    let index = crate::vector_index::get_or_create_index(vibe_path, &folder_path, index_cache)
        .map_err(|e| format!("Failed to load vector index: {}", e))?;

    // Parse metadata if present
    let mut metadata_list = Vec::new();
    if let Some(meta_val) = args.get("metadata") {
        if let Some(obj) = meta_val.as_object() {
            for (k, v) in obj {
                if let Some(s) = v.as_str() {
                    metadata_list.push((k.clone(), s.to_string()));
                }
            }
        }
    }
    let meta_slice: Vec<(&str, &str)> = metadata_list
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    match col_type.as_str() {
        "text" => {
            let piece = crate::pieces::ingest_text_piece(
                conn,
                vibe_path,
                collection_id,
                content,
                None,
                &meta_slice,
                session,
                &index,
            )
            .map_err(|e| format!("Ingestion error: {}", e))?;

            Ok(json!(piece))
        }
        "contacts" => {
            let contact: crate::contacts::ContactJson = serde_json::from_str(content)
                .map_err(|e| format!("Invalid Contact JSON payload: {}", e))?;

            let piece = crate::contacts::ingest_contact_piece(
                conn,
                vibe_path,
                collection_id,
                &contact,
                None,
                &meta_slice,
                session,
                &index,
            )
            .map_err(|e| format!("Ingestion error: {}", e))?;

            Ok(json!(piece))
        }
        "calendar" => {
            let event: crate::calendar::CalendarJson = serde_json::from_str(content)
                .map_err(|e| format!("Invalid Calendar JSON payload: {}", e))?;

            let piece = crate::calendar::ingest_calendar_piece(
                conn,
                vibe_path,
                collection_id,
                &event,
                None,
                &meta_slice,
                session,
                &index,
            )
            .map_err(|e| format!("Ingestion error: {}", e))?;

            Ok(json!(piece))
        }
        _ => Err(format!("Unsupported collection type: {}", col_type)),
    }
}

fn call_get_piece_details(
    vibe_path: &Path,
    conn: &Connection,
    args: Value,
) -> Result<Value, String> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: id".to_string())?;

    let info = get_piece_info(vibe_path, conn, id)?;

    // Fetch history
    let mut hist_stmt = conn.prepare(
        "SELECT parent_piece_id, child_piece_id, change_type, timestamp FROM piece_history WHERE parent_piece_id = ? OR child_piece_id = ?;"
    ).map_err(|e| e.to_string())?;

    let hist_rows = hist_stmt
        .query_map([id, id], |row| {
            Ok(json!({
                "parent_piece_id": row.get::<_, String>(0)?,
                "child_piece_id": row.get::<_, String>(1)?,
                "change_type": row.get::<_, String>(2)?,
                "timestamp": row.get::<_, String>(3)?
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut history = Vec::new();
    for val in hist_rows.flatten() {
        history.push(val);
    }

    // Fetch relations
    let relations = crate::pieces::get_relations(conn, id)
        .map_err(|e| format!("Failed to retrieve relations: {}", e))?;

    Ok(json!({
        "piece": info,
        "history": history,
        "relations": relations
    }))
}

fn call_link_pieces(conn: &Connection, args: Value) -> Result<Value, String> {
    let source_id = args
        .get("source_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: source_id".to_string())?;

    let target_id = args
        .get("target_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: target_id".to_string())?;

    let relation_type = args
        .get("relation_type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: relation_type".to_string())?;

    crate::pieces::link_pieces(conn, source_id, target_id, relation_type)
        .map_err(|e| format!("Linking failed: {}", e))?;

    Ok(json!({}))
}

fn call_get_relations_graph(
    vibe_path: &Path,
    conn: &Connection,
    args: Value,
) -> Result<Value, String> {
    let piece_id = args
        .get("piece_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: piece_id".to_string())?;

    let relations = crate::pieces::get_relations(conn, piece_id)
        .map_err(|e| format!("Failed to retrieve relations: {}", e))?;

    let mut unique_ids = HashSet::new();
    unique_ids.insert(piece_id.to_string());
    for rel in &relations {
        unique_ids.insert(rel.source_piece_id.clone());
        unique_ids.insert(rel.target_piece_id.clone());
    }

    let mut nodes = Vec::new();
    for id in unique_ids {
        if let Ok(info) = get_piece_info(vibe_path, conn, &id) {
            nodes.push(json!({
                "id": id,
                "collection_id": info.collection_id,
                "is_active": info.is_active,
                "label": info.content
            }));
        }
    }

    Ok(json!({
        "nodes": nodes,
        "edges": relations
    }))
}

pub fn call_list_collections(conn: &Connection) -> Result<Value, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, type, folder_path FROM collections;")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "folder_path": row.get::<_, String>(3)?
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for val in rows.flatten() {
        list.push(val);
    }
    Ok(json!(list))
}

fn call_set_metadata(conn: &Connection, args: Value) -> Result<Value, String> {
    let piece_id = args
        .get("piece_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: piece_id".to_string())?;

    let key = args
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: key".to_string())?;

    let value = args
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: value".to_string())?;

    // Check if piece exists
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pieces WHERE id = ?);",
            [piece_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !exists {
        return Err(format!("Piece with ID '{}' not found.", piece_id));
    }

    conn.execute(
        "INSERT OR REPLACE INTO piece_metadata (piece_id, key, value) VALUES (?, ?, ?);",
        [piece_id, key, value],
    )
    .map_err(|e| format!("Failed to set metadata: {}", e))?;

    Ok(json!({}))
}

fn call_delete_metadata(conn: &Connection, args: Value) -> Result<Value, String> {
    let piece_id = args
        .get("piece_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: piece_id".to_string())?;

    let key = args
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing argument: key".to_string())?;

    // Check if piece exists
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pieces WHERE id = ?);",
            [piece_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !exists {
        return Err(format!("Piece with ID '{}' not found.", piece_id));
    }

    conn.execute(
        "DELETE FROM piece_metadata WHERE piece_id = ? AND key = ?;",
        [piece_id, key],
    )
    .map_err(|e| format!("Failed to delete metadata: {}", e))?;

    Ok(json!({}))
}

fn parse_vcard_to_text(content: &str) -> String {
    let mut contact = crate::contacts::ContactJson {
        first_name: None,
        last_name: None,
        formatted_name: "".to_string(),
        email: None,
        phone: None,
        organization: None,
        title: None,
    };
    for line in content.lines() {
        if let Some(stripped) = line.strip_prefix("FN:") {
            contact.formatted_name = stripped.trim().to_string();
        } else if line.starts_with("EMAIL;") || line.starts_with("EMAIL:") {
            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if parts.len() == 2 {
                contact.email = Some(parts[1].trim().to_string());
            }
        } else if line.starts_with("TEL;") || line.starts_with("TEL:") {
            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if parts.len() == 2 {
                contact.phone = Some(parts[1].trim().to_string());
            }
        } else if let Some(stripped) = line.strip_prefix("ORG:") {
            contact.organization = Some(stripped.trim().to_string());
        } else if let Some(stripped) = line.strip_prefix("TITLE:") {
            contact.title = Some(stripped.trim().to_string());
        }
    }
    crate::contacts::contact_to_text(&contact)
}

fn parse_ical_to_text(content: &str) -> String {
    let mut event = crate::calendar::CalendarJson {
        summary: "".to_string(),
        start_date: "".to_string(),
        end_date: "".to_string(),
        description: None,
        location: None,
    };
    for line in content.lines() {
        if let Some(stripped) = line.strip_prefix("SUMMARY:") {
            event.summary = stripped.trim().to_string();
        } else if let Some(stripped) = line.strip_prefix("DTSTART:") {
            let val = stripped.trim().to_string();
            event.start_date = format_dtstamp(&val);
        } else if let Some(stripped) = line.strip_prefix("DTEND:") {
            let val = stripped.trim().to_string();
            event.end_date = format_dtstamp(&val);
        } else if let Some(stripped) = line.strip_prefix("DESCRIPTION:") {
            event.description = Some(stripped.trim().to_string());
        } else if let Some(stripped) = line.strip_prefix("LOCATION:") {
            event.location = Some(stripped.trim().to_string());
        }
    }
    crate::calendar::calendar_to_text(&event)
}

fn format_dtstamp(val: &str) -> String {
    if val.len() >= 15 && val.contains('T') {
        let date_part = &val[0..8]; // 20260712
        let time_part = &val[9..15]; // 170000
        format!(
            "{}-{}-{}T{}:{}:{}Z",
            &date_part[0..4],
            &date_part[4..6],
            &date_part[6..8],
            &time_part[0..2],
            &time_part[2..4],
            &time_part[4..6]
        )
    } else {
        val.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collections::create_collection;
    use crate::db::init_db;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    struct TestMcpEnv {
        vibe_root: PathBuf,
        conn: Connection,
        session: ort::session::Session,
        collection_id: String,
        _index: usearch::Index,
    }

    impl TestMcpEnv {
        fn new(name: &str) -> Self {
            let temp_dir = std::env::temp_dir();
            let vibe_root = temp_dir.join(format!(
                "vibenote_test_mcp_{}_{}",
                name,
                Uuid::new_v4().simple()
            ));
            fs::create_dir_all(&vibe_root).unwrap();

            let db_path = vibe_root.join("vibe.db");
            let conn = init_db(&db_path).unwrap();

            let col = create_collection(&conn, &vibe_root, "Notes", "text", "notes").unwrap();

            let session = crate::model::init_model().unwrap();
            let index =
                crate::vector_index::load_or_create_index(&vibe_root, &col.folder_path).unwrap();

            Self {
                vibe_root,
                conn,
                session,
                collection_id: col.id,
                _index: index,
            }
        }
    }

    impl Drop for TestMcpEnv {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.vibe_root);
        }
    }

    #[test]
    fn test_mcp_initialize() {
        let mut env = TestMcpEnv::new("initialize");
        let msg = json!({
            "jsonrpc": "2.0",
            "method": "initialize",
            "id": 1
        });

        let response_str = handle_mcp_message(
            &env.vibe_root,
            &mut env.conn,
            &mut env.session,
            &serde_json::to_string(&msg).unwrap(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        );
        let res: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();

        assert_eq!(res.jsonrpc, "2.0");
        assert!(res.error.is_none());
        assert_eq!(res.id, Some(json!(1)));

        let result = res.result.unwrap();
        assert_eq!(
            result.get("protocolVersion").unwrap().as_str(),
            Some("2024-11-05")
        );
        assert!(result.get("capabilities").is_some());
    }

    #[test]
    fn test_mcp_tools_list() {
        let mut env = TestMcpEnv::new("tools_list");
        let msg = json!({
            "jsonrpc": "2.0",
            "method": "tools/list",
            "id": 2
        });

        let response_str = handle_mcp_message(
            &env.vibe_root,
            &mut env.conn,
            &mut env.session,
            &serde_json::to_string(&msg).unwrap(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        );
        let res: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();

        assert_eq!(res.id, Some(json!(2)));
        let tools = res
            .result
            .unwrap()
            .get("tools")
            .unwrap()
            .as_array()
            .unwrap()
            .clone();

        let names: Vec<&str> = tools
            .iter()
            .map(|t| t.get("name").unwrap().as_str().unwrap())
            .collect();
        assert!(names.contains(&"search_vibe"));
        assert!(names.contains(&"search_collection"));
        assert!(names.contains(&"create_piece"));
        assert!(names.contains(&"get_piece_details"));
        assert!(names.contains(&"link_pieces"));
        assert!(names.contains(&"get_relations_graph"));
        assert!(names.contains(&"list_collections"));
        assert!(names.contains(&"set_metadata"));
        assert!(names.contains(&"delete_metadata"));
    }

    #[test]
    fn test_mcp_create_piece_and_metadata_ops() {
        let mut env = TestMcpEnv::new("create_and_meta");

        // 1. Create a piece using create_piece tool
        let create_msg = json!({
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "create_piece",
                "arguments": {
                    "collection_id": env.collection_id,
                    "content": "This is test piece content created via MCP.",
                    "metadata": {
                        "source": "mcp-test",
                        "status": "draft"
                    }
                }
            },
            "id": 10
        });

        let response_str = handle_mcp_message(
            &env.vibe_root,
            &mut env.conn,
            &mut env.session,
            &serde_json::to_string(&create_msg).unwrap(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        );
        let res: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();

        let tools_call_res = res.result.unwrap();
        assert_eq!(
            tools_call_res.get("isError").unwrap().as_bool(),
            Some(false)
        );

        let content_text = tools_call_res.get("content").unwrap().as_array().unwrap()[0]
            .get("text")
            .unwrap()
            .as_str()
            .unwrap();
        let piece: crate::pieces::Piece = serde_json::from_str(content_text).unwrap();

        assert_eq!(piece.collection_id, env.collection_id);

        // 2. Set metadata key
        let set_meta_msg = json!({
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "set_metadata",
                "arguments": {
                    "piece_id": piece.id,
                    "key": "status",
                    "value": "reviewed"
                }
            },
            "id": 11
        });
        let _ = handle_mcp_message(
            &env.vibe_root,
            &mut env.conn,
            &mut env.session,
            &serde_json::to_string(&set_meta_msg).unwrap(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        );

        // Check if value updated in DB
        let status_val: String = env
            .conn
            .query_row(
                "SELECT value FROM piece_metadata WHERE piece_id = ? AND key = 'status';",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status_val, "reviewed");

        // 3. Delete metadata key
        let del_meta_msg = json!({
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "delete_metadata",
                "arguments": {
                    "piece_id": piece.id,
                    "key": "source"
                }
            },
            "id": 12
        });
        let _ = handle_mcp_message(
            &env.vibe_root,
            &mut env.conn,
            &mut env.session,
            &serde_json::to_string(&del_meta_msg).unwrap(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        );

        let exists: bool = env.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM piece_metadata WHERE piece_id = ? AND key = 'source');",
            [&piece.id],
            |row| row.get(0)
        ).unwrap();
        assert!(!exists);
    }

    #[test]
    fn test_mcp_contacts_and_calendar_metadata_and_reconstruction() {
        let mut env = TestMcpEnv::new("contacts_cal");

        // 1. Create a contacts collection
        let contacts_col = create_collection(
            &env.conn,
            &env.vibe_root,
            "My Contacts",
            "contacts",
            "contacts",
        )
        .unwrap();

        // 2. Create a contact piece using create_piece tool
        let contact_json = json!({
            "first_name": "Alice",
            "last_name": "Smith",
            "formatted_name": "Alice Smith",
            "email": "alice@example.com",
            "phone": "+987654321",
            "organization": "Hedgehog Inc",
            "title": "Researcher"
        });

        let create_msg = json!({
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "create_piece",
                "arguments": {
                    "collection_id": contacts_col.id,
                    "content": contact_json.to_string(),
                    "metadata": {
                        "role": "admin",
                        "status": "active"
                    }
                }
            },
            "id": 20
        });

        let response_str = handle_mcp_message(
            &env.vibe_root,
            &mut env.conn,
            &mut env.session,
            &serde_json::to_string(&create_msg).unwrap(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        );
        let res: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();
        let tools_call_res = res.result.unwrap();
        assert_eq!(
            tools_call_res.get("isError").unwrap().as_bool(),
            Some(false)
        );

        let content_text = tools_call_res.get("content").unwrap().as_array().unwrap()[0]
            .get("text")
            .unwrap()
            .as_str()
            .unwrap();
        let piece: crate::pieces::Piece = serde_json::from_str(content_text).unwrap();

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

        let has_extracted: bool = env
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM piece_metadata WHERE piece_id = ? AND key = 'name');",
                [&piece.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!has_extracted);

        // 4. Verify get_piece_details reconstructions
        let details_msg = json!({
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "get_piece_details",
                "arguments": {
                    "id": piece.id
                }
            },
            "id": 21
        });
        let details_resp_str = handle_mcp_message(
            &env.vibe_root,
            &mut env.conn,
            &mut env.session,
            &serde_json::to_string(&details_msg).unwrap(),
            &std::sync::Mutex::new(std::collections::HashMap::new()),
        );
        let details_res: JsonRpcResponse = serde_json::from_str(&details_resp_str).unwrap();
        let details_call_res = details_res.result.unwrap();
        assert_eq!(
            details_call_res.get("isError").unwrap().as_bool(),
            Some(false)
        );

        let details_text = details_call_res.get("content").unwrap().as_array().unwrap()[0]
            .get("text")
            .unwrap()
            .as_str()
            .unwrap();
        let details_json: Value = serde_json::from_str(details_text).unwrap();
        let piece_val = details_json.get("piece").unwrap().clone();
        let detail_obj: PieceDetail = serde_json::from_value(piece_val).unwrap();

        assert_eq!(detail_obj.content, "Contact profile for Alice Smith. Email: alice@example.com. Phone: +987654321. Organization: Hedgehog Inc. Title: Researcher.");
    }
}
