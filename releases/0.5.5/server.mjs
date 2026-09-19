import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const generated = path.join(root, 'server-core-v055.mjs');

function latestUpdaterBackup() {
  const dir = path.join(root, 'data', 'updates');
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^backup-\d+-0\.5\.5$/.test(entry.name))
    .map((entry) => ({ name: entry.name, file: path.join(dir, entry.name, 'server.mjs') }))
    .filter((entry) => fs.existsSync(entry.file))
    .sort((a, b) => b.name.localeCompare(a.name));
  return candidates[0]?.file ?? null;
}

if (!fs.existsSync(generated)) {
  const backup = latestUpdaterBackup();
  if (!backup) throw new Error('BazaarFlipper v0.5.5 hotfix could not find the updater backup of server.mjs.');
  let source = fs.readFileSync(backup, 'utf8');

  const busyOld = "if(syncRunning) return {ok:true,busy:true,pendingSync:pendingSync(),...state.dualSync};";
  const busyNew = "if(syncRunning) return {ok:true,busy:true,cumulative:{...state.dualSync},sentSnapshots:0,sentRows:0,acknowledgedSnapshots:0,deletedRows:0,pendingSync:pendingSync()};";
  const resultOld = "return {ok:true,sentSnapshots,sentRows,acknowledgedSnapshots,deletedRows,pendingSync:pendingSync(),...state.dualSync};";
  const resultNew = "return {ok:true,cumulative:{...state.dualSync},sentSnapshots,sentRows,acknowledgedSnapshots,deletedRows,pendingSync:pendingSync()};";

  if (!source.includes(busyOld) || !source.includes(resultOld)) {
    throw new Error('BazaarFlipper v0.5.5 hotfix did not recognize the installed v0.5.4 sync code; no changes were applied.');
  }
  source = source.replace(busyOld, busyNew).replace(resultOld, resultNew);
  fs.writeFileSync(generated, source, 'utf8');
}

await import(`${pathToFileURL(generated).href}?v=055`);
