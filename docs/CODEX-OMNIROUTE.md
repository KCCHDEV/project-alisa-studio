# ✦ Project Alisa Studio — Codex-style + OmniRoute Product Spec

> Status: **design / implementation guide**  
> เอกสารนี้แยก **ของที่มีอยู่แล้ว** กับ **ของที่วางแผนจะทำ** เพื่อไม่ให้ README ดูเหมือนอ้างว่าฟีเจอร์ที่ยังไม่เสร็จใช้งานได้แล้ว

---

## 1. Product goal

Project Alisa Studio ควรให้ความรู้สึกเป็น **desktop coding agent** มากกว่า generic chatbot

Target flow:

1. เปิดโปรเจกต์
2. บอก goal ให้ Alisa
3. agent inspect repository
4. เห็น task/status แบบ realtime
5. เห็น file / terminal / tool activity
6. เปลี่ยน model หรือ route ได้โดยไม่ออกจาก session
7. history แยกตาม project
8. กลับมาทำงานต่อภายหลังได้

Visual direction คือ compact coding UI ผสม identity สี pink / blue แบบ Yurachi-inspired โดยไม่ให้ตัวการ์ตูนรบกวนพื้นที่ code

---

## 2. Core principles

### Project first

Active workspace ต้องเห็นชัดเสมอ File actions, terminal, context, history และ skills ต้อง scope อยู่ใน workspace นั้น

### Agent activity must be visible

ผู้ใช้ต้องรู้ว่า agent กำลัง:

```text
Thinking
Reading files
Editing files
Running terminal
Retrying
Waiting for approval
Completed
```

### Provider setup should be easy

OmniRoute ควรเป็น first-class provider profile ไม่ใช่แค่ช่องกรอก URL เปล่า ๆ

### Fast model switching

Coding session ควรสลับ fast → coding → reasoning ได้จาก model picker โดยไม่ต้องเข้า settings ใหม่ทุกครั้ง

### Safe local execution

Agent ทำงานได้เยอะ แต่ sensitive actions ควรมี policy และ approval boundary ที่ชัดเจน

---

## 3. Current architecture

```text
React Renderer
   │
   ├─ HTTP APIs
   └─ WebSocket Events
        │
        ▼
Local Bun Server
        │
        ▼
Agent
   ├─ Context Manager
   ├─ Context Compactor
   ├─ Tool Registry
   └─ Snapshot / Rollback
        │
        ▼
LLM Client
        │
        ▼
OpenAI-compatible /chat/completions
```

Current LLM request path:

```text
{baseURL}/chat/completions
```

Current client supports:

- SSE streaming
- `delta.content`
- `delta.reasoning_content` / `delta.thought`
- OpenAI-style streamed tool calls
- `tool_choice: auto`
- abort signal

---

## 4. OmniRoute first-class provider profile

### Planned provider object

```ts
type ProviderProfile = {
  id: string
  name: string
  kind: 'omniroute' | 'openrouter' | 'openai-compatible'
  baseURL: string
  apiKey?: string
  defaultModel: string
  modelDiscovery: 'auto' | 'off'
}
```

Suggested OmniRoute preset:

```text
Name      OmniRoute
Base URL  http://127.0.0.1:10009/v1
Model     auto/best-coding
```

Host, port, key และ model ต้องแก้ได้เองทั้งหมด

---

## 5. Test Connection

Settings ควรมีปุ่ม **Test connection**

Expected flow:

```text
1. Normalize base URL
2. Try GET {baseURL}/models
3. ถ้ารองรับ → โหลด model list
4. ส่ง tiny chat-completions request
5. Verify streaming response
6. แสดงผล:
   Connected
   Auth failed
   Route missing
   Network error
```

`/models` ต้องเป็น optional เพราะ OpenAI-compatible gateway บางตัวไม่มี endpoint นี้

ถ้า model discovery ใช้ไม่ได้ แต่ `/chat/completions` ใช้ได้ ให้ถือว่า connection ใช้งานได้

---

## 6. Model picker

อย่าแสดง raw model หลายร้อยตัวก่อน ควร group ตาม intent

```text
💻 Coding
   auto/best-coding
   auto/best-coding-fast
   auto/pro-coding

🧠 Reasoning
   auto/best-reasoning
   auto/pro-reasoning

⚡ Fast
   auto/best-fast
   auto/pro-fast

👁 Vision
   auto/best-vision
   auto/pro-vision

💬 Chat
   auto/best-chat
   auto/pro-chat
```

ด้านล่างค่อยมี:

```text
All Provider Models
```

ถ้า OmniRoute คืน model จำนวนมาก ให้เพิ่ม search + provider grouping

---

## 7. Exact model fallback

ถ้า gateway ตอบ error ว่า model/provider ambiguous ไม่ควรแค่โยน raw error

Suggested UI:

```text
OmniRoute needs an exact provider route for this model.

[Choose exact model]
[Open model picker]
[Retry]
```

---

## 8. Codex-style session UX

```text
┌──────────────┬───────────────────────────────────────┐
│ Sessions     │ Project / branch / provider / model   │
│ Files        ├───────────────────────────────────────┤
│              │                                       │
│ recent task  │ Chat + Agent Activity                 │
│ recent task  │                                       │
│              │ Tool cards / Diff / Terminal cards    │
│              │                                       │
│              ├───────────────────────────────────────┤
│              │ Composer + Model + Mode + Send        │
└──────────────┴───────────────────────────────────────┘
```

Status line:

```text
● Thinking
● Reading src/...
● Editing 2 files
● Running tests
● Waiting for approval
● Completed
```

---

## 9. Task checklist

Task ใหญ่ควรมี optional checklist

```text
Goal: Add OmniRoute model discovery

[✓] Inspect current provider config
[✓] Add provider adapter
[•] Add /models handling
[ ] Add model picker grouping
[ ] Verify build
```

Task plan เป็น UI state ไม่ใช่ hidden chain-of-thought ของโมเดล

---

## 10. Tool activity cards

### File read

```text
READ
src/llm/client.ts
```

### File edit

```text
EDIT
src/web/AppV2.tsx
+34  -9
[View diff]
```

### Terminal

```text
RUN
bun run build

✓ exit 0 · 12.4s
```

### Search

```text
SEARCH
"baseURL"

7 matches · 4 files
```

---

## 11. Diff review

Planned edit flow:

```text
Agent proposes edit
      ↓
Snapshot old file
      ↓
Show unified diff
      ↓
Policy
  auto-apply safe edits
  OR request approval
      ↓
Write file
```

Settings ในอนาคต:

```text
File edits
  ○ Always ask
  ● Auto apply inside workspace

Terminal
  ● Ask for risky commands
  ○ Always ask
```

---

## 12. Agent modes

### Ask

Read-only Q&A / explain code

### Plan

สร้าง implementation plan แต่ไม่แก้ไฟล์

### Code

อนุญาต workspace edits และ normal dev commands

### Auto

Agent ทำงานต่อหลาย tool cycles โดยลด interruption

Mode ต้องเปลี่ยน tool permissions + system instructions จริง ไม่ใช่เปลี่ยนแค่ label

---

## 13. Context priority

```text
1. system / product rules
2. active mode
3. active skills
4. project instructions
5. user request
6. relevant files / search results
7. recent conversation
8. compacted older conversation
```

Planned instruction files:

```text
ALISA.md
AGENTS.md
CLAUDE.md
README.md
```

UI ควรบอกด้วยว่าโหลด instruction file อะไรบ้าง

---

## 14. Skills

รองรับ Hermes-style `SKILL.md` ต่อไป แต่ทำ path ให้ cross-platform

Recommended roots:

```text
~/.alisa/skills/
<workspace>/.alisa/skills/

~/.hermes/skills/
<workspace>/.hermes/skills/
```

Skill metadata:

```text
name
description
source
path
enabled
```

อย่าเรียก skill ว่า subagent ถ้ายังไม่ได้ spawn worker จริง

---

## 15. Staged agent swarm — implemented in V2

V2 มี role worker แยกภายใน backend เดียวกัน โดยแต่ละ worker มี independent:

```text
task
message history
tool budget
workspace scope
status
result
```

รูปแบบที่ใช้งานอยู่:

```text
Explorer → Planner → Builder → Reviewer
      shared workspace / session goal
      live swarm_update + elapsed time
```

worker ทั้งสี่รันแบบ sequential โดยตั้งใจ เพื่อป้องกันการเขียนไฟล์ชนกันใน workspace เดียวกัน; ทุก worker ใช้ Agent loop, tool permissions และ model config ของตัวเอง. Parallel read-only workers ยังเป็น future enhancement.

---

## 16. Retry / fallback policy

```text
Network timeout
  → retry same route

429 / capacity
  → exponential backoff
  → optional alternate auto route

Ambiguous model
  → exact provider route UI

401 / 403
  → do not auto retry
  → show credentials error

Tool-call parse error
  → one repair attempt
```

UI ต้องบอก retry state ไม่ใช่ค้างเงียบ

---

## 17. Local telemetry

Session telemetry แบบ local-only:

```text
provider
model
request count
tool-call count
estimated input/output tokens
elapsed time
errors / retries
```

ไม่ upload telemetry โดย default

---

## 18. Persistence

Recommended app-data structure:

```text
<app-data>/
├─ config.json
├─ providers.json
├─ sessions/
├─ snapshots/
└─ cache/
```

Secrets ควรย้ายไป OS credential storage ในอนาคต:

```text
Windows Credential Manager
macOS Keychain
Linux Secret Service
```

---

## 19. Security requirements

ก่อนรองรับ remote access จริง:

- remove permissive `Access-Control-Allow-Origin: *`
- add local auth / stronger IPC boundary
- validate workspace paths ทุกจุด
- keep file operations inside active workspace
- classify risky terminal commands
- redact secrets จาก logs
- never echo API key กลับ renderer แบบเต็ม
- store keys in OS secret storage

---

## 20. CI / Release expectation

Pull Request:

```text
install
build
```

Push main:

```text
install
build
package Windows
package macOS
upload artifacts
```

Tag `v*`:

```text
install
build
publish Windows
publish macOS
GitHub Release
```

Normal CI ใช้ read-only permission และ release jobs เท่านั้นที่ใช้ `contents: write`

---

## 21. Definition of “OmniRoute ready”

- [ ] saved OmniRoute provider profile
- [ ] Test Connection
- [ ] graceful `/models` discovery
- [ ] grouped auto-route model picker
- [ ] exact provider-model fallback
- [x] streaming chat
- [x] streamed tool calls
- [x] reasoning fields when supplied
- [ ] retry UI
- [ ] provider/model metadata per session
- [ ] OS-level secret storage

---

## 22. Implementation order

### Phase 1 — Provider foundation

- Provider abstraction
- OmniRoute preset
- Test Connection
- Model discovery
- Model picker grouping

### Phase 2 — Coding UX

- Task checklist
- Better tool cards
- Diff viewer
- Ask / Plan / Code / Auto

### Phase 3 — Reliability

- Retry/backoff
- Exact-route recovery UI
- Request telemetry
- Session provider metadata

### Phase 4 — Safety

- Approval policy
- Credential storage
- Stronger local-server boundary

### Phase 5 — Advanced agent

- Git/worktree integration
- Parallel read-only swarm tasks
- Richer context controls and per-worker budgets

---

## 23. Visual direction

Technical first, cute second

```text
Canvas       #0B0D12
Surface      #181C26
Pink         #EF8FBD
Blue         #86B3FF
Violet       #BBA7FF
Hairline     rgba(174, 188, 226, .16)
```

Mascot mood:

```text
calm
creative
slightly shy
reliable
AI / programming
pink + blue
cat detail
```

Character art ใช้กับ welcome / empty / branding / docs ได้ แต่ไม่ควรอยู่หลัง source code, terminal หรือ diff

---

## 24. Product statement

> **Project Alisa Studio is a cute, local-first desktop coding agent that connects a real project workspace to OpenAI-compatible model gateways such as OmniRoute — with streaming chat, local file and terminal tools, skills, history, and a Codex-style task workflow.**
