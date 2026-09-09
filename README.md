# 🍓 Project Alisa Studio

**A desktop AI coding and automation workspace built with TypeScript, Bun, React, and Electron.**

Project Alisa Studio brings streaming AI chat, local file tools, terminal execution, and project chat history into one dark desktop interface. It connects to an OpenAI-compatible model provider or gateway, including OpenRouter and OmniRoute. The repository contains the application source; model weights and provider subscriptions are not included.

> โปรเจกต์ผู้ช่วยเขียนโค้ดและทำงานอัตโนมัติบนเครื่องของคุณ รองรับการตั้งค่าโมเดลผ่าน API พร้อมเครื่องมือจัดการไฟล์ เทอร์มินัล ประวัติแชต และหน้าต่างเดสก์ท็อป

## Features

- **Streaming chat:** displays model responses, reasoning when supplied by the provider, tool activity, and agent status.
- **Agent workflow:** a bounded multi-step loop with context preparation, context compaction, and cancellation.
- **Workspace tools:** read, write, patch, list, and search files; execute shell commands with timeouts.
- **Project history:** server-side chat files keyed by workspace, plus support for legacy sessions.
- **File rollback:** snapshots before supported file write/patch operations, with a latest-change rollback action.
- **Model configuration:** editable API key, base URL, and model identifier, with gateway presets in Settings.
- **Skills:** discovers local Hermes-style `SKILL.md` files and creates five starter skill documents on server startup. Skill documents are instructions, not separately implemented autonomous workers.
- **Desktop integration:** Electron window controls and Touch Bar actions/status on compatible MacBook hardware.
- **Packaging:** electron-builder configuration for Windows NSIS/portable builds and macOS DMG/ZIP builds.

## Requirements

- [Bun](https://bun.sh/) and Node.js 20 or newer; Git to clone the repository.
- An OpenAI-compatible chat-completions endpoint and a model supporting streaming and tool calling.
- Your own provider credentials. Provider availability, supported model IDs, and usage costs depend on your account.

## Run from source

Clone this repository with GitHub Desktop, open a terminal in its folder, and install dependencies:

```sh
bun install --frozen-lockfile
```

### Desktop app

```sh
bun run build
bunx --no-install electron .
```

Electron starts the bundled backend and loads the built UI. Open **Settings** to configure your provider and workspace before asking the agent to work.

### Web development

Use two terminals in the repository folder:

```sh
# Terminal 1: backend on port 3001
bun run server
```

```sh
# Terminal 2: Vite frontend on port 3000
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Vite proxies API and WebSocket traffic to the backend. Run either desktop mode or the separate backend, since both use port 3001.

## Model and gateway setup

In **Settings**, enter the API key, base URL, exact model ID, and an existing workspace directory, then save.

| Setting | Example / meaning |
| --- | --- |
| Base URL | `https://openrouter.ai/api/v1`, or your gateway's OpenAI-compatible API base |
| Model | An exact identifier listed by your provider; the initial default is `deepseek/deepseek-chat` |
| API key | Your own provider key; never include it in a commit or screenshot |
| Workspace | The local directory where the agent should work |

The client appends `/chat/completions` to the base URL. Some OmniRoute routes require a provider-prefixed model ID. Model names in the UI are suggestions and may not be enabled on every gateway.

The server can read `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) and `OPENAI_BASE_URL`. A detected local Hermes configuration supplies startup defaults; saved `.ichigo-config.json` settings override startup defaults. The UI's Save action writes this local file. Keys are stored locally in plaintext, so keep the configuration private.

For the CLI:

```sh
bun run cli
```

The CLI uses the same API-key/base-URL environment variables and `ICHIGO_MODEL` for its model. It does not load the desktop Settings file. Type `exit` or `quit` to leave.

## Modules and data flow

`React UI → HTTP / WebSocket server → Agent loop → LLM client → tool calls → local files / shell`

| Path | Responsibility |
| --- | --- |
| `src/web/` | React studio, chat, settings, workspace browser, and activity display |
| `src/server/index.ts` | HTTP API, WebSocket events, configuration, session files, and static UI serving |
| `src/core/agent.ts` | Agent lifecycle, model requests, tool execution, and cancellation |
| `src/core/context.ts` / `compactor.ts` | Prompt context and history compaction |
| `src/core/security.ts` | Pattern-based checks for selected commands and secret formats |
| `src/core/snapshot.ts` | File snapshots and in-process latest-change rollback history |
| `src/llm/client.ts` | OpenAI-compatible streaming chat and tool-call parsing |
| `src/tools/` | Tool registry, terminal, file operations, search, and skill loading |
| `src/electron/` | Desktop lifecycle, preload IPC bridge, and macOS Touch Bar |
| `src/cli/` | Terminal chat interface |
| `public/landing.html` | Promotional page and interactive Touch Bar simulator |
| `.github/workflows/ci-build.yml` | Windows/macOS build and artifact workflow |

Some internal names retain the original **Ichigo Agent** name for compatibility. The public project name is **Project Alisa Studio**.

## Build and package

| Command | Output |
| --- | --- |
| `bun run build` | Web assets in `dist/` and backend/Electron bundles in `dist-electron/` |
| `bun run dist:win` | Windows installer and portable executable in `release/` |
| `bun run dist:nsis` | Windows NSIS installer |
| `bun run dist:mac` | macOS DMG and ZIP, configured for x64 and arm64 |
| `bun run dist:dir` | Unpacked Windows application |

Use the matching operating system for packaging. macOS signing is not configured. The GitHub Actions workflow runs for pushes to `main`, pull requests targeting `main`, and `v*` tags. It uploads build artifacts; it does not automatically publish GitHub Releases.

## Current limitations and local data

This is a local development application, not a hardened hosted service. Its backend has no authentication, uses permissive CORS, and exposes configuration and tool execution. Do not expose port 3001 to untrusted networks. Agent commands run with your operating-system permissions; review changes and work in backed-up repositories.

Despite the class name `ASTSecurityGatekeeper`, the current checks use regular expressions, not AST parsing or complete syntax validation. Rollback covers supported file tools, not arbitrary terminal effects, and the in-memory rollback stack does not survive restart. Model failures currently end the task; automatic model failover and persistent retry are not implemented. macOS packaging and Touch Bar code are present, but Windows build success alone does not verify macOS behavior. Hermes skill paths currently follow a Windows-style layout.

Local configuration, chat history, snapshots, dependencies, and generated installers are excluded from Git. Relevant private paths are `.ichigo-config.json`, `config.json`, `.ichigo-sessions/`, `.alisa-sessions/`, and `.ichigo-snapshots/`.

## Contributing and license

When reporting an issue, include the operating system, relevant command, expected result, and redacted error output. Never attach API keys or private chat history. For changes, describe the behavior and verification; run `bun run build` before submitting.

No license has been selected for this repository yet. Public visibility does not itself grant an open-source license.
