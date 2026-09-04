@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "WEB_DIR=%ROOT%web"
set "WORKER_DIR=%ROOT%worker"
set "BOT_DIR=%ROOT%discord-bot"
set "DAEMON_URL="
set "WEB_PID="
set "WORKER_PID="
set "BOT_PID="
set "NGROK_PID="

if exist "%WORKER_DIR%\.env" (
  for /f "usebackq tokens=1* delims==" %%A in (`findstr /b /c:"WORKER_DAEMON_URL=" "%WORKER_DIR%\.env"`) do set "DAEMON_URL=%%B"
)

if not defined DAEMON_URL set "DAEMON_URL=https://sappy-atrium-customize.ngrok-free.dev"

for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue ^| Select-Object -Expand OwningProcess -First 1"`) do set "WEB_PID=%%P"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort 4770 -ErrorAction SilentlyContinue ^| Select-Object -Expand OwningProcess -First 1"`) do set "WORKER_PID=%%P"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "Get-CimInstance Win32_Process ^| Where-Object { $_.CommandLine -like '*discord-bot*index.js*' } ^| Select-Object -Expand ProcessId -First 1"`) do set "BOT_PID=%%P"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "Get-Process ngrok -ErrorAction SilentlyContinue ^| Select-Object -Expand Id -First 1"`) do set "NGROK_PID=%%P"

echo Starting web, worker, and bot...
if defined WEB_PID (
  echo Web already running on port 3000 ^(pid %WEB_PID%^)
) else (
  start "Web" /D "%WEB_DIR%" cmd /k npm run dev
)

if defined WORKER_PID (
  echo Worker already running on port 4770 ^(pid %WORKER_PID%^)
) else (
  start "Worker" /D "%WORKER_DIR%" cmd /k npm run dev
)

if defined BOT_PID (
  echo Discord bot already running ^(pid %BOT_PID%^)
) else (
  start "Bot" /D "%BOT_DIR%" cmd /k npm run dev
)

if defined NGROK_PID (
  echo ngrok already running ^(pid %NGROK_PID%^)
) else (
  where ngrok >nul 2>nul
  if not errorlevel 1 (
    echo Starting ngrok tunnel on 4770...
    start "ngrok" /D "%ROOT%" cmd /k ngrok http 4770 --url %DAEMON_URL%
  ) else (
    echo ngrok not found on PATH. Skipping tunnel.
  )
)

echo All launch windows opened.
exit /b 0
