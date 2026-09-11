# Project Alisa Studio V2 — Release Guide

เอกสารนี้เป็นสัญญาของ release สำหรับแอป desktop native ของ Project Alisa Studio V2

ขอบเขตที่รับรองใน release นี้คือ desktop OS หลัก 3 กลุ่ม: Linux x64, Windows x64 และ macOS ตาม architecture ของ runner ที่ GitHub จัดให้. Android, iOS และ web/standalone browser ไม่รวมอยู่ใน release ชุดนี้

## สิ่งที่ release ต้องมี

ทุก tag ที่ตรงกับ `v*` ใช้ `.github/workflows/ci-build.yml` ทำงานตามลำดับนี้:

1. Verify ด้วย Bun test, TypeScript check และ production UI build
2. Build บน runner ของแต่ละระบบปฏิบัติการแบบแยกกัน
3. Upload artifact ของแต่ละ runner
4. Publish artifact ทั้งหมดลงใน GitHub Release เดียวกัน

ถ้า package job ใดล้มเหลว release job จะไม่ทำงาน เพราะ release ใช้ `needs: package` ครบทุก platform. จึงไม่ควรมี release ที่บอกว่ารองรับทุก OS แต่ขาด installer ของบางระบบ

## Platform matrix

| Platform | Runner | Tauri bundle | ไฟล์หลัก | หมายเหตุ |
| --- | --- | --- | --- | --- |
| Linux x64 | `ubuntu-latest` | `deb,appimage` | `.deb`, `.AppImage` | runner ติดตั้ง WebKit/GTK dependencies และใช้ `NO_STRIP=true` สำหรับ ELF รุ่นใหม่ก่อน build |
| Windows x64 | `windows-latest` | `nsis,msi` | `.exe`, `.msi` | WebView2 และ Windows build tools มีใน runner |
| macOS | `macos-latest` | `dmg` | `.dmg` | artifact เป็น architecture เดียวกับ runner ที่ GitHub จัดให้ |

ไฟล์ทุกชนิดจะอยู่ใน GitHub Release เดียวกัน และชื่อ artifact ของ CI แยกเป็น `alisa-linux-x64`, `alisa-windows-x64` และ `alisa-macos` เพื่อไม่ให้ไฟล์จากคนละระบบปะปนกัน

## วิธีเลือกไฟล์

- Linux: ใช้ `.deb` บน Debian/Ubuntu ที่รองรับ หรือ `.AppImage` ถ้าต้องการไฟล์ portable
- Windows: ใช้ `.exe` (NSIS) สำหรับการติดตั้งทั่วไป; ใช้ `.msi` สำหรับองค์กรหรือ deployment ผ่านระบบจัดการเครื่อง
- macOS: เปิด `.dmg` แล้วลาก `Project Alisa Studio V2.app` เข้า `Applications`

นี่เป็น Tauri desktop release เท่านั้น ไม่มี web/standalone browser build อยู่ใน release artifacts

## Signing และข้อจำกัดด้านความปลอดภัย

ถ้ายังไม่ได้ตั้ง secrets สำหรับ signing:

- Windows installer จะเป็น unsigned และ SmartScreen อาจแสดงคำเตือน
- macOS app/DMG จะเป็น unsigned/notarized ไม่ครบ และ Gatekeeper อาจต้องกดอนุญาตจาก Privacy & Security
- Linux package ไม่ใช่การยืนยันว่า binary ถูก sign โดย distribution

การตั้ง signing certificate และ notarization ควรทำใน GitHub repository secrets ก่อนประกาศ release สำหรับผู้ใช้ทั่วไป. ห้ามใส่ certificate, private key, API key หรือ credential ลงใน repository

## Local build

คำสั่งเหล่านี้ build installer ของ OS ที่กำลังใช้งานอยู่:

```sh
bun install --frozen-lockfile
bun run test
bun run build
bun run tauri:build
```

ตรวจไฟล์ที่ได้ใน:

```text
src-tauri/target/release/bundle/
```

บน Linux หาก build เอง ให้ติดตั้ง dependency ของ Tauri WebKit/GTK ให้ครบก่อน. ถ้า distro ใช้ ELF ที่มี `.relr.dyn` (เช่น Arch/Fedora หรือ Ubuntu รุ่นใหม่) ให้ใช้ `NO_STRIP=true` เพื่อข้าม `strip` รุ่นเก่าที่มากับ linuxdeploy:

```sh
NO_STRIP=true bun run tauri:build -- --bundles appimage
```

บน Windows ต้องมี WebView2 และ C++ build tools; บน macOS ต้องมี Xcode command-line tools

## Version และการ publish

ให้ version ใน `package.json` และ `src-tauri/tauri.conf.json` ตรงกับ tag release เช่น `2.0.1` กับ `v2.0.1`. ห้าม force-move tag ที่ publish แล้ว. หากมี installer ไม่ครบ ให้แก้ workflow แล้วใช้ tag ใหม่แทนการปล่อย release ที่ไม่สมบูรณ์

## Troubleshooting

- ไม่มี release: ตรวจ `verify` และ package job ของ platform ที่ล้มเหลว
- ไม่มีไฟล์บางชนิด: ตรวจ `bundles` ใน matrix และ `if-no-files-found: error`
- GitHub Actions ไม่เริ่ม job: ตรวจ billing/account lock หรือ runner availability ก่อนแก้ source code
- เปิดแอปแล้ว settings หาย: ตรวจ app-data directory และไฟล์ `.alisa-config.json` รวม `.bak1`–`.bak3`; dev และ installed app ใช้ config store แบบ atomic เดียวกัน
