# vibeNote: Immediate Implementation Questionnaire

These questions address fundamental architectural decisions that must be resolved **before starting any implementation**.

---

## Multiple-Choice Questions

### 1. Primary Backend & Runtime Environment
What language and runtime environment will form the core backend of vibeNote?

*   **[ ] Option A: TypeScript / Node.js**
    *   *Key Benefits:* Native compatibility with the Anthropic `@modelcontextprotocol/sdk`; fast rapid prototyping; direct support for `transformers.js` (ONNX Runtime Web) in-process; vast NPM library ecosystem.
*   **[X] Option B: Rust**
    *   *Key Benefits:* Extremely low memory footprint; native single-binary compilation; integrates seamlessly into Tauri without sidecars; compile-time safety; excellent performance for local indexing.

---

### 2. Vector Search Engine Selection
Which local vector search engine should we build the first version of the Vibe RAG engine upon?

*   **[ ] Option A: `sqlite-vec` (SQLite Extension)**
    *   *Key Benefits:* Written in pure C; compiles anywhere SQLite compiles; zero external dependencies; simplifies cross-platform distributions; queries can be made inside standard SQL JOIN operations.
*   **[X] Option B: `USearch` (HNSW Library)**
    *   *Key Benefits:* Highly optimized C++ engine with SIMD acceleration; supports vector quantization (`int8`/`float16`) to reduce RAM usage by up to 90%; supports memory-mapping to query larger-than-RAM indexes directly from disk.
*   **[ ] Option C: `LanceDB` (Serverless Vector DB)**
    *   *Key Benefits:* Serverless, file-backed; native bindings for both Node.js and Rust; column-oriented layout optimized for handling document storage alongside vectors.

---

### 3. Application Shell & UI Architecture
How should the desktop application shell and user interface be structured?

*   **[X] Option A: Tauri (Rust backend + HTML/JS/TS frontend)**
    *   *Key Benefits:* Tiny bundle size (~10MB compared to 100MB+ for Electron); low RAM overhead; uses system-native web views; robust security sandboxing.
*   **[ ] Option B: Decoupled CLI & Local Web Server (Node.js Server + React/Vite)**
    *   *Key Benefits:* Simplest debugging environment; allows the tool to run headlessly in remote servers/terminals; frontend is completely decoupled from the OS wrapper.
*   **[ ] Option C: Electron Desktop App**
    *   *Key Benefits:* Easiest to write if using a purely Node.js backend; mature desktop integration hooks; native module compilation scripts are highly documented.

---

## Open Questions (with Proposed Solutions)

### 4. Physical Storage of Pieces on Disk
*   **Question:** Where are the raw content files of Pieces stored? Do they live purely inside the database, or as plain-text files?
*   **Proposed Solution:**
    Use a **Local-First hybrid file system**. Store the raw content of each Piece as a standard Markdown/text file inside the Vibe's directory structure (e.g., `<vibe_path>/pieces/<uuid>.md`) and save metadata, relationships, and vector mapping inside the SQLite file (`<vibe_path>/vibe.db`).
    *   *Why?* This ensures that the user's data remains fully human-readable and future-proof. Even if the databases become corrupted, the notes are safe and searchable with grep.

Depends of category type. For plain text pieces, markdown files are good enough. For contacts (PIM) and calendar events, structured formats like vCard and iCal/vCal are required. Those files will be stored inside the Vibe's directory structure, e.g. `<vibe_path>/<category>/<piece_id>.<extension>`. Categories cannot be nested. If user wants to separate two or more groups of pieces, they can create a second category of contact pieces, e.g. `contacts_work` and `contacts_personal`.

### 5. Token Limit Enforcement Strategy
*   **Question:** How should the configured token limit (default 800) be validated and enforced at the API layer?
*   **Proposed Solution:**
    Every Vibe will have a configuration file (`vibe_config.json`). During Piece insertion (via client UI or the MCP tool `create_piece`), the server will tokenize the input string using a fast local library (e.g., `js-tiktoken` for JS or `cl100k_base` tokenizer bindings in Rust).
    *   *Action:* If the token count exceeds the configured limit, the system will **fail-fast**, throwing a validation error and rejecting the write command before any database commit or embedding generation occurs.

Assume that 2000 characters is withing 800 tokens. If User exceeds 2000 characters (or other configured number as fail-fast value) -> reject. Then, if provided text after embedding is longer than 800 tokens (or other configured number as token limit value) -> reject. We can make fail-fast value configurable per Application Instance.