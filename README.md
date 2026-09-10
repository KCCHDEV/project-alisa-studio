> **Current runtime: Tauri + Bun.** The repository is migrating from Electron; the older overview below describes the previous release. For current commands, working features, isolation limits, and local plugins, see [Restored workflow](docs/RESTORATION.md).
>
> Start: `bun install --frozen-lockfile` → `bun run tauri:dev`. Web: `bun run dev:all` at `http://127.0.0.1:3050`. Verify: `bun test` and `bun run build`. Package: `bun run dist`.

<div align="center">

<img src="public/avatar.png" width="180" alt="Project Alisa Studio mascot" />

# ✦ Project Alisa Studio

### Cute desktop AI coding workspace for real projects, local tools, and OmniRoute

**Codex-style workflow · Streaming Agent · Local Files & Terminal · OpenAI-compatible Gateway**

[![CI](https://github.com/KCCHDEV/project-alisa-studio/actions/workflows/ci-build.yml/badge.svg)](https://github.com/KCCHDEV/project-alisa-studio/actions/workflows/ci-build.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?logo=bun&logoColor=111)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111)
![Electron](https://img.shields.io/badge/Electron-desktop-47848F?logo=electron&logoColor=white)
![OmniRoute](https://img.shields.io/badge/Gateway-OmniRoute-EF8FBD)

**AI / Code / Create / Automate — together.**

</div>

---

## 🌸 Project Alisa คืออะไร?

**Project Alisa Studio** คือ Desktop AI Coding & Automation Workspace ที่ตั้งใจทำให้ใช้งานใกล้เคียงแอป coding agent สมัยใหม่แบบ **Codex-style** มากกว่าแชตบอทธรรมดา

Alisa ทำงานกับโฟลเดอร์โปรเจกต์จริงบนเครื่องได้ มี Chat, Agent, File Explorer, Editor, Terminal, Skills, Project History และการเชื่อมต่อโมเดลผ่าน **OpenAI-compatible API** เช่น **OmniRoute** หรือ OpenRouter อยู่ในแอปเดียว

> เป้าหมายคือ “เปิดโปรเจกต์ → บอกเป้าหมาย → ให้ Alisa อ่านโค้ด แก้ไฟล์ รันคำสั่ง ตรวจผล และทำงานต่อจนจบ” โดยเรายังเห็นสถานะและการใช้เครื่องมือตลอดเวลา

Repository นี้มีเฉพาะ source code ของแอป ไม่รวม model weights, API credits หรือ subscription ของ provider

---

## ✨ จุดเด่น

| | Feature | รายละเอียด |
| --- | --- | --- |
| 🧠 | **Agent Loop** | ทำงานแบบหลายรอบ: วิเคราะห์ → เรียก tool → อ่านผล → ทำงานต่อ |
| 💬 | **Streaming Chat** | แสดงข้อความ, reasoning field ที่ provider ส่งมา, tool activity และ status แบบ realtime |
| 📁 | **Project Workspace** | เลือกโฟลเดอร์โปรเจกต์ แล้วอ่าน/ค้นหา/แก้ไฟล์ภายใน workspace |
| 🛠️ | **Local Tools** | File read/write/patch/search และ terminal command พร้อม timeout |
| ↩️ | **Snapshots / Rollback** | เก็บ snapshot ก่อน file write/patch ที่รองรับ เพื่อย้อนการแก้ไขล่าสุด |
| 🧩 | **Skills** | โหลด Hermes-style `SKILL.md` และ workspace skills |
| 🕘 | **Project History** | เก็บบทสนทนาตาม workspace ทำให้แต่ละโปรเจกต์มี history ของตัวเอง |
| ⚡ | **OmniRoute Ready** | ใช้ base URL + API key + model route เช่น `auto/best-coding` |
| 🖥️ | **Desktop App** | Electron สำหรับ Windows/macOS พร้อมระบบ in-app update ผ่าน GitHub Releases |
| 🎀 | **Cute Developer Identity** | UI โทนมืดสำหรับเขียนโค้ด ผสม pink / blue / violet แบบ Yurachi-inspired |

---

## 🪄 Workflow ที่ตั้งใจให้เป็น

```text
Open Project
    ↓
Ask Alisa for a goal
    ↓
Prepare context + active skills
    ↓
Stream model response
    ↓
Tool calls?
 ┌──┴──┐
 No   Yes
 │     ↓
Done  Files / Search / Terminal
       ↓
   Return tool result
       ↓
   Continue agent loop
```

Data flow หลักของแอป:

```text
React Studio
   ↕ HTTP / WebSocket
Local Bun Server
   ↓
Agent Loop
   ↓
LLM Client
   ↓
OpenAI-compatible Gateway
   ↓
OmniRoute / OpenRouter / compatible provider

Agent Tools
   ├─ local files
   ├─ project search
   ├─ terminal
   ├─ snapshots
   └─ skills
```

---

## 💗 OmniRoute

Alisa รองรับ endpoint แบบ OpenAI-compatible อยู่แล้ว โดย LLM client ส่ง streaming request ไปที่:

```text
{BASE_URL}/chat/completions
```

ตัวอย่างการตั้งค่า OmniRoute:

```text
Base URL : http://YOUR_OMNIROUTE_HOST:PORT/v1
API Key  : your-key
Model    : auto/best-coding
```

ถ้า OmniRoute ของคุณเปิด API ใต้ `/v1` ให้ใส่ `/v1` ใน Base URL ด้วย

### Route ที่เหมาะกับ model picker

| Route | ใช้กับงาน |
| --- | --- |
| `auto/best-coding` | ค่าเริ่มต้นสำหรับ coding agent |
| `auto/best-coding-fast` | coding ที่ต้องการความเร็ว |
| `auto/best-reasoning` | debugging / architecture ยาก ๆ |
| `auto/best-fast` | งานสั้น ๆ และตอบเร็ว |
| `auto/best-vision` | งาน vision เมื่อ backend รองรับ |
| `auto/best-chat` | คุยทั่วไป |
| `auto/pro-coding` | premium coding route |
| `auto/pro-reasoning` | premium reasoning route |

บาง OmniRoute instance อาจต้องใช้ **exact provider-prefixed model ID** แทน route กลาง หาก gateway แจ้งว่า model/provider ambiguous ให้เลือก exact route ที่ instance นั้นประกาศ

📘 แผนการทำ OmniRoute ให้เป็น first-class integration และ UX แบบ Codex-style อยู่ที่ **[docs/CODEX-OMNIROUTE.md](docs/CODEX-OMNIROUTE.md)**

---

## 🧠 Agent ปัจจุบันทำงานอย่างไร

Agent ใช้ bounded ReAct-style loop โดยแต่ละ cycle จะเตรียม context, ใส่ active skills, เรียก LLM แบบ streaming, รับ tool calls, รัน tools แล้วใส่ผลกลับเข้า conversation เพื่อให้โมเดลทำงานต่อ

ปัจจุบันมี:

- automatic context compaction สำหรับ session ที่ยาว;
- streamed answer text;
- รองรับ `reasoning_content` / `thought` เมื่อ provider ส่งมา;
- OpenAI-style streamed tool calls;
- cancel/abort;
- agent statuses เช่น thinking / acting / done / error;
- file snapshots สำหรับ supported writes;
- project-scoped chat sessions;
- built-in + Hermes-style skills.

> `subagent-orchestration` ตอนนี้เป็น **skill/instruction layer** ยังไม่ใช่ worker agent แยก process จริง ๆ

---

## 🎛️ หน้าหลักของแอป

- **Sessions** — งานและบทสนทนาของโปรเจกต์
- **Files** — file tree + editor
- **Chat** — streaming conversation + agent activity
- **Terminal** — command execution/output
- **Skills** — เลือก skill ที่ใช้กับ agent
- **Model Picker** — เปลี่ยน model/route เร็ว ๆ
- **Settings** — API key, base URL, model, workspace, updater

Command-style actions ที่มีใน UI เช่น:

```text
/goal       วางแผนและทำ coding goal
/test       ทดสอบงาน
/audit      ตรวจ security concerns
/refactor   ปรับโครงสร้าง code
/rollback   ย้อน supported file change ล่าสุด
/skills     จัดการ skills
/build      build desktop app
/clear      ล้าง terminal logs
```

---

## 🚀 Run from source

### Requirements

- Bun
- Node.js 20+
- Git
- OpenAI-compatible chat-completions endpoint
- model ที่รองรับ streaming; ถ้ารองรับ tool calling จะใช้งาน agent ได้เต็มกว่า

### Install

```bash
git clone https://github.com/KCCHDEV/project-alisa-studio.git
cd project-alisa-studio
bun install --frozen-lockfile
```

### Desktop

```bash
bun run start:electron
```

หรือ:

```bash
bun run build
bunx --no-install electron .
```

### Web development

Terminal 1:

```bash
bun run server
```

Terminal 2:

```bash
bun run dev
```

```text
Frontend : http://localhost:3000
Backend  : http://localhost:3001
```

---

## ⚙️ Provider configuration

เปิด **Settings** แล้วตั้งค่า:

| Setting | Example |
| --- | --- |
| Base URL | `http://127.0.0.1:10009/v1` |
| Model | `auto/best-coding` |
| API Key | key ของ gateway/provider |
| Workspace | โฟลเดอร์โปรเจกต์ที่มีอยู่จริง |

Startup defaults รองรับ environment variables:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=http://127.0.0.1:10009/v1
```

รองรับ `OPENROUTER_API_KEY` เช่นกัน และ local Hermes config อาจถูกใช้เป็น startup fallback ส่วน settings ที่ save ในแอปจะ override ค่าเริ่มต้น

> ตอนนี้ API key ใน desktop config ยังเก็บเป็น plaintext บนเครื่อง ควรเก็บไฟล์ config เป็น private และห้าม commit

---

## 📦 Build / Package

| Command | Output |
| --- | --- |
| `bun run build` | Web + server/Electron bundles |
| `bun run dist:win` | Windows NSIS + portable |
| `bun run dist:nsis` | Windows installer |
| `bun run dist:mac` | macOS DMG + ZIP |
| `bun run dist:dir` | unpacked Windows app |

Output อยู่ใน `release/`

Updater ของ installed app ใช้ GitHub Releases และ release tags รูปแบบ `v*`

---

## ✅ CI / Release

```text
Pull Request
   └─ Verify build

Push main
   ├─ Verify build
   ├─ Package Windows
   └─ Package macOS

Tag v*
   ├─ Verify build
   ├─ Publish Windows release
   └─ Publish macOS release
```

CI ใช้ permission แบบ read-only เป็นค่าเริ่มต้น และให้ `contents: write` เฉพาะ release jobs

---

## 🗂️ Structure

```text
src/
├─ web/       React studio UI
├─ server/    local HTTP + WebSocket backend
├─ core/      agent / context / compaction / security / snapshots
├─ llm/       OpenAI-compatible streaming client
├─ tools/     file / terminal / search / skill tools
├─ electron/  desktop lifecycle / IPC / updater
└─ cli/       terminal chat interface

docs/         product + integration + visual documentation
public/       app assets
.github/      CI / release workflows
```

---

## 🌷 Roadmap

ทิศทางหลักคือทำให้ Alisa เป็น **cute but serious desktop coding agent**:

- first-class OmniRoute profile;
- Test Connection;
- `/models` discovery พร้อม fallback;
- grouped model picker: Coding / Reasoning / Fast / Vision / Chat;
- exact provider-route recovery;
- Ask / Plan / Code / Auto modes;
- task checklist แบบ coding agent;
- richer tool activity cards;
- file diff review;
- approval policy สำหรับ sensitive commands;
- retry/backoff และ fallback route;
- usage / latency / model telemetry แบบ local;
- Git/worktree awareness;
- true subagents ในอนาคต.

รายละเอียด engineering roadmap: **[docs/CODEX-OMNIROUTE.md](docs/CODEX-OMNIROUTE.md)**

---

## 🔐 Security notes

Project Alisa Studio ตอนนี้เป็น **local development application** ไม่ใช่ hardened multi-user service

- อย่า expose backend port `3001` ไปยัง network ที่ไม่ไว้ใจ;
- terminal tools ใช้สิทธิ์ของ OS user ที่เปิดแอป;
- file endpoints ควรอยู่ภายใน active workspace;
- rollback ไม่สามารถย้อนผลกระทบทุกอย่างจาก arbitrary terminal commands;
- current security checks เป็น defensive helpers ไม่ใช่ complete sandbox;
- ห้าม commit API keys, local sessions หรือ private config.

---

<div align="center">

### 🎀 Visual direction

**Dark coding canvas · soft pink · blue · violet · calm anime AI mascot**

「好きなことで、もっと先の未来へ。」

**Code softly. Build seriously. ✦**

</div>
