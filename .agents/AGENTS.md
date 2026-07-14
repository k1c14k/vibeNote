# vibeNote Developer Agent Rules & Guidelines

Welcome, Agent! This document contains project-specific instructions, design rules, and workflows for building, debugging, and maintaining **vibeNote**.

---

## 📋 Project Context
- **Name**: vibeNote
- **Description**: A local-first, privacy-respecting personal knowledge management (PKM) tool powered by local AI and the Model Context Protocol (MCP).
- **Core Abstraction**: No traditional folder hierarchy. Organized organically using local vector proximity search (RAG) and semantic relationships. Every note is an immutable, versioned **Piece** (stored as physical files: plain text, `.vcf`, `.ics`).

---

## 🛠️ Technology Stack
1. **Frontend**: React (v19), TypeScript, Vite.
2. **Backend/Desktop Shell**: Tauri (v2), Rust.
3. **Database**: SQLite (via `rusqlite` with migrations).
4. **Vector Search**: `USearch` HNSW index.
5. **Local Embeddings**: `ort` (ONNX Runtime bindings) running the quantized `paraphrase-multilingual-MiniLM-L12-v2` model.

---

## ⚙️ Building and Compiling
### CRITICAL PRE-BUILD STEP (Local AI Weights)
Because embedding model weights and tokenizer configurations are large binary blobs, they are not stored in Git. You **MUST** ensure these are present before building or compilation:
- **Model weights**: Downloaded and saved as `src-tauri/model.onnx`.
- **Tokenizer**: Downloaded and saved as `src-tauri/tokenizer.json`.
*Failure to have these files will cause the Rust build/compilation to fail because they are embedded using `include_bytes!`.*

### Build/Development Commands
- **Install Dependencies**: `npm install`
- **Development Server**: `npm run tauri dev` (runs Vite dev server, compiles Rust backend, launches desktop window)
- **Production Build**: `npm run tauri build`

---

## 🎨 User Interface & Styling Guidelines
- **Framework**: React.
- **Styling**: **Vanilla CSS**. DO NOT use Tailwind CSS unless the user explicitly requests it.
- **Aesthetic Direction**: Premium, rich aesthetics:
  - Sleek dark/light modes.
  - Vibrant, curated colors (use HSL or CSS variables).
  - Smooth gradients, subtle animations/transitions, glassmorphism.
  - Custom Google Fonts (e.g., Inter, Outfit).
  - Ensure all components are responsive and highly interactive.
- **No Placeholders**: Never use placeholder images. If you need UI illustrations/assets, use the `generate_image` tool to create them.

---

## 🧠 Development & Architectural Constraints
- **Strict Immutability**:
  - Do not edit active Pieces directly. Updates are performed by marking the current piece inactive in SQLite (`is_active = 0`) and writing a new Piece file to disk, registered in `piece_history` as a `replacement` or `extension_of`.
- **Ingestion Boundaries**:
  - Text pieces must not exceed 2,000 characters (fail-fast validation) or 800 tokens (ONNX tokenizer check).
- **Transactions**:
  - Coordinate writes transactionally: write to SQLite -> update memory index -> serialize USearch index to disk -> commit SQLite transaction on success, or roll back.

---

## 🤝 Workspace Agent Skills
If you are resolving issues, implementing new features, or committing changes, you **must** use the following project-specific agent skills:
- **`work-on-issue`**: Follow instructions under `.agents/skills/work-on-issue/SKILL.md` to retrieve, plan, and execute issue implementation.
- **`commit-and-close`**: Follow instructions under `.agents/skills/commit-and-close/SKILL.md` for staging, committing, and closing issues.
