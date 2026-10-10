#!/usr/bin/env node
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const file=path.resolve('candidate-src/src/minion-data.mjs');
const {MINION_DATA:D}=await import(pathToFileURL(file).href+'?loaded='+Date.now());
const repo='NotEnoughUpdates/NotEnoughUpdates-REPO';
async function get(url,retries=2){
 for(let attempt=0;attempt<=retries;attempt++){
  try{
   const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),18000);
   let r;try{r=await fetch(url,{signal:ctl.signal,headers:{'user-agent':'BazaarFlipper-minion-audit','accept':'application/json'}});}finally{clearTimeout(timer)}
   if(r.status===404)return null;
   if(r.ok)return await r.json();
   if(attempt===retries)throw Error('HTTP '+r.status+' '+url);
  }catch(e){if(attempt===retries)throw e}
  await new Promise(ok=>setTimeout(ok,500*(attempt+1)));
 }
}
const sha=(await get('https://api.github.com/repos/'+repo+'/commits/master'))?.sha;
if(!/^[0-9a-f]{40}$/.test(sha))throw Error('Unable to pin NEU source revision');
const url='https://raw.githubusercontent.com/'+repo+'/'+sha+'/items/';
console.log('Pinned NotEnoughUpdates-REPO revision',sha);
const skipTool=/^(WOOD|STONE|IRON|GOLD|DIAMOND)_(AXE|PICKAXE|HOE|SPADE|SWORD)$/;
function entry(s){
 if(typeof s!=='string')return null;
 const i=s.lastIndexOf(':'),item=s.slice(0,i).toUpperCase(),amount=Number(s.slice(i+1));
 return i>0&&item&&Number.isFinite(amount)&&amount>0?{item,amount}:null;
}
function parsed(j,id,tier){
 if(!j||j.internalname!==id+'_'+tier)return null;
 const alternatives=[...(j.recipe&&typeof j.recipe==='object'?[j.recipe]:[]),
    ...(Array.isArray(j.recipes)?j.recipes.filter(x=>!x.type||x.type==='crafting'):[])];
 for(const rec of alternatives){
  const ingredients=new Map(),tools=[],predecessor={found:false},invalid={found:false};
  for(const [slot,raw] of Object.entries(rec)){
   if(!/^[ABC][123]$/.test(slot)||!raw)continue;
   const x=entry(raw);
   if(!x){invalid.found=true;break}
   if(tier>1 && x.item===id+'_'+(tier-1) && x.amount===1){predecessor.found=true;continue}
   if(tier===1&&slot==='B2'&&skipTool.test(x.item)){tools.push(x.item);continue}
   ingredients.set(x.item,(ingredients.get(x.item)||0)+x.amount);
  }
  if(!invalid.found&&(tier===1||predecessor.found)&&ingredients.size)
   return {items:[...ingredients].map(([item,amount])=>({item,amount})),tools};
 }
 return null;
}
function canon(rows){return JSON.stringify(rows.map(x=>[x.item,x.amount]).sort((a,b)=>a[0].localeCompare(b[0])))}
const npc12={
 GHAST_GENERATOR:[{item:'SILVER_FANG',amount:1024},{item:'COINS',amount:2000000}],
 QUARTZ_GENERATOR:[{item:'ENCHANTED_QUARTZ_BLOCK',amount:16},{item:'COINS',amount:2000000}],
 GLOWSTONE_GENERATOR:[{item:'ENCHANTED_GLOWSTONE',amount:32},{item:'COINS',amount:2000000}],
 BLAZE_GENERATOR:[{item:'ENCHANTED_BLAZE_ROD',amount:16},{item:'COINS',amount:2000000}],
 MAGMA_CUBE_GENERATOR:[{item:'ENCHANTED_MAGMA_CREAM',amount:1024},{item:'COINS',amount:2000000}],
 MYCELIUM_GENERATOR:[{item:'ENCHANTED_MYCELIUM_CUBE',amount:32},{item:'COINS',amount:2000000}]
};
const jobs=[];
for(const minion of Object.values(D.definitions)){
 if(minion.special)continue;
 for(const tier of Object.keys(minion.tiers||{}).map(Number))jobs.push({minion,tier,id:minion.id});
}
let cursor=0,done=0,success=0,missing=[],errors=[],storage=0;
const rawRecipes=new Map(),toolMap=new Map();
async function worker(){
 while(cursor<jobs.length){
  const j=jobs[cursor++],name=j.id+'_'+j.tier;
  try{
   const record=await get(url+name+'.json',1);
   const craft=parsed(record,j.id,j.tier);
   if(craft){rawRecipes.set(name,craft.items);if(craft.tools.length)toolMap.set(j.id,craft.tools);success++}
   else missing.push(name);
   if(Array.isArray(record?.lore)){
    const lines=record.lore.map(s=>String(s).replace(/§./g,'')).join(' ');
    const m=lines.match(/Max Storage:\s*([0-9,]+)/i);
    if(m){j.minion.tiers[j.tier].storage=Number(m[1].replace(/,/g,''));storage++}
   }
  }catch(error){errors.push({id:name,error:String(error).slice(0,180)})}
  done++;
  if(done%100===0)console.log('Fetched',done,'/',jobs.length,'recipes',success,'missing',missing.length,'errors',errors.length);
 }
}
await Promise.all(Array.from({length:8},worker));
let complete11=0,complete12=0,partial=0,conflicts=[];
const source='https://github.com/'+repo+'/tree/'+sha+'/items';
for(const minion of Object.values(D.definitions)){
 if(minion.special)continue;
 const tiers=Object.keys(minion.tiers||{}).map(Number);
 const exact={};
 for(const tier of tiers)if(rawRecipes.has(minion.id+'_'+tier))exact[tier]=rawRecipes.get(minion.id+'_'+tier);
 if(minion.tiers[12]&&npc12[minion.id]&&!exact[12])exact[12]=npc12[minion.id];
 if(minion.id==='GHAST_GENERATOR'){
  for(const [tier,old] of Object.entries(minion.upgradeRecipes||{}))
   if(exact[tier]&&canon(old)!==canon(exact[tier]))conflicts.push({tier,existing:old,new:exact[tier]});
 }
 if(tiers.filter(x=>x<=11).length===11 && tiers.filter(x=>x<=11).every(x=>exact[x]?.length)){
  minion.upgradeRecipes=exact;
  minion.recipeSource=source;
  if(toolMap.has(minion.id))minion.warnings=[...new Set([...(minion.warnings||[]),
    'The Tier I vanilla tool cost is excluded; Bazaar ingredient costs use exact NEU recipes.'])];
  complete11++;
  if(exact[12])complete12++;
 }else partial++;
}
if(conflicts.length)throw Error('Ghast recipes conflict with preverified steps: '+JSON.stringify(conflicts));
if(errors.length>7)throw Error('Too many source errors: '+JSON.stringify(errors.slice(0,8)));
// Keep backward-compatible cumulative tier recipes in exact agreement with the
// authoritative per-tier recipes; clear unknown NPC transitions rather than pricing guesses.
for(const m of Object.values(D.definitions)){
 if(!m.upgradeRecipes)continue;
 const sum=new Map();
 for(const tier of Object.keys(m.tiers||{}).map(Number).sort((a,b)=>a-b)){
  const step=m.upgradeRecipes[tier],info=m.tiers[tier];
  if(!Array.isArray(step)||!step.length){info.recipe=null;info.exactRecipe=false;continue;}
  for(const part of step)sum.set(part.item,(sum.get(part.item)||0)+part.amount);
  info.recipe=[...sum].map(([item,amount])=>({item,amount}));
  info.exactRecipe=true;
 }
}
D.recipeDataVersion={cumulativeDerivedFromExactSteps:true,source,commit:sha,importedAt:new Date().toISOString(),
 completeThrough11:complete11,completeThrough12:complete12,
 totalTierFiles:jobs.length,exactRecipes:success,missing:missing.length,errors:errors.length,
 withVerifiedStorage:storage,unverifiedMinions:partial};
fs.writeFileSync(file,'export const MINION_DATA = '+JSON.stringify(D,null,2)+';\n');
fs.writeFileSync('neu-import-report.json',JSON.stringify({...D.recipeDataVersion,
  missingExamples:missing.slice(0,100),errors},null,2));
console.log('NEU_IMPORT_REPORT',JSON.stringify(D.recipeDataVersion));
