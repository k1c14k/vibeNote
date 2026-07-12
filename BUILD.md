# Building vibeNote

vibeNote uses a hybrid architecture comprising a Tauri desktop shell (Rust backend) and a React frontend. Additionally, it embeds a local cross-lingual AI embedding model (`paraphrase-multilingual-MiniLM-L12-v2`) in-process for 100% offline semantic search.

---

## Prerequisites

Ensure you have the following installed on your development machine:
1. **Rust & Cargo** (latest stable release)
2. **Node.js** (v18+ recommended) and **npm**
3. **OS Specific Build Tools** (e.g. gcc, pkg-config, and development headers for webkit2gtk, soup, and gtk3 on Linux).
   - On Debian/Ubuntu:
     ```bash
     sudo apt install pkg-config libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev build-essential libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libdbus-1-dev
     ```

---

## 1. Local AI Model & Tokenizer Download (CRITICAL)

Because embedding model weights and tokenizer configurations are large binary blobs (~118MB and ~16MB respectively), they are not included in the git repository. **You must download both files manually before compiling the application.**

1. Download the quantized ONNX model weights from Hugging Face:
   - **Download Link**: [model_quantized.onnx](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_quantized.onnx)
   - Save or copy the file as **`model.onnx`** inside the **`src-tauri/`** folder: `src-tauri/model.onnx`
2. Download the tokenizer configuration file from Hugging Face:
   - **Download Link**: [tokenizer.json](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json)
   - Save or copy the file as **`tokenizer.json`** inside the **`src-tauri/`** folder: `src-tauri/tokenizer.json`

If either `src-tauri/model.onnx` or `src-tauri/tokenizer.json` is missing at build time, the Rust compilation will fail with a file-not-found error because the build uses `include_bytes!` to bundle the weights and config directly inside the final binary.

---

## 2. Dev Environment Build

1. Install frontend npm dependencies:
   ```bash
   npm install
   ```
2. Start the Tauri development server:
   ```bash
   npm run tauri dev
   ```
   This command starts the Vite dev server for the React frontend, compiles the Rust Tauri backend, and opens the native application window.

---

## 3. Production Release Build

To build a production installer/bundle of vibeNote:
```bash
npm run tauri build
```
The compiled installers will be located under `src-tauri/target/release/bundle/`.
