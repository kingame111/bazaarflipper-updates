import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const bundle=Buffer.from(manifest.bundle.parts.map(p=>fs.readFileSync(p,'utf8').trim()).join(''),'base64');
assert.equal(sha(bundle),manifest.bundle.sha256,'Manifest package checksum');
const files=JSON.parse(gunzipSync(bundle).toString('utf8')).files;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'minion-audit-'));
for(const entry of manifest.files){
  const buf=Buffer.from(files[entry.path],'base64');
  assert.equal(sha(buf),entry.sha256,entry.path+' checksum');
  const p=path.join(dir,entry.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,buf);
}
const {MINION_DATA:data}=await import(pathToFileURL(path.join(dir,'src/minion-data.mjs')).href);
const {calculateMinion,calculateMinionRankings,minionCatalog}=await import(pathToFileURL(path.join(dir,'src/minions.mjs')).href);
const source=fs.readFileSync(path.join(dir,'src/minions.mjs'),'utf8');
const definitions=Object.values(data.definitions);
const upgrades=Object.keys(data.upgrades);
const fuels=Object.keys(data.fuels);
const ids=new Set();
function scan(obj){
  if(!obj||typeof obj!=='object')return;
  if(Array.isArray(obj)){for(const x of obj)scan(x);return;}
  for(const [k,v] of Object.entries(obj)){
    if(['item','itemId','from','to'].includes(k)&&typeof v==='string')ids.add(v);
    if(k==='enchanted'&&v&&typeof v==='object')for(const id of Object.keys(v))ids.add(id);
    if(v&&typeof v==='object')scan(v);
  }
}
scan(data);
for(const k of upgrades)if(k!=='NONE')ids.add(k);
for(const k of fuels)if(k!=='NONE')ids.add(k);
for(const k of Object.keys(data.setupRecipes||{}))ids.add(k);
function seed(k){let n=2166136261>>>0;for(const c of k){n=Math.imul(n^c.charCodeAt(0),16777619)>>>0}return n}
const market={};
for(const id of ids){const sell=10+(seed(id)%5000)/10;market[id]={buy_summary:[{pricePerUnit:sell*0.91}],sell_summary:[{pricePerUnit:sell}],quick_status:{buyPrice:sell*.91,sellPrice:sell}};}
const ctx={market,historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125,priceMode:'LIVE',sellMethod:'BEST',historyDays:7};
const opts={tier:11,count:1,collectionIntervalDays:1,fuel:'ENCHANTED_LAVA_BUCKET',sellMethod:'BEST',priceMode:'LIVE',compareDays:7};
const issues=[];
const issue=(sev,id,data)=>issues.push({severity:sev,id,data});
const missingRecipes=[],missingSpeeds=[],missingDrops=[],ghastDetails={},tiers={},missingSetup=[],invalidArithmetic=[],exceptions=[],transitions=[];
let modeled=0,supported=0,total=0,tierCases=0,fuelCases=0,upgradeCases=0,scaleCases=0,historyCases=0;
for(const m of definitions){
  const ts=Object.entries(m.tiers||{});
  tiers[ts.length]=(tiers[ts.length]||0)+1;
  if(m.special)continue;
  modeled++;
  let last=null,lastTier=null;
  for(const [tier,entry] of ts){
    tierCases++;
    if(!entry.exactRecipe||!Array.isArray(entry.recipe))missingRecipes.push(m.name+' T'+tier);
    if(!(Number(entry.speed)>0))missingSpeeds.push(m.name+' T'+tier);
    const curr=(entry.recipe||[]).map(x=>x.item).sort().join(',');
    if(last!==null&&curr!==last)transitions.push(m.name+' T'+lastTier+'->T'+tier+': '+last+' => '+curr);
    if(entry.exactRecipe){last=curr;lastTier=tier}
    try{
      const r=calculateMinion(m,{...opts,tier:Number(tier),fuel:'NONE',upgrade1:'NONE',upgrade2:'NONE'},ctx);
      total++;if(!r.supported)exceptions.push(m.name+' T'+tier+' unsupported');
      if(r.supported&&!r.setupComplete)missingSetup.push(m.name+' T'+tier);
      for(const k of ['grossDay','netDay','bazaarTaxDay','expensesDay','cyclesPerDay'])
       if(r.supported&&!Number.isFinite(r[k]))invalidArithmetic.push(m.name+' T'+tier+' '+k);
      if(r.supported&&Math.abs(r.netDay-(r.grossDay-r.bazaarTaxDay-r.expensesDay))>1e-7*Math.max(1,Math.abs(r.netDay)))
        invalidArithmetic.push(m.name+' T'+tier+' net mismatch');
    }catch(e){exceptions.push(m.name+' T'+tier+': '+e.message)}
  }
  if(!(m.drops||[]).length)missingDrops.push(m.name);
  for(const fuel of fuels){
    fuelCases++;try{const r=calculateMinion(m,{...opts,fuel,upgrade1:'NONE',upgrade2:'NONE'},ctx);total++;if(!r.supported)exceptions.push(m.name+' fuel '+fuel+' unsupported');}
    catch(e){exceptions.push(m.name+' fuel '+fuel+' '+e.message)}
  }
  for(const up of upgrades){
    upgradeCases++;try{const r=calculateMinion(m,{...opts,upgrade1:up,upgrade2:'NONE'},ctx);total++;if(!r.supported)exceptions.push(m.name+' up '+up+' unsupported');}
    catch(e){exceptions.push(m.name+' up '+up+' '+e.message)}
  }
  try{
    const a=calculateMinion(m,{...opts,count:1,upgrade1:'NONE',upgrade2:'NONE'},ctx);
    const b=calculateMinion(m,{...opts,count:4,upgrade1:'NONE',upgrade2:'NONE'},ctx);
    scaleCases++;
    if(a.supported&&b.supported){
      for(const key of ['grossDay','netDay','bazaarTaxDay','expensesDay'])
        if(Math.abs(a[key]*4-b[key])>Math.max(1,Math.abs(b[key]))*1e-7)invalidArithmetic.push(m.name+' 4x count '+key);
      if(a.paybackDays!=null&&b.paybackDays!=null&&Math.abs(a.paybackDays-b.paybackDays)>1e-7)invalidArithmetic.push(m.name+' count payback');
    }
    const r=calculateMinion(m,opts,ctx);
    if(r.supported){supported++;if(!r.setupComplete)missingSetup.push(m.name+' T11 setup '+r.setupMissing.join(','))}
  }catch(e){exceptions.push(m.name+' summary '+e.stack)}
}
const histStats=new Map();
for(const id of ids){const x={};for(let d=1;d<=7;d++){x['avgBuy'+d+'d']=100;x['avgSell'+d+'d']=150;x['coverage'+d+'d']=0.85;x['cvMid'+d+'d']=0.10;x['samples'+d+'d']=250;}histStats.set(id,x);}
const histCtx={...ctx,historyStats:histStats,priceMode:'7D'};
for(const m of definitions.filter(m=>!m.special)){
  historyCases++;try{
    const r=calculateMinion(m,{...opts,priceMode:'7D',upgrade1:'NONE',upgrade2:'NONE'},histCtx);
    if(r.supported&&!Number.isFinite(r.netDay))invalidArithmetic.push(m.name+' historical net');
  }catch(e){exceptions.push(m.name+' history '+e.message)}
}
let rankingScenarios=[];
for(const change of [
  {sort:'NET'}, {sort:'PAYBACK'}, {sort:'ROI'}, {sort:'GROSS'},
  {search:'ghast'}, {excludedUpgrades:['FLYCATCHER','CORRUPT_SOIL']},
  {sort:'NET',priceMode:'7D'}
]){
  try{
    const r=calculateMinionRankings({...opts,...change},{...ctx,historyStats:histStats});
    const rows=r.rows||[];
    const excluded=change.excludedUpgrades||[];
    if(rows.some(x=>(x.upgrades||[]).some(y=>excluded.includes(y.id))))invalidArithmetic.push('excluded upgrade selected');
    if(change.search&&rows.some(x=>!x.name.toLowerCase().includes(change.search)))invalidArithmetic.push('search mismatch');
    rankingScenarios.push({scenario:change,rows:rows.length,first:rows[0]?.name,firstPayback:rows[0]?.paybackDays,unpriced:rows.filter(x=>x.supported&&!x.setupComplete).length});
  }catch(e){exceptions.push('ranking '+JSON.stringify(change)+' '+e.stack)}
}
const g=data.definitions['Ghast Minion'];
if(g){for(const [n,v] of Object.entries(g.tiers||{}))ghastDetails[n]={speed:v.speed,recipe:v.recipe,exactRecipe:v.exactRecipe};}
if(g?.tiers?.['11']?.recipe?.some(e=>e.item==='ENCHANTED_GHAST_TEAR'))issue('CRITICAL','GHAST_T11_RECIPE_CONVERTED','Cumulative recipe uses Enchanted Ghast Tears instead of Silver Fang despite different market price.');
if(missingRecipes.length)issue('HIGH','INCOMPLETE_RECIPES',{count:missingRecipes.length,samples:missingRecipes.slice(0,20)});
if(missingSetup.length)issue('HIGH','UNPRICED_TIER_SETUP',{count:missingSetup.length,samples:missingSetup.slice(0,15)});
if(missingSpeeds.length)issue('CRITICAL','MISSING_SPEED',missingSpeeds.slice(0,15));
if(missingDrops.length)issue('HIGH','MISSING_DROPS',missingDrops.slice(0,15));
if(invalidArithmetic.length)issue('CRITICAL','INVARIANT_FAIL',invalidArithmetic.slice(0,30));
if(exceptions.length)issue('CRITICAL','EXECUTION_FAIL',exceptions.slice(0,30));
if(source.includes("row.paybackDays == null ? Infinity : -row.paybackDays"))issue('HIGH','PAYBACK_NA_SORT','Unpriced/N/A rows may be incorrectly sorted ahead of valid payback rows.');
if(!/storage|hopper/i.test(source))issue('HIGH','NO_STORAGE_OR_HOPPER_MODEL','Production and long collection periods ignore storage/hopper behavior.');
if(source.includes('for (const drop of up.extraDrops || []) addDrop(drop,cyclesPerDay,up.id,fuelDropMultiplier)'))issue('HIGH','UPGRADE_DROPS_PER_CYCLE','All extra drops applied once per collection cycle rather than per generated item; check Diamond Spreading.');
if(source.includes('let order = live.sellOrder;')&&!source.includes('order = hist.sellOrder'))issue('HIGH','HISTORICAL_SELL_ORDER_LIVE','History mode keeps live sell-order price.');
if(source.includes('Math.min(12, Math.floor(safe(options.tier') || source.includes('Math.min(12,'))issue('HIGH','MAX_TIER_HARDCODED','Tier selection hardcodes maximum 12; future tiers will not work.');
if(source.includes('const cyclesPerDay = DAY_SECONDS / (secondsPerAction * 2);'))issue('MEDIUM','ALL_MINIONS_TWO_ACTIONS','Two actions per cycle for every minion; verify category-specific mechanics.');
if(source.includes('const first = Object.entries(drop.enchanted).find('))issue('MEDIUM','SINGLE_COMPACTION_CHAIN','Compaction chooses first enchanted branch; mixed recipes and item transformations need validation.');
if(source.includes('if (requested === \'BEST\')')&&source.includes('Object.entries(methods).sort'))issue('MEDIUM','BEST_IGNORES_LIQUIDITY','BEST mode picks theoretical highest price without checking fill/liquidity.');
const report={version:manifest.version,sourceFamilyCount:definitions.length,modeled,supported,tierCounts:tiers,upgrades:upgrades.length,fuels:fuels.length,syntheticMarketIds:ids.size,scenariosExecuted:total+scaleCases+historyCases+rankingScenarios.length,tierCases,fuelCases,upgradeCases,scaleCases,historyCases,exactRecipeMissing:missingRecipes.length,setupMissing:missingSetup.length,materialTransitions:transitions.length,materialTransitionExamples:transitions.slice(0,35),rankingScenarios,ghastDetails,issues};
fs.writeFileSync('minion-audit-results.json',JSON.stringify(report,null,2));
console.log('MINION_AUDIT_REPORT_BEGIN');
console.log(JSON.stringify(report));
console.log('MINION_AUDIT_REPORT_END');
console.log('Audit completed; issue categories:',issues.length,'; execution exceptions:',exceptions.length);
