@echo off
setlocal EnableExtensions

cd /d "%~dp0"
echo [kill-watch] Workspace: %CD%

set "KILLED="

echo [kill-watch] Step 1/2: kill listeners on port 6621...
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -LocalPort 6621 -State Listen ^| Select-Object -ExpandProperty OwningProcess -Unique"`) do (
  echo [kill-watch] kill PID %%P (port 6621)
  taskkill /F /PID %%P >nul 2>&1
  set "KILLED=1"
)

echo [kill-watch] Step 2/2: kill stale project watch/sync processes...
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process ^| Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe' -or $_.Name -eq 'powershell.exe') -and $_.CommandLine -match 'Quick-Reply-Manager' -and ($_.CommandLine -match 'pnpm watch' -or $_.CommandLine -match 'webpack.*--watch' -or $_.CommandLine -match 'watch-clean.bat' -or $_.CommandLine -match 'sync watch') } ^| Select-Object -ExpandProperty ProcessId -Unique"`) do (
  echo [kill-watch] kill PID %%P (stale watch/sync)
  taskkill /F /PID %%P >nul 2>&1
  set "KILLED=1"
)

if defined KILLED (
  echo [kill-watch] done.
) else (
  echo [kill-watch] no matching process found.
)

exit /b 0
