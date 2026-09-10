@echo off
setlocal
title Project Alisa Studio — Tauri Desktop
echo ===================================================
echo     🍓 Starting Project Alisa Studio (Tauri)...
echo ===================================================
cd /d "%~dp0"

echo Launching Alisa Studio Desktop App...
where bun >nul 2>nul
if %errorlevel% equ 0 (
    call bun run tauri:dev
) else (
    call npm run tauri:dev
)

pause
