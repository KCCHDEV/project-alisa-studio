@echo off
setlocal
title Project Alisa Studio
echo ===================================================
echo     🍓 Starting Project Alisa Studio...
echo ===================================================
cd /d "%~dp0"
start "Project Alisa Backend" /min cmd /c "bun run src/server/index.ts"
start "Project Alisa UI" /min cmd /c "bun run dev -- --host 127.0.0.1"

echo Waiting for the UI to become ready...
call bunx --bun wait-on http://127.0.0.1:3000
start "" http://127.0.0.1:3000
pause
