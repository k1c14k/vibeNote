# vibeNote: Deferred Implementation Questionnaire

These questions address features and optimizations that **can be deferred** to a later phase of development, once the core local-first RAG and MCP server engine are running.

---

## Multiple-Choice Questions

### 1. Calendar Sync Integration Method
How should the Calendar collection type sync with external calendar providers in the future?

*   **[ ] Option A: Standard CalDAV Protocol Integration**
    *   *Key Benefits:* Self-hosted friendly (Nextcloud, Fastmail, Apple Calendar); open protocol; maintains privacy without introducing third-party SaaS SDK dependencies.
*   **[ ] Option B: Native Cloud Integrations (Google Calendar & Microsoft Graph APIs)**
    *   *Key Benefits:* Simplest configuration workflow for mainstream users; rich API features; supports webhook push notifications for real-time local updates.
*   **[ ] Option C: Local-Only File Import/Export (iCal/ICS format)**
    *   *Key Benefits:* Safest and easiest to implement; zero network requests needed; fully offline.

---

### 2. Tagging & Taxonomy Architecture
How should tags and semantic taxonomy be integrated if added in the future?

*   **[ ] Option A: Parsing File Frontmatter (Obsidian-Style)**
    *   *Key Benefits:* Interoperable with other markdown tools; tags reside directly inside the raw files on disk; easily indexed into SQLite on file changes.
*   **[ ] Option B: LLM-Driven Automated Entity Tagging**
    *   *Key Benefits:* Zero friction for the user; the local model extracts concepts and keywords automatically during ingestion and populates metadata tables.

---

### 3. Multi-Device Synchronization Strategy
How will users keep their Vibes synchronized across multiple machines (desktop, laptop, mobile)?

*   **[ ] Option A: Third-Party Storage Sync (iCloud, Dropbox, Syncthing, Git)**
    *   *Key Benefits:* Zero server cost; fully client-controlled; leveraging proven synchronization software that is already running on the user's computer.
*   **[ ] Option B: Custom End-to-End Encrypted (E2EE) Sync Protocol**
    *   *Key Benefits:* Provides a seamless, native user experience; allows for partial syncs (e.g., syncing metadata without downloading gigabytes of models to mobile); monetizable service capability.

---

## Open Questions (with Proposed Solutions)

### 4. Local LLM Orchestration & Inference Engine
*   **Question:** How does vibeNote direct inference queries when interacting with agents or compiling responses locally?
*   **Proposed Solution:**
    Rather than packaging or managing local LLM weights (e.g., Llama-3 8B) inside the vibeNote bundle, the application will provide configuration fields pointing to local API providers. It will default to standard ports of **Ollama** (`http://localhost:11434/v1`) or **Jan.ai** (`http://localhost:1337/v1`) using OpenAI-compatible payload schemas.
    *   *Why?* Keeps the application installer small, avoids redundant execution of multiple LLM servers, and respects resources of the local host machine.

### 5. Database Schema Migration Mechanism
*   **Question:** How do we handle Vibe SQLite database schema updates safely without breaking local user data?
*   **Proposed Solution:**
    Keep migrations simple. Use SQLite `PRAGMA user_version` to track schema changes. During startup, run a migration checker script that applies incremental SQL change files.
    *   *Fallibility Protection:* Since the raw files (`.md` / JSON) remain the ultimate source of truth, if a migration fails, the system can simply rename the corrupted `vibe.db` file to a backup and rebuild the indexes/databases from scratch by scanning the raw piece directory.

### 6. Automatic Vector Index Reconstruction
*   **Question:** What happens if the USearch index file (`vibe.usearch`) is deleted, corrupted, or desynchronized from the SQLite database?
*   **Proposed Solution:**
    Implement a self-healing loading routine. During Vibe loading, if the `vibe.usearch` file is missing or corrupted, the Rust backend will:
    1. Scan the SQLite `pieces` table for all active records.
    2. Re-compute vector embeddings for each file on disk.
    3. Rebuild the HNSW index in memory.
    4. Save the reconstructed index back to `vibe.usearch`.

### 7. GUI State Synchronization on External MCP Updates
*   **Question:** If an external agent (like Jan.ai) creates, modifies, or deletes a note via the vibeNote MCP tool interfaces, how does the Tauri GUI react and refresh?
*   **Proposed Solution:**
    The Rust backend will utilize a file system watcher (e.g., via the **`notify`** crate) or database triggers to detect updates. When a modification is registered, the backend will broadcast a Tauri event (e.g. `app.emit("vibe-updated", ...)`), prompting the frontend to reload active views.

### 8. Custom Metadata Schemas for PIM/Calendar Collections
*   **Question:** Can users define custom fields for contact or calendar entries beyond standard vCard/iCal formats?
*   **Proposed Solution:**
    Use a SQLite **JSON column** named `metadata` in the `pieces` table. The GUI will parse and display custom fields dynamically from the JSON document, allowing arbitrary key-value extensions without changing SQL table schemas.

### 9. Natural Language Conversion Templates for Structured Data
*   **Question:** How should JSON contact/calendar properties be formatted into natural language text for vectorization?
*   **Proposed Solution:**
    Implement structured format string templates inside the Rust backend (e.g., standard format blocks for vCards and iCal events). In the future, this can be exposed as user-customizable liquid or handlebars template files stored in `<vibe_path>/templates/<category_id>.txt` to let users control model focus.

### 10. Dynamic JSON Attributes Query Engine
*   **Question:** How can external tools search by specific JSON attributes of contact/calendar pieces (e.g., "Find all contacts in the engineering department") relational-style?
*   **Proposed Solution:**
    Leverage SQLite's native JSON1 extension functions. vibeNote will index the key attributes under the `metadata` JSON column. The MCP `search_category` and `search_vibe` tools will accept a `metadata_filter` parameter that constructs queries using SQLite's `json_extract(metadata, '$.department') = 'Engineering'`.

### 11. USearch Index Defragmentation Strategy
*   **Question:** How and when should vibeNote perform index defragmentation to reclaim capacity when it reaches 70-80% capacity?
*   **Proposed Solution:**
    When the number of active vectors in the USearch index reaches 70–80% of the 100,000 capacity limits (or after a cumulative threshold of Piece deletions), the backend will trigger a background defragmentation task:
    1. Read all active records from SQLite.
    2. Build a brand new, clean USearch HNSW graph in memory, inserting only the active vectors.
    3. Serialize the clean index to a temporary file (`vibe.usearch.tmp`).
    4. Replace the old `vibe.usearch` file atomically on disk.
    This safely purges deleted nodes and keeps the graph lookup structures clean.
