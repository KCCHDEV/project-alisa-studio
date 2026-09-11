@echo off
setlocal
title Project Alisa Studio V2 — Tauri Desktop
echo ===================================================
echo     Starting Project Alisa Studio V2 (Tauri)...
echo ===================================================
cd /d "%~dp0"

echo Launching Alisa Studio Desktop App...
where bun >nul 2>nul
if not %errorlevel% equ 0 (
    echo Bun is required for Project Alisa Studio V2.
    exit /b 1
)
call bun run app

pause
