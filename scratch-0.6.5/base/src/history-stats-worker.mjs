import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { loadHistoryStats } from './db.mjs';

let db;
try {
  db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  try { db.exec('PRAGMA busy_timeout = 5000;'); } catch {}
  const stats = loadHistoryStats(
    db,
    Number(workerData.nowTs) || Date.now(),
    Number(workerData.historyIntervalSeconds) || 300
  );
  parentPort.postMessage({ ok: true, entries: [...stats.entries()] });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error?.stack || error?.message || String(error) });
} finally {
  try { db?.close(); } catch {}
}
