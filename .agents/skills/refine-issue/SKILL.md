---
name: refine-issue
description: Refines a GitHub issue's title and description by gathering codebase context and generating optimized details using the agent's active model.
---

# Skill: Refine Issue

This skill outlines the process for refining a GitHub issue's title and description to make them highly descriptive, clear, and actionable using local codebase context and the agent's active model.

## Steps for the Agent

When requested to refine an issue:

### Step 1: Retrieve Issue Details
Fetch the current title and description of the issue using the GitHub CLI:
```bash
gh issue view <issue_number> --json title,body
```

### Step 2: Codebase Context Gathering
1. Analyze the retrieved title and body for file paths (e.g., `App.tsx`, `sse.rs`), component names, database tables, or features.
2. Search the codebase to understand the current implementation:
   - Search for files or folders in the repository matching the mentioned components.
   - Use search tools (e.g., grep) to find related code symbols or function signatures.
   - Read the relevant parts of the files to understand the current code state.
3. Keep a summary of the relevant code lines, files, and architectural constraints.

### Step 3: Refine using Active LLM Model
Using the gathered context, formulate:
1. **Optimized Title**: A concise, descriptive title, prefixed with the component name (e.g., `Backend: ...`, `Frontend: ...`, or `mcp: ...`).
2. **Refined Description**: A structured markdown description containing:
   - **Background / Problem Statement**: The problem and why it needs fixing.
   - **Proposed Solution**: High-level technical approach.
   - **Acceptance Criteria**: A list of checklist items (`- [ ]`) defining success.
   - **Architectural/Design Constraints**: Any constraints to respect (e.g., immutability, validation limits).

### Step 4: Update the GitHub Issue
Update the issue on GitHub using the `gh` command:
```bash
gh issue edit <issue_number> --title "<refined_title>" --body "<refined_body>"
```
