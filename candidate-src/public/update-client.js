// Browser updates go directly to the independent runtime supervisor on port 3212.
// Even if the Bazaar server on port 3210 is stuck, the already loaded browser page
// can still request an update and inspect its progress.
const MANAGER='http://127.0.0.1:3212';
const updateBtn=document.getElementById('updateBtn');
const checkBtn=document.getElementById('checkUpdateBtn');
const bar=document.getElementById('updateBar');
const label=document.getElementById('updateText');
let busy=false;

async function request(path,method='GET'){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const result=await fetch(MANAGER+path,{method,headers:{'content-type':'application/json'},cache:'no-store',signal:controller.signal});
    const value=await result.json();
    if(!result.ok)throw Error(value.error||'Update manager returned HTTP '+result.status);
    return value;
  }finally{clearTimeout(timer);}
}
function show(message){
  if(bar)bar.hidden=false;
  if(label)label.textContent=message;
}
async function checkIndependent(){
  const result=await request('/check');
  if(result.error)throw Error(result.error);
  if(result.updateAvailable){
    show('BazaarFlipper v'+result.latestVersion+' is available (independent updater ready)');
    if(updateBtn){updateBtn.disabled=false;updateBtn.hidden=false;}
  }else{
    show('Already running BazaarFlipper v'+result.currentVersion);
    if(updateBtn)updateBtn.hidden=true;
  }
  return result;
}
async function monitor(){
  for(let n=0;n<300;n++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    const s=await request('/status').catch(()=>null);
    if(!s)continue;
    if(s.phase==='success'){
      show('Update completed: v'+s.lastCompletedVersion+'. Reconnecting…');
      await new Promise(resolve=>setTimeout(resolve,1000));
      location.reload();
      return;
    }
    if(s.phase==='rolled-back'||s.phase==='recovery-required'){
      throw Error((s.lastError||'Update failed')+'; phase='+s.phase);
    }
    show('Update: '+s.phase.replaceAll('-',' ')+'…');
  }
  throw Error('Update is still running; see logs/runtime-manager.log');
}
async function startUpdate(event){
  event.preventDefault();
  event.stopImmediatePropagation();
  if(busy)return;
  busy=true;if(updateBtn)updateBtn.disabled=true;
  try{
    await checkIndependent();
    await request('/apply','POST');
    await monitor();
  }catch(e){
    show('Independent update failed: '+(e?.message||e));
    console.error('[updater]',e);
  }finally{
    busy=false;if(updateBtn)updateBtn.disabled=false;
  }
}
async function checkOnly(event){
  event.preventDefault();
  event.stopImmediatePropagation();
  if(busy)return;
  busy=true;
  try{await checkIndependent();}
  catch(e){
    show('Cannot contact independent update manager: '+(e?.message||e)+'. Start BazaarFlipper from start-bazaarflip.bat.');
    console.error('[updater]',e);
  }finally{busy=false;}
}
// Use capture phase so old app.js cannot route updates through /api/update/apply.
updateBtn?.addEventListener('click',startUpdate,true);
checkBtn?.addEventListener('click',checkOnly,true);
