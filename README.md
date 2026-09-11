> **Current runtime: Tauri + Bun V2.** For project/chat workflow, editor behavior, isolation limits, and local plugins, see [Project-first workflow](docs/RESTORATION.md).
>
> Start: `bun install --frozen-lockfile` → `bun run app`. This repository ships a Tauri desktop app only; Vite is an internal Tauri webview build step. Verify: `bun test` and `bun run build`. Package: `bun run dist`.

<div align="center">

<img src="public/avatar.png" width="180" alt="Project Alisa Studio mascot" />

# ✦ Project Alisa Studio

### Cute desktop AI coding workspace for real projects, local tools, and OmniRoute

**Codex-style workflow · Streaming Agent · Local Files & Terminal · OpenAI-compatible Gateway**

[![CI](https://github.com/KCCHDEV/project-alisa-studio/actions/workflows/ci-build.yml/badge.svg)](https://github.com/KCCHDEV/project-alisa-studio/actions/workflows/ci-build.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?logo=bun&logoColor=111)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111)
![Tauri](https://img.shields.io/badge/Tauri-desktop-24C8DB?logo=tauri&logoColor=111)
![OmniRoute](https://img.shields.io/badge/Gateway-OmniRoute-EF8FBD)

**AI / Code / Create / Automate — together.**

[Latest V2 desktop release](https://github.com/KCCHDEV/project-alisa-studio/releases/latest)

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
| 🧾 | **Model Attribution** | ทุกคำตอบใหม่ระบุ `via <resolved model>` ว่าตอบจาก model/route ใด |
| 📁 | **Project Workspace** | เลือกโฟลเดอร์โปรเจกต์ แล้วอ่าน/ค้นหา/แก้ไฟล์ภายใน workspace |
| 🛠️ | **Local Tools** | File read/write/patch/search, persistent goal และ terminal command พร้อม timeout |
| 🖥️ | **Integrated Terminal** | local shell แบบ persistent และ remote SSH session ในแอปเดียว โดยไม่บันทึก password หรือ private key |
| 🐝 | **Agent Swarm** | staged Explorer → Planner → Builder → Reviewer พร้อมสถานะ worker และเวลารัน |
| ⚡ | **YOLO Mode** | เปิด/ปิดโหมดที่ข้าม approval prompt สำหรับเครื่องมือที่ถูกกำกับสิทธิ์ โดยค่าเริ่มต้นปิดและบันทึกถาวร |
| 📊 | **Context Window** | แสดง token estimate, max context ของ model และ automatic compaction |
| ↩️ | **Snapshots / Rollback** | เก็บ snapshot ก่อน file write/patch ที่รองรับ เพื่อย้อนการแก้ไขล่าสุด |
| 🧩 | **Skills** | โหลด Hermes-style `SKILL.md` และ workspace skills |
| 🔌 | **Preinstalled MCP + Computer Use** | bundled skills พร้อมตรวจ MCP config และ desktop input bridge แบบ read-only; ไม่รัน external process เอง |
| 🕘 | **Project History** | เก็บบทสนทนาตาม workspace ทำให้แต่ละโปรเจกต์มี history ของตัวเอง |
| ⚡ | **OmniRoute Ready** | ใช้ base URL + API key + model route เช่น `auto/best-coding` |
| 🎨 | **VS Code Editor** | multi-tab editor พร้อม syntax colors, line numbers, active line และ Ctrl/Cmd+S |
| 🌸 | **Yurachi Companion Poses** | ภาพ chibi หลายท่าตามสถานะงาน พร้อมซ่อน/แสดงด้วยปุ่ม, `/character` และจำค่าบนเครื่อง |
| 🖥️ | **Desktop App** | Tauri สำหรับ desktop พร้อม local Bun backend และ workspace isolation |
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
- persistent session goals พร้อม status/progress/steps และ `update_goal` tool;
- staged agent swarm แบบ Explorer → Planner → Builder → Reviewer (ใช้ workspace ร่วมกันแบบ sequential เพื่อเลี่ยง write conflicts);
- context window estimate พร้อม model context metadata เมื่อ gateway ประกาศ;
- model attribution ใน assistant transcript ว่า response มาจาก route/model ใด;
- built-in + Hermes-style skills รวม `mcp` และ `computer-use` ที่ติดมากับ V2;
- startup/project/panel transitions แบบสั้นและ compositor-friendly เพื่อไม่บล็อก workspace.

> Agent swarm ใน V2 เป็น worker agent แยกตาม role ภายใน backend เดียวกันและรันเป็นลำดับเพื่อความปลอดภัยของการแก้ไฟล์; parallel execution ยังไม่เปิดเป็นค่าเริ่มต้น.

---

## 🎛️ หน้าหลักของแอป

- **Sessions** — งานและบทสนทนาของโปรเจกต์
- **Files** — file tree + editor
- **Chat** — streaming conversation + agent activity
- **Terminal** — local persistent shell + remote SSH session พร้อม live output
- **Skills** — เลือก skill ที่ใช้กับ agent; `mcp` และ `computer-use` พร้อมใช้ตั้งแต่เปิดแอป
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

Integrated terminal ใช้ `Ctrl/Cmd + grave` หรือปุ่ม Terminal ด้านบน แอปเปิด local shell ที่ active workspace เป็นค่าเริ่มต้น ส่วน SSH ใช้ `ssh` ที่ติดตั้งในเครื่องและรับ password/host-key prompt ภายใน terminal โดยไม่เขียน credential ลง config. Session จะปิดเมื่อ backend disconnect หรือไม่มี activity ตาม timeout เพื่อไม่ทิ้ง process ค้าง.

V2 bundle มี `mcp` และ `computer-use` เป็น built-in instruction skills ตั้งแต่ติดตั้ง แอปตรวจไฟล์ MCP ที่พบบนเครื่องและ input bridge ที่มีอยู่ใน Settings เท่านั้น; การ launch MCP server หรือ desktop action ต้องถูกเรียกผ่านระบบที่ผู้ใช้อนุมัติ ไม่รันเบื้องหลังเอง.

### Yurachi companion poses

ภาพ companion เป็น optional layer สำหรับหน้า session ว่าง และจะแสดงเป็นตัวบอกสถานะขนาดเล็กระหว่าง agent ทำงาน เพื่อไม่แย่งพื้นที่ coding:

| Pose | สถานะที่ใช้ |
| --- | --- |
| `coding` | session ใหม่ / idle |
| `thinking` | model กำลังคิดหรือ self-correcting |
| `terminal` | agent กำลังใช้ tool, terminal หรือรอ permission |
| `review` | มีไฟล์ที่เปลี่ยนแปลงให้ตรวจ |
| `success` | task ล่าสุดเสร็จสมบูรณ์ |

กดปุ่ม ✨ ด้านบนหรือใช้ `/character` เพื่อซ่อน/แสดง ระบบจำค่าบนเครื่องด้วย local webview storage.

### YOLO mode

YOLO เป็นโหมดที่ผู้ใช้เปิดเองเพื่อให้ agent ทำงานต่อโดยไม่หยุดรอการกดอนุมัติสำหรับ tool ที่ถูกกำกับด้วย `requiresApproval` เช่น terminal. ค่าเริ่มต้นคือปิด และเปิด/ปิดได้จากปุ่ม `YOLO`/`Safe`, Command Palette, `/yolo` หรือ Settings.

เมื่อเปิด YOLO แล้ว ระบบยังคงตรวจ argument, จำกัด workspace, รักษา Ask/Plan ให้เป็น read-only และใช้ terminal security gatekeeper ตามเดิม. สถานะ `YOLO · no confirm` จะแสดงใน composer ตลอดเวลา และค่าจะเก็บใน app data ด้วย atomic config + recovery backups เพื่อไม่หายเมื่อเปิดแอปใหม่.

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

### Desktop app (Tauri V2)

```bash
bun run app
# equivalent: bun run tauri:dev
```

หรือ build installer:

```bash
bun run build
bun run dist
```

There is no standalone web mode. The Vite dev server and local Bun backend are started automatically by Tauri for the desktop webview and are not user-facing endpoints.

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
OMNIROUTE_API_KEY=...
OMNIROUTE_BASE_URL=http://127.0.0.1:10009/v1
```

รองรับ `OPENROUTER_API_KEY` เช่นกัน และ local Hermes config อาจถูกใช้เป็น startup fallback ส่วน settings ที่ save ในแอปจะ override ค่าเริ่มต้น

> ตอนนี้ API key ใน desktop config ยังเก็บเป็น plaintext บนเครื่อง ควรเก็บไฟล์ config เป็น private และห้าม commit การตั้งค่าจะถูกเขียนแบบ atomic และมี backup ส่วนตัว 3 ชุดใน app-data (`.alisa-config.json.bak1` ถึง `.bak3`) เพื่อกู้คืนอัตโนมัติเมื่อไฟล์หลักเสียหรือหาย

---

## 📦 Build / Package

| Command | Output |
| --- | --- |
| `bun run build` | TypeScript check + Tauri frontend assets |
| `bun run build:server` | Compiled Bun backend resource |
| `bun run tauri:build` | Tauri installer for the current platform |
| `bun run dist` | Alias for the Tauri package build |

Output อยู่ใน `src-tauri/target/release/bundle/`

Installer ที่ release รองรับ: Windows `.exe` (NSIS) + `.msi`, macOS `.dmg`, และ Linux `.deb`/`.AppImage` เมื่อมี Linux runner. Windows/macOS builds เป็น unsigned builds หากยังไม่ได้ตั้งค่า certificate หรือ Apple signing identity.

Automatic in-app updates are not configured in this build; use the published release artifacts manually.

Release ล่าสุดอยู่ที่ [GitHub Releases](https://github.com/KCCHDEV/project-alisa-studio/releases) และ Linux package จะใช้ไฟล์ `.deb` ที่สร้างจาก Tauri V2.

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
   ├─ Publish macOS release
   └─ Publish Linux `.deb` when available
```

CI ใช้ permission แบบ read-only เป็นค่าเริ่มต้น และให้ `contents: write` เฉพาะ release jobs

---

## 🗂️ Structure

```text
src/
├─ web/       Tauri webview UI + VS Code-style editor (internal only)
├─ server/    local HTTP + WebSocket backend
├─ core/      agent / context / compaction / security / snapshots
├─ llm/       OpenAI-compatible streaming client
└─ tools/     file / terminal / search / skill tools

src-tauri/    Tauri desktop lifecycle / native shell

docs/         product + integration + visual documentation
public/       app assets
.github/      CI / release workflows
```

---

## 🌷 V2 status and roadmap

ทิศทางหลักคือทำให้ Alisa เป็น **cute but serious desktop coding agent**:

V2 ที่ใช้งานได้แล้ว:

- first-class provider profiles, Test Connection และ `/models` discovery fallback;
- Project + Chats workflow พร้อม rename / pin / archive / search;
- Ask / Plan / Code / Auto modes และ durable task checklist;
- streaming tool activity, approval card, diff/changes panel และ rollback;
- VS Code-style multi-tab editor พร้อม explorer, line numbers, breadcrumbs และ Ctrl/Cmd+S;
- integrated terminal แบบ persistent สำหรับ local shell และ SSH พร้อม output batching เพื่อลดอาการกระตุก;
- workspace instruction loading จาก `AGENTS.md` และ session persistence ต่อโปรเจกต์.

งานถัดไปที่ตั้งใจทำต่อ:

- diagnostics, search/replace และ extension-like editor integrations;
- Git worktree controls, commit/branch review และ local usage telemetry;
- parallel read-only swarm workers ในอนาคต เมื่อ permission/context budget รองรับอย่างเสถียร.

รายละเอียด engineering roadmap: **[docs/CODEX-OMNIROUTE.md](docs/CODEX-OMNIROUTE.md)**

---

## 🔐 Security notes

Project Alisa Studio ตอนนี้เป็น **local development application** ไม่ใช่ hardened multi-user service

- อย่า expose backend port `3101` ไปยัง network ที่ไม่ไว้ใจ;
- terminal tools และ integrated local shell ใช้สิทธิ์ของ OS user ที่เปิดแอป; SSH ใช้ host keys/config ของ `ssh` ในเครื่อง;
- integrated terminal จำกัด local starting directory ให้อยู่ใน active workspace แต่ shell สามารถ `cd` ต่อไปตามสิทธิ์ของ OS ได้;
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
