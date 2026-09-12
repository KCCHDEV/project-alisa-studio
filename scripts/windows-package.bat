@echo off
setlocal enabledelayedexpansion
title Project Alisa Studio - Windows VM Builder

echo ========================================================
echo   Project Alisa Studio V2 - Windows Build Pipeline
echo ========================================================
echo.

:: Ensure environment PATH includes all installed tools and NSIS
set "NSISDIR=C:\NSIS"
set "PATH=%PATH%;C:\NSIS\Bin;C:\NSIS;C:\Windows\System32\config\systemprofile\.cargo\bin;C:\Users\naygolf\.cargo\bin;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Windows\System32\config\systemprofile\.bun\bin;C:\Windows"

:: Initialize Visual Studio MSVC 64-bit environment
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  echo [OK] Initializing MSVC x64 build environment...
  call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) else (
  echo [WARN] vcvars64.bat not found at default path!
)

echo.
echo Toolchain Verification:
where node
where bun
where cargo
where cl

echo.
echo --------------------------------------------------------
echo [1/4] Preparing local high-speed build workspace C:\alisa
echo --------------------------------------------------------
if not exist "C:\alisa" mkdir "C:\alisa"

set "SRC_DIR=\\Mac\Home\Documents\GitHub\project-alisa-studio"
if not exist "%SRC_DIR%" set "SRC_DIR=C:\Mac\Home\Documents\GitHub\project-alisa-studio"

echo Syncing project files from %SRC_DIR% to C:\alisa ...
robocopy "%SRC_DIR%" "C:\alisa" /E /XD .git target release node_modules /XF *.dmg *.AppImage *.deb /NDL /NFL >nul
echo [OK] Project files synced to C:\alisa

cd /d "C:\alisa"

echo.
echo --------------------------------------------------------
echo [2/4] Installing dependencies and building UI
echo --------------------------------------------------------
call bun install
if errorlevel 1 (
  echo [WARN] bun install failed, trying npm install...
  call npm install
)

call bun run build
if errorlevel 1 (
  echo [WARN] bun run build failed, trying npm run build...
  call npm run build
)

call bun run build:server
if errorlevel 1 (
  echo [ERROR] Server build failed!
  exit /b 1
)

echo.
echo --------------------------------------------------------
echo [3/4] Packaging Windows NSIS (.exe) and MSI (.msi)
echo --------------------------------------------------------
call bun run tauri build --bundles nsis,msi
if errorlevel 1 (
  echo [WARN] bun run tauri build failed, trying npx @tauri-apps/cli build...
  call npx @tauri-apps/cli build --bundles nsis,msi
)

echo.
echo --------------------------------------------------------
echo [4/4] Copying installer artifacts back to Mac release/
echo --------------------------------------------------------
if not exist "%SRC_DIR%\release" mkdir "%SRC_DIR%\release"

if exist "C:\alisa\src-tauri\target\release\bundle\nsis\*.exe" (
  copy /Y "C:\alisa\src-tauri\target\release\bundle\nsis\*.exe" "%SRC_DIR%\release\"
  echo [SUCCESS] Copied NSIS installer exe to %SRC_DIR%\release\
)

if exist "C:\alisa\src-tauri\target\release\bundle\msi\*.msi" (
  copy /Y "C:\alisa\src-tauri\target\release\bundle\msi\*.msi" "%SRC_DIR%\release\"
  echo [SUCCESS] Copied MSI installer msi to %SRC_DIR%\release\
)

echo.
echo ========================================================
echo   Windows Build Pipeline Completed Successfully!
echo ========================================================
dir "%SRC_DIR%\release\"
