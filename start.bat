@echo off
title Ichigo Agent App
echo ===================================================
echo     🍓 Starting Ichigo Agent Studio...
echo ===================================================
cd /d "%~dp0"
start "" http://localhost:3000
bun run src/server/index.ts & vite
pause
