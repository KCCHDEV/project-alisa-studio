# Agent Orchestrator — แผนงาน

> เป้าหมาย: ทำให้ Project Alisa Studio รัน agent หลายตัวพร้อมกันใน
> **git worktree แยกกัน** แล้ว review / comment / merge ผลที่เลือกกลับเข้า branch หลัก

เอกสารนี้อธิบายสถาปัตยกรรมและลำดับการลงมือ รายละเอียดเดิมของโปรเจกต์อยู่ที่
[CODEX-OMNIROUTE.md](CODEX-OMNIROUTE.md) และ [RESTORATION.md](RESTORATION.md)

---

## 1. ปัญหาเดิมที่ต้องแก้

| ความสามารถ | Alisa ก่อนลงมือ |
| --- | --- |
| หลาย agent พร้อมกัน | swarm แบบ **ลำดับ** ใน workspace เดียว |
| การแยกงาน | ไม่มี — ทุกอย่างแชร์โฟลเดอร์เดียว |
| External CLI agent | ใช้ agent loop ของตัวเองอย่างเดียว |
| Review / merge | ดู diff ของ workspace เดียว |

**รากของปัญหา**: task lifecycle ทั้งหมดอยู่ใน closure ของ WebSocket connection เดียว
(`src/server/index.ts`) ทำให้รันได้ทีละตัวต่อหนึ่ง workspace และตายตามการ disconnect

---

## 2. สถาปัตยกรรมเป้าหมาย

```text
React UI
  ├─ Session view (เดิม)          ── orchestrator run ที่ cwd = workspace หลัก
  ├─ Worktree dashboard (ใหม่)   ── grid ของ agent ทุกตัว
  ├─ Diff review + annotate (ใหม่)
  └─ CLI agent console (ใหม่)
        ↕ HTTP + WebSocket
Local Bun Server
  ├─ OrchestratorRegistry        ── run หลายตัวพร้อมกัน, อยู่รอด reconnect
  ├─ WorktreeRegistry            ── CRUD worktree + metadata
  ├─ CliAgentSessionManager      ── spawn opencode/claude/codex
  ├─ AnnotationStore            ── comment ต่อบรรทัดใน diff
  └─ AgentLoop (ของเดิม)         ── engine แบบ Alisa
```

### 2.1 Worktree

```text
<repo-parent>/.alisa-worktrees/<repo-name>/<slug>/     ← โฟลเดอร์จริง
branch: alisa/<slug>                                     ← branch ต่อ 1 task
```

- เก็บ worktree **ไว้นอก repo** เพื่อไม่ให้ `git status` ของโปรเจกต์เดิมรก
- path ที่ client ส่งมา **ไม่เชื่อถือ** — ต้อง validate ว่าอยู่ใน worktree root
  และมีอยู่ใน `git worktree list` จริงเท่านั้น
- slug ถูก sanitize และ branch name ถูก validate ก่อนทุกครั้ง

### 2.2 Engine สองแบบ

| engine | รายละเอียด |
| --- | --- |
| `alisa` | agent loop เดิมของเรา รันใน `cwd = worktree path` ต่อหนึ่ง run |
| `cli` | spawn CLI ที่ติดตั้งในเครื่อง (`opencode`, `claude`, `codex`, …) เป็น child process |

### 2.3 OrchestratorRegistry

ย้าย task lifecycle ออกจาก WS closure ไปเป็น registry ระดับ module

```ts
orchestrator.start({ runId, cwd, sessionId, prompt, engine, llmConfig, ... })
orchestrator.subscribe(runId, listener)
orchestrator.abort(runId)
```

- หนึ่ง process รันหลาย run พร้อมกันได้ โดยจำกัดด้วย `maxParallelAgents`
- WS กลายเป็น subscriber เปล่า ๆ → UI reconnect กลางงานแล้วยังเห็นสถานะต่อ
- protocol เดิม (`start_task`, `session_saved`, …) ต้อง **ไม่เปลี่ยนพฤติกรรม**
  เพื่อให้ `tests/server.test.ts` เดิมยังผ่าน

---

## 3. Phase ที่ลงมือ

| Phase | ขอบเขต | ไฟล์หลัก |
| --- | --- | --- |
| 1 | Worktree domain: validation, git plumbing, registry, metadata | `src/core/worktree.ts`, `src/server/worktree-git.ts`, `src/server/worktrees.ts` |
| 2 | OrchestratorRegistry + refactor WS ให้รองรับหลาย run | `src/server/orchestrator.ts`, `src/server/index.ts` |
| 3 | External CLI agents: detection, spawn, stream | `src/core/cli-agents.ts`, `src/server/cli-agent-sessions.ts` |
| 4 | Diff review, annotation, commit, merge | `src/server/annotations.ts`, `src/server/worktree-git.ts` |
| 5 | UI: dashboard, tiles, review modal, CLI console | `src/web/components/*`, `src/web/AppV2.tsx` |
| 6 | API routes, config, docs, README | `src/server/index.ts`, `README.md` |

ทุก Phase ต้องผ่าน `bun test` และ `bun run build` ก่อนขึ้น phase ถัดไป

---

## 4. หลักความปลอดภัย

- **ไม่เชื่อ path จาก client** — ทุก worktree path ต้องผ่าน `git worktree list`
  และอยู่ใน worktree root ที่คำนวณจาก repo root
- **ไม่รัน command ที่ผู้ใช้ส่งมาเอง** — ทุกค่าผ่าน argument allowlist
  (`git worktree add/remove`, slug, base ref ที่ validate แล้ว)
- **merge มี gate** — ปฏิเสธเมื่อ worktree หลักมี uncommitted change
- **ป้องกัน path traversal** — ใช้การ resolve แบบเดียวกับ `resolveWorkspacePath`
- **จำกัดจำนวน** — `maxParallelAgents`, จำนวน worktree, ขนาด diff

---

## 5. สถานะ

- [x] Phase 1 — Worktree domain (`src/core/worktree.ts`, `src/server/worktree-git.ts`, `src/server/worktrees.ts`)
- [x] Phase 2 — Orchestrator registry + WS refactor (`src/server/orchestrator.ts`, `src/server/index.ts`)
- [x] Phase 3 — External CLI agents (`src/core/cli-agents.ts`, `src/server/cli-agent-sessions.ts`)
- [x] Phase 4 — Annotations + merge (`src/server/annotations.ts`, worktree diff/commit/merge routes)
- [x] Phase 5 — UI แบบ dashboard: `OrchestratorView`, `WorktreeTile`, `WorktreeReviewModal`
- [x] Phase 6 — README + `ALISA_MAX_PARALLEL_AGENTS`
- [x] Phase 7 — Worktree workspace แบบโครงใหม่: `WorktreeWorkspace` + `components/workspace/*`
  (Projects rail → agent tabs → terminal/chat → file explorer)

## 7. สิ่งที่ยังไม่ได้ทำ (นอกขอบเขตรอบนี้)

- **PTY เต็มรูปแบบ** — external CLI ทำงานแบบ non-interactive ผ่าน piped stdio
  เพื่อให้ capture output ได้ ยังเปิด TUI แบบ interactive ในแอปไม่ได้
- **Mobile companion / push notification** — เป็นงานคนละส่วนที่ยังไม่ได้วางแผน
- **GitHub / Linear integration ในแอป** — ยังใช้ `gh` ผ่าน `/api/pull-requests` เท่านั้น
- **Unified terminal split** — terminal ปัจจุบันเป็นหนึ่ง session ต่อหนึ่งแท็บ ยังไม่แบ่งซ้อนกันได้

## 8. ข้อจำกัดที่รู้อยู่

- merge รองรับ fast-forward ผ่าน `--no-ff` เท่านั้น ยังไม่มี squash หรือ rebase
- conflict ต้องไปแก้ที่ workspace หลักเอง (`git merge --abort` ผ่าน `abortMerge`)
- จำกัด 24 worktree ที่ track พร้อมกัน และ default 4 agent slot
- บน Windows ถ้า prompt มี `%`, `!` หรือขึ้นบรรทัดใหม่ agent ที่รับ prompt ผ่าน argv
  จะถูกปฏิเสธอย่างชัดเจน (agent ที่รับผ่าน stdin เช่น OpenCode / Claude Code / Codex ไม่มีปัญหา)
- ยังไม่ได้ตรวจ UI ด้วย visual regression test

## 6. HTTP API

| Route | Method | รายละเอียด |
| --- | --- | --- |
| `/api/worktrees` | GET | repo info + รายการ worktree + runs ที่กำลังรัน + capacity |
| `/api/worktrees` | POST | สร้าง worktree (`title`, `prompt`, `baseRef`, `engine`, `cliAgentId`) |
| `/api/worktrees/diff?id=` | GET | diff ต่อไฟล์เทียบ base ref (รวม untracked) |
| `/api/worktrees/commit` | POST | commit ภายใน worktree |
| `/api/worktrees/merge` | POST | merge branch กลับเข้า workspace หลัก (ปฏิเสธถ้าหลักมีงานค้าง) |
| `/api/worktrees/remove` | POST | ลบ worktree (ลบ branch ได้) |
| `/api/worktrees/annotations?id=` | GET | คอมเมนต์บน diff + prompt สำหรับส่งกลับ agent |
| `/api/worktrees/annotate` | POST | เพิ่ม/แก้/ลบ annotation |
| `/api/cli-agents` | GET | ตรวจว่ามี CLI agent ตัวไหนติดตั้งไว้บ้าง |

WebSocket รองรับเพิ่ม: `orchestrator_snapshot`, `orchestrator_run_started`,
`orchestrator_run_updated`, `orchestrator_run_finished`, `cli_agent_output`
และ `start_task` รับ `worktreeId` / `engine` / `cliAgentId` / `cliModel`