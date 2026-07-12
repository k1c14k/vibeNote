# vibeNote: MVP Epic Breakdown

This document outlines the development phases (Epics) for building the first version (MVP) of vibeNote. The focus is on a functional, local-first engine written in Rust, wrapped in Tauri, leveraging USearch and in-process ONNX embeddings.

---

## Architecture & Data Flow Overview

```
                        +----------------------------+
                        |     Tauri GUI Client       |
                        +----------------------------+
                                      || IPC Commands
                                      \/
                        +----------------------------+
  MCP Stdio Client ---->|  Rust Core Backend Engine  |<---- MCP SSE Client
                        +----------------------------+
                          |            |           |
                          v            v           v
             +---------------+  +------------+  +--------------+
             | SQLite DB     |  | Raw Files  |  | USearch Index|
             | (Metadata &   |  | (.md, .vcf,|  | (100k HNSW   |
             | Relations)    |  |  .ics)     |  |  Vectors)    |
             +---------------+  +------------+  +--------------+
```

---

## Epic 1: Project Initialization & Core SDK Tooling
Establish the workspace structure, Cargo configurations, compilation hooks, and DB schemas.

*   **Task 1.1: Rust Cargo Workspace Setup**
    *   Initialize Tauri workspace structure.
    *   Configure dependencies in `Cargo.toml`: `tauri`, `rusqlite`, `ort` (ONNX bindings), `usearch`, `uuid`, `serde`, `serde_json`, `notify` (fs watcher), and `ical`.
*   **Task 1.2: Embedding Model Binary Bundling**
    *   Integrate a lightweight multilingual ONNX embedding model (e.g. `multilingual-MiniLM-L12-v2` or `BGE-M3-small`) into the build system.
    *   Configure Rust compile-time loading via `include_bytes!` to compile weights directly inside the Tauri binary.
*   **Task 1.3: SQLite Database Migrations**
    *   Implement a lightweight migration runner utilizing SQLite's `user_version` PRAGMA.
    *   Create base migration schema scripts: `categories`, `pieces`, `piece_history`, `relations` tables.

---

## Epic 2: Core Storage & Lifecycle Engine (Local-First Engine)
Build physical file storage logic, SQLite transactions, and the append-only/immutable Piece history model.

*   **Task 2.1: Categories Manager**
    *   Implement creation of flat directory categories (e.g., `<vibe_path>/contacts_work/`, `<vibe_path>/notes/`).
    *   Prevent category nesting and register categories into SQLite `categories` metadata.
*   **Task 2.2: Plain Text Piece Ingestion**
    *   Write raw text pieces to `<vibe_path>/<category>/<piece_id>.md` on disk.
    *   Insert metadata record in SQLite `pieces` table with status `is_active = 1`.
*   **Task 2.3: Immutable Versioning Updates (Replacement & Extensions)**
    *   *Replacement Flow:* Tombstone the current piece in SQLite (`is_active = 0`), write a new piece file to disk, and register it in `piece_history` linked as `'replacement'`.
    *   *Extension Flow:* Keep the parent active, write a new piece file, and insert a row in `relations` mapping it as `'extension_of'`.
*   **Task 2.4: Relations & Link Builder**
    *   Implement database endpoints to build semantic links between Pieces (nodes) and update the `relations` table.

---

## Epic 3: Structured Data Ingestion Pipeline (PIM & Calendar)
Process structured JSON inputs into physical file formats (vCard, iCal) and index metadata.

*   **Task 3.1: JSON to vCard (.vcf) Ingestion**
    *   Design JSON payload validation schema for Contact cards.
    *   Implement serializer converting contact JSON properties to standard `.vcf` format.
    *   Save `.vcf` file under category directory, extract metadata (Name, Email, Phone), and index into SQLite.
*   **Task 3.2: JSON to iCal (.ics) Ingestion**
    *   Design JSON validation schema for Calendar events.
    *   Implement serializer converting event JSON properties to standard `.ics` format.
    *   Save `.ics` file under category directory, extract metadata (Event Title, Start Date, End Date), and index into SQLite.
*   **Task 3.3: Natural Language Conversion Engine**
    *   Write compile-to-text converters that translate Contact and Calendar JSON entities into standard descriptive natural language paragraphs to prepare them for embedding generation.

---

## Epic 4: Vector Index & In-Process Embedding Engine (RAG)
Assemble ONNX runtime loading, validation limits, USearch index execution, and semantic search.

*   **Task 4.1: Two-Step Ingestion Validation**
    *   Implement fail-fast validation: immediately reject inputs exceeding 2,000 characters.
    *   Implement precise tokenization check: load ONNX tokenizer, check token count, and reject if it exceeds 800 tokens limit.
*   **Task 4.2: USearch Index Controller**
    *   Initialize USearch HNSW graph index with a static limit configuration of 100,000 vectors.
    *   Serialize index to `<vibe_path>/vibe.usearch` on changes.
*   **Task 4.3: Write-Through Transaction Coordinator**
    *   Coordinate transactional write updates: SQLite changes write first -> memory index updates second -> index file saves to disk third -> commit SQLite transaction on success, or roll back on save failure.
*   **Task 4.4: Semantic Vector Query Engine**
    *   Compute vector query embeddings in Rust using the ONNX model.
    *   Run cosine similarity search against USearch HNSW graph to get matching Piece IDs.
    *   Filter results using SQLite parameters (Category filtering, metadata, and status checks).

---

## Epic 5: Hybrid Model Context Protocol (MCP) Server
Integrate tool execution over SSE and stdio CLI pipes.

*   **Task 5.1: Rust-Native MCP Router**
    *   Build a request handler responding to MCP server actions (tools listing, tools execution).
    *   Implement tools: `search_vibe`, `search_category`, `create_piece`, `get_piece_details`, `link_pieces`, `get_relations_graph`.
*   **Task 5.2: Stdio CLI Mode (`--mcp`) & System Tray Shell**
    *   If arguments contain `--mcp`, launch Tauri in **Tray-Minimized Hybrid Mode** (no primary window spawned, running background stdio pipe loops, showing an icon in the tray).
*   **Task 5.3: Background SSE Server**
    *   Expose local SSE HTTP server inside Tauri backend thread, allowing concurrent agent client tool calls.

---

## Epic 6: User Interface (Tauri Frontend)
Develop user interfaces for browsing, editing, searching, and visualizing notes.

*   **Task 6.1: Workspace Manager**
    *   Folder picker allowing users to open/create a Vibe directory locally.
*   **Task 6.2: Browse & Markdown Editor**
    *   View active categories and Pieces.
    *   Built-in markdown text editor for unstructured text, and metadata card editor for Contacts & Calendar.
*   **Task 6.3: Semantic Search View**
    *   Query inputs displaying ranked search matches alongside relevance scores.
*   **Task 6.4: Interactive Graph Visualizer**
    *   Visual 2D node-graph representing Pieces and explicitly formed relation paths (e.g., using D3, vis.js, or Cytoscape).
