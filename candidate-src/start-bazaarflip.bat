@echo off
setlocal
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node.js 22.5 or newer, then run this file again.
  exit /b 1
)
echo Starting BazaarFlipper from %CD%...
node "%~dp0server.mjs"
