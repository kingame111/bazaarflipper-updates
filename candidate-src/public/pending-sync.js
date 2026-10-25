const el = document.getElementById('pendingSyncStatus');

async function refreshPendingSync() {
  if (!el) return;
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = await res.json();
    const role = status.handoff?.role || 'UNCONFIGURED';
    if (role !== 'LAPTOP' || !status.handoff?.configured) {
      el.hidden = true;
      return;
    }

    const snapshots = Number(status.pendingSync?.snapshots || 0);
    const rows = Number(status.pendingSync?.rows || 0);
    el.hidden = false;
    el.textContent = snapshots > 0
      ? `Unsynced: ${snapshots.toLocaleString('en-US')} snapshot${snapshots === 1 ? '' : 's'} · ${rows.toLocaleString('en-US')} rows`
      : 'Unsynced: 0 · all collected data is synced';
  } catch {
    if (!el.hidden) el.textContent = 'Unsynced: status unavailable';
  }
}

refreshPendingSync();
const pendingTimer = setInterval(refreshPendingSync, 3000);
window.addEventListener('pagehide', () => clearInterval(pendingTimer), { once: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshPendingSync();
});
