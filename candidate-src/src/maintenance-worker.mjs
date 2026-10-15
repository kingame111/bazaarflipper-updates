import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {cleanupHistory} from './db.mjs';

let db;
try{
  db=new DatabaseSync(workerData.dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000;');
  // The archiving transaction can be expensive on a large database; never run it
  // synchronously in the Node HTTP server's event loop.
  const result=cleanupHistory(db,workerData.rawCutoffTs,workerData.hourlyCutoffTs);
  parentPort.postMessage({ok:true,result});
}catch(error){
  parentPort.postMessage({ok:false,error:error?.stack||error?.message||String(error)});
}finally{
  try{db?.close();}catch{}
}
