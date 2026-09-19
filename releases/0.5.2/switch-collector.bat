@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; try { Write-Host 'Syncing Bazaar history with the other computer...' -ForegroundColor Cyan; $r=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3210/api/handoff/sync' -TimeoutSec 240; Write-Host ('Sync complete. Sent '+$r.sentSnapshots+' snapshots / '+$r.sentRows+' rows.') -ForegroundColor Green } catch { Write-Host $_.Exception.Message -ForegroundColor Red }; Read-Host 'Press ENTER'"
