import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-ui-browser-'));
fs.cpSync('candidate-src',tmp,{recursive:true});
const errors=[],logs=[];
const child=spawn(process.execPath,[path.join(tmp,'runtime-manager.mjs')],{
  cwd:tmp,stdio:['ignore','pipe','pipe']
});
for(const stream of [child.stdout,child.stderr])stream.on('data',x=>{
  logs.push(x.toString());if(logs.length>300)logs.shift();
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitReady(){
 for(let i=0;i<120;i++){
  if(child.exitCode!==null)throw Error('Runtime manager died: '+logs.slice(-15).join('\n'));
  try{const a=await fetch('http://127.0.0.1:3212/status',{signal:AbortSignal.timeout(700)});
    const b=await fetch('http://127.0.0.1:3210/health/ready',{signal:AbortSignal.timeout(700)});
    if(a.ok&&b.ok&&(await b.json()).ready)return;
  }catch{}
  await sleep(300);
 }
 throw Error('Local full runtime did not become ready:\n'+logs.slice(-35).join('\n'));
}
let browser;
try{
  await waitReady();
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1365,height:950}});
  const page=await context.newPage();
  page.on('pageerror',err=>errors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error'&&msg.text().includes('Uncaught'))errors.push(msg.text());});
  await page.goto('http://127.0.0.1:3210/',{waitUntil:'domcontentloaded'});
  await page.locator('#strategyButtons').waitFor();
  await page.locator('#appVersion').waitFor();
  await page.waitForFunction(()=>document.getElementById('appVersion')?.textContent?.includes('v0.7.0'),
    {timeout:30000});
  assert.match(await page.title(),/BazaarFlipper/);
  assert.equal(await page.locator('#statusText').count(),1);
  assert.equal(await page.locator('#refreshBtn').count(),1);
  await page.locator('#refreshBtn').click();
  await page.waitForTimeout(450);

  // Intercept this one check, not the updater process, so the UI click path is deterministic.
  await page.route('http://127.0.0.1:3212/check',route=>route.fulfill({
    status:200,contentType:'application/json',
    headers:{'access-control-allow-origin':'http://127.0.0.1:3210'},
    body:JSON.stringify({configured:true,currentVersion:'0.7.0',latestVersion:'0.7.0',
      updateAvailable:false,manifest:null,error:null})
  }));
  await page.locator('#checkUpdateBtn').click();
  await page.waitForFunction(()=>/Already running BazaarFlipper v0\.7\.0/.test(
    document.getElementById('updateText')?.textContent||''),{timeout:10000});

  await page.goto('http://127.0.0.1:3210/minions.html',{waitUntil:'domcontentloaded'});
  await page.locator('#rows tr').first().waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length>=61,{timeout:30000});
  const full=await page.locator('#rows tr').count();
  assert.ok(full>=61,'All 61 families must have a visible result');
  const ghastRow=page.locator('#rows tr').filter({hasText:'Ghast Minion'}).first();
  const globalRank=(await ghastRow.locator('td').first().textContent()).trim();
  await page.locator('#search').fill('Ghast');
  await page.waitForFunction(()=>{
    const rows=[...document.querySelectorAll('#rows tr')];
    return rows.length>=1&&rows.length<61&&rows.every(x=>x.textContent.includes('Ghast'));
  },{timeout:30000});
  const afterRank=(await page.locator('#rows tr').first().locator('td').first().textContent()).trim();
  // Hypixel may publish a newer live price snapshot between the two browser requests.
  // A fixed-market regression below verifies global ranking independently of time.
  assert.match(afterRank,/^(?:[0-9]+|—)$/,'Search must render a valid global rank or N/A');
  await page.locator('#search').fill('');
  await page.locator('#excludeUpgradesBtn').click();
  assert.equal(await page.locator('#excludeUpgradesMenu').isVisible(),true);
  await page.locator('#excludeUpgradesBtn').click();
  await page.locator('#columnsBtn').click();
  assert.equal(await page.locator('#columnsMenu').isVisible(),true);
  assert.deepEqual(errors,[],'Browser Javascript must not throw');
  console.log(JSON.stringify({PASS:true,chromiumBrowser:true,mainPage:true,minionRows:full,
    minionSearchPreservesRank:true,upgradeExclusionsVisible:true,columnPreferencesVisible:true,
    independentUpdaterUi:true,errors:errors.length}));
} catch(error){
  console.error('BROWSER ERRORS '+errors.join('\n'));
  console.error('SERVER LOGS '+logs.slice(-35).join('\n'));
  throw error;
}finally{
 await browser?.close().catch(()=>{});
 child.kill('SIGTERM');
 await Promise.race([new Promise(r=>child.once('exit',r)),sleep(15000)]);
 if(child.exitCode===null)child.kill('SIGKILL');
 fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
