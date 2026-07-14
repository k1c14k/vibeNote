# vibeNote

A local-first, privacy-respecting personal knowledge management (PKM) tool powered by local AI and the Model Context Protocol (MCP).

vibeNote departs from the traditional folder hierarchy of notes, organizing information using local vector proximity search (RAG) and semantic relationships.

## Project Resources

- **Specification & Architecture:** [PROJECT_SPEC.md](doc/PROJECT_SPEC.md)
- **MVP Development Roadmap:** [MVP.md](MVP.md)
- **Immediate Questions (Round 1 - Answered):** [QUESTIONS_IMMEDIATE.md](doc/QUESTIONS_IMMEDIATE.md)
- **Immediate Questions (Round 2 - Answered):** [QUESTIONS_IMMEDIATE_2.md](doc/QUESTIONS_IMMEDIATE_2.md)
- **Immediate Questions (Round 3 - Answered):** [QUESTIONS_IMMEDIATE_3.md](doc/QUESTIONS_IMMEDIATE_3.md)
- **Deferred Questions (Can Be Decided Later):** [QUESTIONS_DEFERRED.md](doc/QUESTIONS_DEFERRED.md)

## Key Features

- **No Hierarchy:** Organic note retrieval based on vector similarity and explicitly defined relations.
- **Strict Immutability & Versioning:** Every note is an immutable "Piece." Content updates create new Pieces while keeping the evolution history intact.
- **Privacy First (Local AI):** Embeddings and models run locally using Ollama or ONNX (via transformers.js).
- **Agent Integration:** An integrated Model Context Protocol (MCP) server allows local AI assistants (like Jan.ai, Claude Desktop, Cursor) to search and interact with your notes.

## License

vibeNote is licensed under the [MIT License](LICENSE).
