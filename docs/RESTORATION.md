# Alisa Studio: project-first desktop workflow

Alisa is a React + Bun coding-agent application in a Tauri shell. The current UI is project-first: each workspace has its own chats, visible plan, persistent goal, activity, changes, provider/model controls, context window meter, staged agent swarm, and a VS Code-style syntax-colored editor surface. New assistant messages show the resolved/configured model that produced them. It uses an OpenAI-compatible **Chat Completions** provider. It is not a client for the Codex subscription or the Codex app-server protocol.

## Run and verify

Requirements: Bun, Node.js, and a streaming OpenAI-compatible provider. Desktop builds also require Rust and the platform's Tauri prerequisites (Windows C++ build tools and WebView2 on Windows).

```sh
bun install --frozen-lockfile
bun test
bun run build
bun run app
```

The supported runtime is the Tauri desktop app. Tauri starts the internal Vite webview and loopback Bun backend automatically; there is no standalone browser mode. Save the provider URL, model, and key in Settings, then use **Test saved connection** to discover models. This tests `/models`, not the selected model's tool-calling capability; use a chat to verify that.

`bun run dist` builds the UI, compiles the Bun backend into a standalone executable, and includes it as a Tauri resource. Installers are in `src-tauri/target/release/bundle`. Both development and installed native app modes use Tauri's app-data directory for config and chats, so switching between them does not create a second settings store. The dev launcher imports the previous project-local config once when needed and keeps the old file untouched. Settings are written atomically to `.alisa-config.json`, flushed before replacement, and kept in three rolling private backups (`.bak1`–`.bak3`). If the primary JSON is missing or corrupt, the backend automatically restores the newest valid backup (or the legacy `.ichigo-config.json`) and archives the damaged primary for recovery.

## Available workflows

- **Project and chats:** the active project is always visible; chats are separate, searchable, renameable, pinnable, archivable, and restored per workspace.
- **Chat:** streaming responses, tool activity, cancellation, saved conversations per workspace, and new conversations that preserve history.
- **Performance:** token, thought, and terminal output are painted in animation-frame batches; tool-driven file/git refreshes are debounced; stable transcript rows are memoized to keep streaming responsive.
- **Ask / Plan:** Ask explains and inspects; Plan exposes a durable checklist and allows read-only inspection plus `update_plan` while rejecting mutations.
- **Code / Auto:** Code edits with verification guidance; Auto carries a multi-step task through to verification. Terminal calls require one-time approval and run with the logged-in OS user's permissions. Denial and cancellation return tool results to keep the conversation valid.
- **Goal and swarm:** each session can store a persistent goal with status/progress/steps. Swarm mode runs Explorer → Planner → Builder → Reviewer as separate role workers in sequence, sharing the workspace and publishing live worker state and elapsed time.
- **Workspace and editor:** folder selection, file explorer, create file/folder, multi-tab VS Code-style editor, syntax colors, active line, line numbers, breadcrumbs, keyboard indentation, Ctrl/Cmd+S, snapshots, and an integrated persistent terminal. The terminal can start a local shell in the active workspace or an SSH session through the machine's `ssh` binary; passwords and identity paths are not persisted. File tools reject traversal and symlink/junction paths outside the workspace. Active chat runs cannot change workspace or provider settings.
- **Review & Schedules:** tracked Git diff against HEAD, short status including new files, and open pull requests through an existing `gh auth login`. This view does not create, publish, or merge PRs.
- **Scheduled checks:** every 15 minutes or longer; read-only agents run while the backend is open and produce saved chats. Busy workspaces wait. Missed runs coalesce rather than replaying. Provider errors pause the schedule. Interrupted runs are paused after restart for review. Each run uses the currently saved provider/model and may incur provider usage charges.
- **Skills and local instruction plugins:** built-in skills (including preinstalled `mcp` and `computer-use` packs); Hermes user skills; `.hermes/skills/*/SKILL.md`; `.agents/skills/*/SKILL.md`. Workspace definitions override matching user definitions. The catalog and agent share discovery code. `/api/capabilities` safely reports MCP config files and available desktop input bridges without launching either.

Instruction plugins can be placed in:

```text
.alisa/plugins/my-plugin/
  .codex-plugin/plugin.json   # { "name": "My plugin" }
  skills/my-skill/SKILL.md
```

They appear as `my-plugin:my-skill` in Skills & plugins. Enable the skill to include its instructions in a task. Plugin executables and MCP server processes are not launched implicitly; MCP discovery is read-only and Computer Use remains approval/evidence driven.

## Scope of isolation

Ask mode and workspace path checks are enforced by the backend. They are not an OS/container sandbox. An approved shell command can access files or network resources outside the workspace. The direct Terminal tab is a user-controlled shell. Rollback covers supported file-tool edits, not arbitrary shell side effects. The backend is for a single trusted local OS user, not a multi-user hosted service.

Automatic Tauri updates are not configured. The app reports that limitation instead of claiming to be up to date. API keys retain the existing local plaintext storage format and must stay out of source control.

## Regression proof

`bun test` uses local mock providers and temporary workspaces. It covers streaming tool calls, provider failures, Ask/Plan safety, HTTP/WebSocket file execution and chat persistence, session metadata, path escapes, cancellation, context tool-pair integrity, and schedule overlap/failure behavior. `bun run build` runs TypeScript checking so missing components or state setters cannot silently pass a bundle build.

For repeatable checks without real credentials, use the Bun test suite. It uses local mock providers and temporary workspaces; the browser fixture and standalone web launch path were removed from V2.
