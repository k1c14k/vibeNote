---
name: work-on-issue
description: Instructions and workflow for retrieving, analyzing, planning, and implementing a GitHub issue in vibeNote.
---

# Skill: Work on Issue

This skill outlines the standard workflow for developers and coding agents to follow when working on a GitHub issue in this repository.

## Step 1: Branch Setup & Retrieve Issue Details
1. Update the local `main` branch to match the remote repository:
   ```bash
   git checkout main
   git pull origin main
   ```
2. Ask the user if you should continue working on the current branch or create a new feature branch from `main`.
   - If creating a new branch, checkout a clean feature branch:
     ```bash
     git checkout -b feature/issue-<issue_number>-<short-description>
     ```
3. Read the issue details locally using the GitHub CLI:
   ```bash
   gh issue view <issue_number>
   ```
4. If `gh` is not installed or authenticated, fetch the issue details from the GitHub API using `curl`:
   ```bash
   curl -s -H "User-Agent: vibeNote-agent" https://api.github.com/repos/k1c14k/vibeNote/issues/<issue_number>
   ```

## Step 2: Codebase Research
1. Locate the files, components, or configurations mentioned in the issue.
2. Search the codebase for symbols, terms, or relevant functions using `grep` or similar search tools.
3. Check immediate architectural specs in `PROJECT_SPEC.md` or the development roadmap in `MVP.md` to ensure any proposed change aligns with design decisions.

## Step 3: Draft an Implementation Plan
1. Create or update `implementation_plan.md` in the agent artifacts directory.
2. Outline the goal, files to modify/create/delete, open questions, and the verification plan.
3. **DO NOT** make codebase changes or run modifying commands during the planning phase.
4. Present the plan to the user and wait for their explicit approval.

## Step 4: Execution & Local Verification
1. Once approved, implement changes.
2. Update the tracking task list (`task.md`).
3. Verify the changes compile successfully. Ensure that system pkg-config settings or environment parameters like `PKG_CONFIG_PATH` are set appropriately if native platform bindings (e.g. GTK, DBus, Pango) need to compile.
4. Run tests or build verification commands.
