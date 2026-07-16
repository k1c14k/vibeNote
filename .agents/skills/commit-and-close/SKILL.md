---
name: commit-and-close
description: Instructions and workflow for staging, committing, referencing, and pushing changes to close a GitHub issue in vibeNote.
---

# Skill: Commit and Close

This skill outlines the process for finalizing an issue implementation, ensuring code quality, and committing/pushing the changes with the correct GitHub closing hooks.

## Step 1: Pre-Commit Verification & Formatting
1. Reformat the code to ensure formatting checks will pass in the CI workflow:
   - For backend: `cargo fmt --manifest-path src-tauri/Cargo.toml`
2. Run local build checks and linters to verify that the frontend and backend both compile without errors:
   - For backend: `cargo check` and `cargo clippy` (set `PKG_CONFIG_PATH` if on Linux to compile GTK/Pango system hooks: `PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig cargo check`)
   - For frontend: `npm run build`
3. Run any unit/integration tests to ensure no regressions are introduced:
   - For backend: `cargo test`

## Step 2: Git Status & Exclusions Check
1. Run `git status` to see what files are staged, modified, or untracked.
2. Ensure that build directories (such as the workspace root `target/` and frontend `dist/` or `node_modules/` folders) are properly ignored in the root `.gitignore` and are not staged for commit.

## Step 3: Git Staging & Committing
1. Stage all relevant modifications:
   ```bash
   git add .
   ```
2. Commit with a message describing the work done, and make sure to append the closing keyword on a new line at the bottom so GitHub closes the corresponding issue:
   ```text
   <Short commit description>

   Closes #<issue_number>
   ```

## Step 4: Push to Remote & Create Pull Request
1. Push the commit to the remote feature branch (never push directly to `main` as it is a protected branch):
   ```bash
   git push -u origin <branch_name>
   ```
2. Create a pull request (PR) on GitHub using the GitHub CLI:
   ```bash
   gh pr create --title "<Meaningful title describing the work done>" --body "<Detailed pull request description including Closes #<issue_number>>"
   ```
3. Share the created PR link with the user for review.
