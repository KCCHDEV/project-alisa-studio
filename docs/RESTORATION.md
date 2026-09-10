# Alisa Studio: restored desktop workflow

Alisa is a React + Bun coding-agent application in a Tauri shell. It uses an OpenAI-compatible **Chat Completions** provider. It is not a client for the Codex subscription or the Codex app-server protocol.

## Run and verify

Requirements: Bun, Node.js, and a streaming OpenAI-compatible provider. Desktop builds also require Rust and the platform's Tauri prerequisites (Windows C++ build tools and WebView2 on Windows).

```sh
bun install --frozen-lockfile
bun test
bun run build
bun run tauri:dev
```

Web development: `bun run dev:all`, then open `http://127.0.0.1:3050`. The backend listens on loopback port 3001. Save the provider URL, model, and key in Settings, then use **Test saved connection** to discover models. This tests `/models`, not the selected model's tool-calling capability; use a chat to verify that.

`bun run dist` builds the UI, compiles the Bun backend into a standalone executable, and includes it as a Tauri resource. Installers are in `src-tauri/target/release/bundle`. The installed app stores config and chats in Tauri's app-data directory; source development keeps existing project-local config and migrates the previous per-workspace chat file without deleting it.

## Available workflows

- **Chat:** streaming responses, tool activity, cancellation, saved conversations per workspace, and new conversations that preserve history.
- **Ask:** only read/search/list/skill tools are available; execution rejects mutations even if a provider returns them anyway.
- **Code:** workspace file tools can edit files. Terminal calls require one-time approval and run with the logged-in OS user's permissions. Denial and cancellation return tool results to keep the conversation valid.
- **Workspace:** folder selection, file tree, editor, terminal, and snapshots. File tools reject traversal and symlink/junction paths outside the workspace. Active chat runs cannot change workspace or provider settings.
- **Review & Schedules:** tracked Git diff against HEAD, short status including new files, and open pull requests through an existing `gh auth login`. This view does not create, publish, or merge PRs.
- **Scheduled checks:** every 15 minutes or longer; read-only agents run while the backend is open and produce saved chats. Busy workspaces wait. Missed runs coalesce rather than replaying. Provider errors pause the schedule. Interrupted runs are paused after restart for review. Each run uses the currently saved provider/model and may incur provider usage charges.
- **Skills and local instruction plugins:** built-in skills; Hermes user skills; `.hermes/skills/*/SKILL.md`; `.agents/skills/*/SKILL.md`. Workspace definitions override matching user definitions. The catalog and agent share discovery code.

Instruction plugins can be placed in:

```text
.alisa/plugins/my-plugin/
  .codex-plugin/plugin.json   # { "name": "My plugin" }
  skills/my-skill/SKILL.md
```

They appear as `my-plugin:my-skill` in Skills & plugins. Enable the skill to include its instructions in a task. Plugin executables, MCP servers, service connectors, and marketplace installation are not implemented.

## Scope of isolation

Ask mode and workspace path checks are enforced by the backend. They are not an OS/container sandbox. An approved shell command can access files or network resources outside the workspace. The direct Terminal tab is a user-controlled shell. Rollback covers supported file-tool edits, not arbitrary shell side effects. The backend is for a single trusted local OS user, not a multi-user hosted service.

Automatic Tauri updates are not configured. The app reports that limitation instead of claiming to be up to date. API keys retain the existing local plaintext storage format and must stay out of source control.

## Regression proof

`bun test` uses local mock providers and temporary workspaces. It covers streaming tool calls, provider failures, HTTP/WebSocket file execution and chat persistence, path escapes, cancellation, context tool-pair integrity, and schedule overlap/failure behavior. `bun run build` runs TypeScript checking so missing components or state setters cannot silently pass a bundle build.

For repeatable UI smoke testing without real credentials, start `bun run scripts/preview-fixture.ts` and `bun run dev`. Close other servers using ports 3001/3050 first. The fixture uses a temporary workspace and synthetic model responses.
