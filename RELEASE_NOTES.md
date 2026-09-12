# 🚀 Project Alisa Studio V2.0.2

[![Release](https://img.shields.io/badge/release-v2.0.2-6366f1.svg?style=for-the-badge&logo=github)](https://github.com/KCCHDEV/project-alisa-studio/releases/tag/v2.0.2)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-000000.svg?style=for-the-badge&logo=apple)](https://github.com/KCCHDEV/project-alisa-studio/releases)
[![Tauri V2](https://img.shields.io/badge/Tauri-V2%20Native-24C8D8.svg?style=for-the-badge&logo=tauri)](https://tauri.app)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)

> **Next-Generation Desktop AI Engineering Studio**  
> สตูดิโอเขียนโค้ดและพัฒนาซอฟต์แวร์ด้วยพลัง AI Swarm ระดับ Native Desktop พร้อมผู้ช่วย Chibi มาสคอต **"Yurachi" (ยุราจัง)**, ระบบ Failover อัจฉริยะข้ามค่าย และ Custom Native Installers สำหรับทั้ง macOS และ Windows!

---

## 🌟 ไฮไลต์ฟีเจอร์เด่นในรุ่น V2.0.2 (What's New)

### 1. 🎀 Interactive Companion "Yurachi" (ยุราจัง Chibi Panel)
- **Docked Mascot Panel**: มาสคอตผู้ช่วย Chibi ถูกออกแบบให้อยู่ในแถบนำทางขวาล่างอย่างลงตัว ไม่เกะกะพื้นที่ทำงาน
- **Reactive State Animations**: อารมณ์และท่าทางของยุราจังจะเปลี่ยนตามสถานะการทำงานจริงของ Swarm Pipeline แบบเรียลไทม์:
  - 😴 **Idle**: พักผ่อนและรอรับคำสั่ง
  - 💭 **Thinking**: กำลังวิเคราะห์โจทย์และค้นหาคำตอบ
  - ⚙️ **Working / Coding**: ร่วมมือเขียนโค้ดกับ Agent
  - ✨ **Success**: แสดงความยินดีเมื่องานสำเร็จ
  - ⚠️ **Error / Confused**: แจ้งเตือนเมื่อพบปัญหาหรือ API หลุด
- **Interactive Feedback**: คลิกสัมผัสยุราจังเพื่อรับคำแนะนำด่วน (Quick Tips) พร้อมลูกเล่นตอบสนองเสียงสังเคราะห์

---

### 2. ⚡ 4-Role Agent Swarm Pipeline
ระบบกระบวนทัพ AI Agent 4 ฝ่ายที่ทำงานสอดประสานกันอย่างเป็นระบบ:
1. **Architect**: ผู้ออกแบบสถาปัตยกรรม วางโครงสร้างไฟล์ และจัดลำดับขั้นตอน
2. **Engineer**: มือเขียนโค้ดคุณภาพสูง รวดเร็ว แม่นยำตามมาตรฐานโปรเจกต์
3. **Reviewer**: ตรวจสอบคุณภาพโค้ด ค้นหาช่องโหว่ความปลอดภัย และ Refactor โค้ด
4. **Tester**: ออกแบบและรัน Unit Test / Integration Test ครอบคลุม Edge Cases
- **Live Swarm Inspector**: มอนิเตอร์สเตตัสการส่งต่องานระหว่าง Agent แบบวินาทีต่อวินาที พร้อมเกจวัดความคืบหน้าและประเมิน Token Usage

---

### 3. 🔀 OmniRoute Multi-Provider Failover & Auto-Retry
- **Zero-Downtime Resilience**: สลับการเชื่อมต่อระหว่างผู้ให้บริการชั้นนำโดยอัตโนมัติเมื่อเจอปัญหา Rate Limit (429) หรือ Service Downtime:
  - **Anthropic** (Claude 3.7 Sonnet, Claude 3.5 Haiku)
  - **OpenAI** (GPT-4o, GPT-4o-mini, o1/o3-mini)
  - **Google Gemini** (Gemini 2.5 Pro, Flash)
  - **Local Ollama** (Llama 3.3, DeepSeek-R1, Qwen 2.5)
  - **OpenRouter** (Unified API access)
- **Key Rotation & Status Bar**: ตรวจเช็คสถานะและ Latency ของแต่ละ Provider ได้จากหน้าต่าง Settings ทันที

---

### 4. 🔊 Precision Audio Synthesizer & Volume Booster
- **Web Audio Sound Effects**: เสียง Sound Effect สังเคราะห์ความถี่คมชัด ไร้ปัญหาไฟล์เสียงหาย
- **Boosted Volume Slider**: ปรับความดังเสียงได้ตั้งแต่ 0% จนถึงระดับบูสต์พิเศษ **200%** พร้อมสวิตช์ปิดเสียง (Mute)
- **Instant Test Sound Button**: ปุ่มกดทดสอบเสียงทันทีในหน้าตั้งค่า เพื่อความมั่นใจก่อนเริ่มรันงาน
- **Audio Cues**: สัญญาณเสียงเตือนตามเหตุการณ์สำคัญ (Message In, Swarm Completed, Build Succeeded, Error Alert)

---

### 5. 💻 Integrated Real-Time Terminal & Execution Control
- **Native Subprocess Terminal**: เทอร์มินัลรันคำสั่งภายในเครื่อง เชื่อมโยงกับ Workspace โดยตรง
- **ANSI Color Support**: แสดงผลสีสันของ CLI, npm, git และ bun อย่างสมบูรณ์
- **Process Protection**: สวิตช์ปุ่ม Kill / Abort กระบวนการทำงานที่ค้างอยู่ได้ในคลิกเดียว พร้อมระบบ Auto-scroll lock

---

### 6. 🔍 Side-by-Side Visual Diff Viewer & Git Workspace
- **Visual Code Review**: แสดงความแตกต่างของโค้ดก่อน-หลังแบบ Split View และ Unified View พร้อม Syntax Highlight คมชัด
- **Granular Git Staging**: เลือกยอมรับ (Accept) หรือปฏิเสธ (Reject) การแก้ไขทีละไฟล์หรือทีละบล็อก
- **Git Commit & Push**: ดูประวัติ Branch และส่งโค้ดขึ้น GitHub ได้ทันที

---

### 7. 🎨 Custom-Branded Installers สำหรับ macOS และ Windows
ในรุ่น V2.0.2 นี้ ตัวติดตั้งได้รับการออกแบบภาพกราฟิก Custom เฉพาะตัวเพื่อประสบการณ์ใช้งานระดับพรีเมียม:
- **macOS DMG Installer**:
  - พื้นหลังภาพ Custom 660x400 สไตล์ Cyber-Dark
  - ลูกศรนีออนบอกทิศทางการลากแอปเข้าโฟลเดอร์ `/Applications` อย่างชัดเจน
  - ไอคอนยุราจังและ Alisa Studio Badge บนแท่นวาง
- **Windows NSIS Installer (.exe)**:
  - **Sidebar Banner**: ภาพกราฟิก Alisa Cyber Suite ขนาด 164x314 พิกเซล พร้อมสัญลักษณ์ V2 Studio
  - **Header Banner**: แถบหัวเรื่องนีออนเรืองแสงขนาด 150x57 พิกเซล
  - ไอคอนติดตั้งความละเอียดสูง พร้อมระบบติดตั้งแบบ Quick Install (CurrentUser) ไม่ต้องถามสิทธิ์ยุ่งยาก

---

## 📦 ตารางไฟล์ติดตั้งและแพลตฟอร์ม (Release Matrix)

| แพลตฟอร์ม | รูปแบบไฟล์ | ชื่อไฟล์ตัวอย่าง | คำอธิบาย & การใช้งาน |
| :--- | :--- | :--- | :--- |
| 🍏 **macOS** (Apple Silicon / Intel) | `.dmg` | `Project-Alisa-Studio-V2-macOS.dmg` | เปิดไฟล์ DMG แล้วลากไอคอนแอปเข้า `/Applications` พร้อมภาพพื้นหลัง Custom |
| 🪟 **Windows x64** | `.exe` (NSIS) | `Project-Alisa-Studio-V2-Setup.exe` | ตัวติดตั้งแบบมีหน้าตาสวยงามพร้อม Custom Sidebar/Header แนะนำที่สุด |
| 🪟 **Windows x64** | `.msi` | `Project-Alisa-Studio-V2.msi` | สำหรับองค์กรหรือการ Deploy ผ่าน Group Policy / MDM |
| 🐧 **Linux x64** | `.AppImage` | `Project-Alisa-Studio-V2.AppImage` | ไฟล์รันได้ทันที Portable (ไม่ต้องติดตั้ง) |
| 🐧 **Linux x64** | `.deb` | `project-alisa-studio_2.0.2_amd64.deb` | ตัวติดตั้งแพ็กเกจสำหรับ Ubuntu, Debian, Pop!_OS, Linux Mint |

---

## 🛠️ คู่มือการติดตั้งและตั้งค่าเริ่มต้น (Installation Guide)

### 🍏 สำหรับผู้ใช้งาน macOS
1. ดาวน์โหลดไฟล์ `.dmg` จากรายการ Assets ด้านล่าง
2. ดับเบิ้ลคลิกเปิดไฟล์ `.dmg` จะเห็นหน้าต่าง Custom Drag-and-Drop พร้อมภาพประกอบ
3. ลากไอคอน **Project Alisa Studio V2** ไปวางที่โฟลเดอร์ **Applications**
4. *กรณีพบการแจ้งเตือนความปลอดภัยของ macOS (Gatekeeper)*:
   - ไปที่ `System Settings` (การตั้งค่าระบบ) > `Privacy & Security` (ความเป็นส่วนตัวและความปลอดภัย)
   - เลื่อนลงมาที่หัวข้อ *Security* แล้วคลิกปุ่ม **Open Anyway** (เปิดต่อไป)

### 🪟 สำหรับผู้ใช้งาน Windows
1. ดาวน์โหลดไฟล์ `Project-Alisa-Studio-V2-Setup.exe`
2. ดับเบิ้ลคลิกไฟล์เพื่อเริ่มการติดตั้ง (จะปรากฏหน้าต่างติดตั้งธีม Cyber พร้อมรูป Alisa)
3. เลือกไดเรกทอรีที่ต้องการ แล้วกด Install จนเสร็จสิ้น
4. *กรณี Windows SmartScreen แสดงคำเตือน*:
   - คลิก **More info** (ข้อมูลเพิ่มเติม) > แล้วคลิก **Run anyway** (รันต่อไป)

### 🐧 สำหรับผู้ใช้งาน Linux
- **AppImage**:
  ```bash
  chmod +x Project-Alisa-Studio-V2.AppImage
  ./Project-Alisa-Studio-V2.AppImage
  ```
- **Debian / Ubuntu**:
  ```bash
  sudo dpkg -i project-alisa-studio_2.0.2_amd64.deb
  ```

---

## ⌨️ คีย์ลัดสำหรับการทำงาน (Shortcuts Cheat Sheet)

| คำสั่ง | Windows / Linux | macOS |
| :--- | :--- | :--- |
| ส่งข้อความ / สั่ง Agent | `Enter` | `Return` |
| ขึ้นบรรทัดใหม่ | `Shift + Enter` | `Shift + Return` |
| สลับโหมด Swarm / Solo | `Ctrl + M` | `Cmd + M` |
| เปิด / ปิด Terminal | `Ctrl + \`` | `Cmd + \`` |
| เปิดหน้าต่างการตั้งค่า (Settings) | `Ctrl + ,` | `Cmd + ,` |
| เปิดหน้าต่าง Diff Viewer | `Ctrl + D` | `Cmd + D` |
| สลับธีมแสดงผล (Dark/Light) | `Ctrl + Shift + T` | `Cmd + Shift + T` |

---

## ⚙️ ข้อมูลทางเทคนิค (Technical Specifications)

- **Framework**: Tauri V2 (Rust Backend + Native WebKit/WebView2)
- **Runtime & Tooling**: Bun 1.2+ / Vite 6 / React 18 / Tailwind CSS
- **Memory Footprint**: ประหยัดทรัพยากรเครื่อง ใช้ RAM เพียง ~40MB – 90MB (เบากว่า Electron ถึง 80%)
- **Data Persistence**: จัดเก็บการตั้งค่าแบบ Atomic JSON ใน OS Application Support Data Directory ปลอดภัย ไม่ส่งข้อมูลส่วนตัวออกนอกเครื่อง

---

**Project Alisa Studio** พัฒนาด้วยความมุ่งมั่นเพื่อมอบประสบการณ์สร้างสรรค์ซอฟต์แวร์ที่ดีที่สุดให้แก่คุณ ขอให้สนุกกับการโค้ดดิ้งร่วมกับ Alisa และ Yurachi! 🚀
