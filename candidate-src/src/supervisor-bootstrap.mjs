/**
 * One-time bridge from the legacy v0.6.13 updater.
 *
 * The old apply-update.mjs launches "node server.mjs" directly after it
 * replaces program files. v0.7+ uses runtime-manager.mjs instead. Keep
 * this legacy entry point alive as a supervisor launcher so the old updater
 * can still verify /api/status, while all subsequent updates use port 3212.
 *
 * Managed children explicitly opt out via BAZAAR_MANAGED_CHILD=1.
 */
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if(process.env.BAZAAR_MANAGED_CHILD!=='1'){
  const root=path.dirname(fileURLToPath(import.meta.url).replace(/[\\/]src[\\/]supervisor-bootstrap\.mjs$/,''));
  const entry=path.join(root,'runtime-manager.mjs');
  const manager=spawn(process.execPath,[entry],{
    cwd:root,
    env:{...process.env,BAZAAR_SUPERVISOR_BOOTSTRAP:'1'},
    stdio:'inherit',
    windowsHide:true
  });
  let stopping=false;
  const forward=(signal)=>{
    if(stopping)return;
    stopping=true;
    try{manager.kill(signal);}catch{}
  };
  process.once('SIGINT',()=>forward('SIGINT'));
  process.once('SIGTERM',()=>forward('SIGTERM'));
  await new Promise((resolve,reject)=>{
    manager.once('error',reject);
    manager.once('exit',(code,signal)=>{
      if(!stopping&&code!==0)reject(Error('BazaarFlipper supervisor failed: '+code+' / '+signal));
      else resolve();
    });
  });
  // Do not continue to load the legacy HTTP server after the manager exits.
  process.exit(0);
}
