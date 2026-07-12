# vibeNote: Immediate Implementation Questionnaire (Round 3)

These questions address specific implementation and packaging details arising from the ONNX embedding engine, hybrid MCP channels, and USearch index constraints.

---

## Multiple-Choice Questions

### 1. ONNX Embedding Model weights Storage & Bundling
Since vibeNote uses in-process ONNX embeddings (`ort` crate), how should the model weights (e.g., a ~100MB multilingual-MiniLM or BGE-M3 model) be packaged and loaded?

*   **[X] Option A: Direct Binary Bundling (via `include_bytes!`)**
    *   *Key Benefits:* Zero runtime setup; works 100% offline out-of-the-box; guaranteed model file integrity; no risk of download corruption or server failures.
    *   *Key Drawbacks:* Increases the Tauri executable installer and binary size by ~100MB to 150MB.
*   **[ ] Option B: Post-Install Runtime Download**
    *   *Key Benefits:* Keep the initial app installer extremely small (~10MB); allows users to download different embedding models dynamically from a settings page.
    *   *Key Drawbacks:* Requires an internet connection on first launch; introduces complex download progress state handling in the UI; risk of network failure or model server downtime.

---

### 2. Tauri Headless CLI Mode Execution (`--mcp`)
When the vibeNote binary is spawned by an IDE extension or agent with the stdio channel flag (`vibenote --mcp`), how should the application behave?

*   **[ ] Option A: Headless Command Mode (No GUI)**
    *   *Key Benefits:* Skips webview window creation and GUI loop initialization entirely; very low RAM consumption (~20MB); does not steal user focus or spawn windows when IDE starts.
*   **[X] Option B: Tray-Minimized Hybrid Mode**
    *   *Key Benefits:* Spawns the application window minimized to the system tray while directing the stdio pipe to the terminal. Allows the user to open the GUI to see live logs or graphs of what the agent is retrieving.

---

### 3. USearch HNSW Index Capacity Initialization
HNSW indexes generally require a predefined maximum capacity (maximum number of vectors) to allocate graph memory correctly. How should vibeNote handle this constraint?

*   **[X] Option A: Large Static Limit Default (e.g., 100,000 vectors)**
    *   *Key Benefits:* Simple implementation; covers 99.9% of personal note-taking workloads; zero runtime overhead.
*   **[ ] Option B: Dynamic Resizing Index Configuration**
    *   *Key Benefits:* True scalability; when SQLite counts approach 90% of current USearch capacity, the backend automatically instantiates a new USearch index with doubled capacity, copies all vectors, saves it, and deletes the old one.
    *   *Key Drawbacks:* Performance overhead when re-indexing occurs.

Additional consideration in future: when 70-80% of capacity perform defragmentation as it reduces capacity.