# vibeNote: Immediate Implementation Questionnaire (Round 2)

These questions address specific Rust, Tauri, and USearch integration details that need to be resolved before starting the code implementation.

---

## Multiple-Choice Questions

### 1. Local Embedding Model Execution in Rust
How should the local embedding pipeline be executed within the Rust backend?

*   **[ ] Option A: Connect to Local Ollama API (HTTP)**
    *   *Key Benefits:* Extremely lightweight; keeps ML dependencies out of the vibeNote Tauri binary; relies on the user's pre-configured hardware acceleration in Ollama.
*   **[X] Option B: In-Process ONNX Runtime (`ort` crate)**
    *   *Key Benefits:* Fully self-contained; works out-of-the-box without requiring Ollama to be installed; ONNX is highly optimized and fast on both CPU and GPU.
*   **[ ] Option C: In-Process HF Candle Engine (`candle` crate)**
    *   *Key Benefits:* Pure Rust compilation; zero native C/C++ dynamic library linking issues during cross-compilation; fully embedded within the app.

---

### 2. MCP Server Communication Channel
How should the Model Context Protocol (MCP) server be exposed so external agents (like Jan.ai, Claude Desktop, Cursor) can communicate with vibeNote?

*   **[ ] Option A: Background SSE (HTTP/Server-Sent Events) Server**
    *   *Key Benefits:* Runs continuously in the background of the Tauri app; easy to connect from any agent client via local port (e.g., `http://localhost:3000/mcp`); does not lock stdio pipes.
*   **[ ] Option B: CLI Stdio Pipe Mode**
    *   *Key Benefits:* Exposes the MCP server over standard input/output (stdio) when the app is launched from a terminal with a specific flag (e.g., `vibenote --mcp`). Fits the standard client-server subprocess spawning model of Claude Desktop and Cursor.
*   **[X] Option C: Hybrid SSE and Stdio CLI**
    *   *Key Benefits:* Provides maximum flexibility. The GUI app runs an SSE server, and the CLI binary accepts a stdio `--mcp` flag for IDE integration.

---

### 3. Rust SQLite Driver Crate
Which SQLite library should be used in the Rust backend?

*   **[X] Option A: `rusqlite`**
    *   *Key Benefits:* Direct synchronous C-bindings to SQLite; lightweight and fast; simple to structure inside Tauri commands without asynchronous connection pool overhead.
*   **[ ] Option B: `sqlx` (SQLite module)**
    *   *Key Benefits:* Full async/await support; compile-time SQL query validation; connection pooling; simplifies managing asynchronous transactions.

---

## Open Questions (with Proposed Solutions)

### 4. USearch Index File Serialization
*   **Question:** How and when should the USearch index be saved to disk, and how do we ensure it stays in sync with SQLite metadata?
*   **Proposed Solution:**
    The USearch index will be serialized to `<vibe_path>/vibe.usearch`. Any piece creation or deletion will follow a write-through sequence:
    1. Write/modify the record in SQLite (`vibe.db`).
    2. Add/remove the vector in the USearch index in memory.
    3. Save the index to disk using `index.save("<vibe_path>/vibe.usearch")`.
    If the index save fails, roll back the SQLite transaction (or mark the record as unindexed in SQLite to retarget it later).

I'm ok with proposed solution.

### 5. vCard and iCal Parsing in Rust
*   **Question:** What parsing strategy and crates should be used to handle Contacts (vCard) and Calendar (iCal) data?
*   **Proposed Solution:**
    We will use the **`ical`** crate in Rust to parse `.vcf` and `.ics` files. During Piece ingestion:
    1. The raw string content is validated.
    2. The parser extracts core attributes (e.g., event summary, start time, end time, email, telephone).
    3. These attributes are stored as typed columns in the SQLite DB to facilitate fast metadata filtering.
    4. The original unmodified source file is saved to `<vibe_path>/<category>/<piece_id>.<extension>`.

vcf and ics files are used for storage only. pieces within categories of type contact or calendar will be represented by JSON object defined for MCP tool, then converted to natural language text for the purpose of vectorization and stored as vcf/ics file on disk.