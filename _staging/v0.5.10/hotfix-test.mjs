import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDatabase, ensureExtendedHistorySchema } from './src/db.mjs';

const server=fs.readFileSync('./server.mjs','utf8');
const pkg=JSON.parse(fs.readFileSync('./package.json','utf8'));
const apply=fs.readFileSync('./src/apply-update.mjs','utf8');

assert.equal(pkg.version,'0.5.10');
assert(server.includes("openDatabase(dbPath,{deferExtendedHistory:true})"));
assert(server.includes("historySchemaReady = false"));
assert(server.includes("server.listen(port, host, () => {"));
assert(server.includes("health check can pass before extended migration"));
assert(server.includes("ensureExtendedHistorySchema(db)"));
assert(server.includes("setTimeout(()=>{void completeStartup();},5000)"));
assert(server.includes("historySchemaReady,"));
assert(server.indexOf("server.listen(port, host") < server.lastIndexOf("ensureExtendedHistorySchema(db)"));
assert(apply.includes("for (let i = 0; i < 240; i += 1)"));
assert(apply.includes("update-startup.log"));
assert(apply.includes("health check failed after"));
assert(apply.includes("failed health check after 120 seconds"));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bz-0510-'));
const dbPath=path.join(tmp,'test.sqlite');
const db=openDatabase(dbPath,{deferExtendedHistory:true});
try{
  let cols=new Set(db.prepare('PRAGMA table_info(history)').all().map(r=>String(r.name)));
  assert(!cols.has('weighted_buy_price'),'extended history must truly be deferred');
  const before=db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='history_hourly'").get().n;
  assert.equal(Number(before),0);
  ensureExtendedHistorySchema(db);
  cols=new Set(db.prepare('PRAGMA table_info(history)').all().map(r=>String(r.name)));
  assert(cols.has('weighted_buy_price'));
  assert(cols.has('buy_depth_5pct'));
  const after=db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='history_hourly'").get().n;
  assert.equal(Number(after),1);
  // idempotent
  ensureExtendedHistorySchema(db);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='history_daily'").get().n),1);
}finally{
  db.close();
  fs.rmSync(tmp,{recursive:true,force:true});
}
console.log('v0.5.10 hotfix tests: PASS');
