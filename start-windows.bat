@echo off
title Scalp Radar shared server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again. & pause & exit /b)
if not exist node_modules (echo Installing... & call npm install --no-audit --no-fund)
:loop
echo Starting Scalp Radar server. Keep this window open. Press Ctrl+C to stop.
node server.js
echo Server stopped. Restarting in 5 seconds...
timeout /t 5 >nul
goto loop
