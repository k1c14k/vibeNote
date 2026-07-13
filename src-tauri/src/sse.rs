use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::mpsc::Sender;
use std::path::Path;
use std::io::Write;

static SESSIONS: OnceLock<Mutex<HashMap<String, Sender<Vec<u8>>>>> = OnceLock::new();

fn get_sessions() -> &'static Mutex<HashMap<String, Sender<Vec<u8>>>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Spawns a local Server-Sent Events HTTP server inside the Tauri backend.
pub fn start_sse_server(vibe_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("VIBENOTE_SSE_PORT")
        .or_else(|_| std::env::var("PORT"))
        .unwrap_or_else(|_| "3001".to_string());
    
    let addr = format!("127.0.0.1:{}", port);
    let server = Arc::new(tiny_http::Server::http(&addr).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::Other, e)
    })?);
    println!("SSE server listening on http://{}", addr);

    let model_session = Arc::new(Mutex::new(crate::model::init_model()?));

    for request in server.incoming_requests() {
        let vibe_path_cloned = vibe_path.to_path_buf();
        let session_cloned = model_session.clone();
        
        std::thread::spawn(move || {
            if let Err(e) = handle_request(request, &vibe_path_cloned, session_cloned) {
                eprintln!("Error handling HTTP request: {}", e);
            }
        });
    }

    Ok(())
}

fn handle_request(
    mut request: tiny_http::Request,
    vibe_path: &Path,
    model_session: Arc<Mutex<ort::session::Session>>,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Handle CORS preflight OPTIONS request
    if request.method() == &tiny_http::Method::Options {
        let response = tiny_http::Response::new(
            tiny_http::StatusCode(204),
            vec![
                tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                tiny_http::Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, GET, OPTIONS"[..]).unwrap(),
                tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap(),
            ],
            std::io::empty(),
            Some(0),
            None,
        );
        request.respond(response)?;
        return Ok(());
    }

    let url = request.url();
    let path = url.split('?').next().unwrap_or("");

    match (request.method(), path) {
        (&tiny_http::Method::Get, "/sse") => {
            let session_id = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = std::sync::mpsc::channel();

            if let Ok(mut registry) = get_sessions().lock() {
                registry.insert(session_id.clone(), tx);
                println!("SSE session registered: {}", session_id);
            }

            // Consume request to obtain the direct socket writer
            let mut writer = request.into_writer();

            // Write and flush headers immediately so the HTTP handshake succeeds
            let headers = b"HTTP/1.1 200 OK\r\n\
                            Content-Type: text/event-stream\r\n\
                            Cache-Control: no-cache\r\n\
                            Connection: keep-alive\r\n\
                            Access-Control-Allow-Origin: *\r\n\r\n";
            writer.write_all(headers)?;
            writer.flush()?;

            // Emit the standard MCP endpoint event telling the client where to send POSTs
            let initial_event = format!("event: endpoint\ndata: /message?session_id={}\n\n", session_id);
            writer.write_all(initial_event.as_bytes())?;
            writer.flush()?;

            // Keep connection open and stream events as they arrive, checking heartbeat every 5s
            loop {
                match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                    Ok(data) => {
                        if let Err(e) = writer.write_all(&data).and_then(|_| writer.flush()) {
                            eprintln!("SSE write error (client likely disconnected): {}", e);
                            break;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        // Send an SSE comment ping to verify the connection is still alive
                        let ping = b": ping\n\n";
                        if let Err(e) = writer.write_all(ping).and_then(|_| writer.flush()) {
                            println!("SSE heartbeat write error (client disconnected): {}", e);
                            break;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            }

            // Clean up session registry on client disconnect
            if let Ok(mut registry) = get_sessions().lock() {
                registry.remove(&session_id);
                println!("SSE session disconnected & removed: {}", session_id);
            }
        }
        (&tiny_http::Method::Post, "/message") => {
            // Extract session_id supporting both query parameter conventions
            let session_id = if let Some(pos) = url.find("session_id=") {
                let start = pos + "session_id=".len();
                let end = url[start..].find('&').map(|x| start + x).unwrap_or(url.len());
                url[start..end].to_string()
            } else if let Some(pos) = url.find("sessionId=") {
                let start = pos + "sessionId=".len();
                let end = url[start..].find('&').map(|x| start + x).unwrap_or(url.len());
                url[start..end].to_string()
            } else {
                "".to_string()
            };

            if session_id.is_empty() {
                let response = tiny_http::Response::from_string("Missing session_id".to_string())
                    .with_status_code(400);
                request.respond(response)?;
                return Ok(());
            }

            let tx_opt = if let Ok(registry) = get_sessions().lock() {
                registry.get(&session_id).cloned()
            } else {
                None
            };

            let tx = match tx_opt {
                Some(t) => t,
                None => {
                    let response = tiny_http::Response::from_string("Session not found".to_string())
                        .with_status_code(404);
                    request.respond(response)?;
                    return Ok(());
                }
            };

            // Read the incoming POST body payload
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body)?;

            let db_path = vibe_path.join("vibe.db");
            let mut conn = crate::db::init_db(&db_path)?;

            // Route through core handle_mcp_message logic
            let response = {
                let mut session_guard = model_session.lock().unwrap();
                crate::mcp::handle_mcp_message(vibe_path, &mut conn, &mut *session_guard, &body)
            };

            // Format as standard MCP SSE event and send to connection thread channel
            let event_payload = format!("event: message\ndata: {}\n\n", response).into_bytes();
            let _ = tx.send(event_payload);

            // Respond to POST request with success headers
            let response = tiny_http::Response::from_string("{}".to_string())
                .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
                .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
            request.respond(response)?;
        }
        _ => {
            let response = tiny_http::Response::from_string("Not Found".to_string())
                .with_status_code(404);
            request.respond(response)?;
        }
    }

    Ok(())
}
