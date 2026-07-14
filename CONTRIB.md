# Contributing to vibeNote

Thank you for your interest in contributing to vibeNote! vibeNote is a local-first, privacy-respecting personal knowledge management (PKM) tool powered by local AI and the Model Context Protocol (MCP).

To maintain high code quality and smooth developer experience, please follow the guidelines below.

---

## 🛠️ Development Setup

vibeNote uses a hybrid architecture comprising a **Tauri desktop shell (Rust backend)** and a **React frontend (TypeScript)**. It embeds a local cross-lingual AI embedding model in-process.

### 1. Prerequisites

Make sure you have the following installed on your machine:
- **Rust & Cargo** (latest stable release)
- **Node.js** (v18+ recommended) and **npm**
- **OS-Specific Build Tools** (necessary for compiling native GUI library dependencies):
  - **On Ubuntu/Debian**:
    ```bash
    sudo apt update
    sudo apt install pkg-config libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev build-essential libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libdbus-1-dev
    ```
  - **On Windows**: Ensure the C++ Build Tools are installed via the Visual Studio Installer.
  - **On macOS**: Ensure Xcode Command Line Tools are installed.

### 2. Download the AI Model & Tokenizer (CRITICAL)

Because the embedding model weights and tokenizer configurations are large binary files (~118MB and ~16MB respectively), they are not checked into the git repository. **You must download these files manually before compiling the application.**

If these files are missing, Rust compilation will fail with a compilation error.

1. Download the quantized ONNX model weights:
   - **Link**: [model_quantized.onnx](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_quantized.onnx)
   - Save the file as **`model.onnx`** in the `src-tauri/` directory: `src-tauri/model.onnx`
2. Download the tokenizer configuration:
   - **Link**: [tokenizer.json](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json)
   - Save the file as **`tokenizer.json`** in the `src-tauri/` directory: `src-tauri/tokenizer.json`

---

## 🚀 Running the App Locally

Once you have installed the prerequisites and downloaded the AI model and tokenizer, you can start the development server:

1. Install frontend npm dependencies:
   ```bash
   npm install
   ```
2. Start the Tauri development environment:
   ```bash
   npm run tauri dev
   ```

This command starts the Vite dev server for the React frontend, compiles the Rust Tauri backend, and opens the application window.

---

## 🧪 Tests and Code Quality

Before opening a pull request, please verify that your changes build and pass all code quality checks.

### Frontend Quality Checks

Ensure the TypeScript compiler and Vite bundle build without errors:
```bash
npm run build
```

### Backend Quality Checks

Ensure the Rust code compiles, follows standard style, passes all tests, and runs without linter issues:

1. **Verify compilation**:
   ```bash
   cargo check
   ```
2. **Run tests**:
   ```bash
   cargo test
   ```
3. **Rust Linter**:
   ```bash
   cargo clippy -- -D warnings
   ```
4. **Rust Formatter**:
   ```bash
   cargo fmt -- --check
   ```

---

## 📥 Pull Request Guidelines

1. **Branch Naming**: Use descriptive names for branches (e.g., `feature/add-notes-export`, `bugfix/fix-search-highlighting`).
2. **Keep Commits Clean**: Write descriptive commit messages.
3. **Submit Draft PRs**: If your changes are not yet fully ready for review, feel free to open a Draft PR to gather feedback early.
