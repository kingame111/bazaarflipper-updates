import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {resolveCumulativeTierRecipe} from '../candidate-src/src/minion-recipes.mjs';
import {calculateMinion,calculateMinionRankings,minionCatalog} from '../candidate-src/src/minions.mjs';

const money={
 GHAST_TEAR:20,ENCHANTED_GHAST_TEAR:100,SILVER_FANG:3000,
 DIAMOND_SPREADING:400,ENCHANTED_LAVA_BUCKET:2000,
 FLYCATCHER:1000,CORRUPT_SOIL:2000
};
const market={};
function q(p){return{buy_summary:[{pricePerUnit:p*0.9}],sell_summary:[{pricePerUnit:p}],quick_status:{buyPrice:p*0.9,sellPrice:p}}}
for(const [k,v] of Object.entries(money))market[k]=q(v);
const ctx={market,historyStats:new Map(),itemMeta:new Map(),taxRate:0,priceMode:'LIVE',sellMethod:'NPC',historyDays:7};
const base={tier:11,count:1,fuel:'NONE',upgrade1:'NONE',upgrade2:'NONE',sellMethod:'NPC',priceMode:'LIVE',collectionIntervalDays:1,horizonDays:30};
const ghast=MINION_DATA.definitions['Ghast Minion'];
assert.ok(ghast);
const exp=960*20+768*100+992*3000;
assert.equal(resolveCumulativeTierRecipe(ghast,11).complete,true);
assert.equal(resolveCumulativeTierRecipe(ghast,11).recipe.find(x=>x.item==='SILVER_FANG').amount,992);
const r11=calculateMinion(ghast,base,ctx);
assert.equal(r11.setupCost,exp);
assert.equal(r11.recipeSource,'EXPLICIT_STEPS');
assert.equal(r11.setupComplete,true);
assert.equal(r11.setupBreakdown.filter(x=>x.item==='SILVER_FANG').length,5);
assert.equal(r11.setupBreakdown.find(x=>x.tier===11).amount,512);
const r12=calculateMinion(ghast,{...base,tier:12},ctx);
assert.equal(r12.setupCost,exp+1024*3000+2000000);
assert.equal(r12.setupBreakdown.some(x=>x.item==='COINS'&&x.amount===2000000&&x.tier===12),true);
assert.equal(calculateMinion(ghast,{...base,tier:2},ctx).setupCost,192*20);
assert.equal(calculateMinion(ghast,{...base,tier:6},ctx).setupCost,960*20+768*100);

const missingMarket={...market};delete missingMarket.SILVER_FANG;
const missing=calculateMinion(ghast,base,{...ctx,market:missingMarket});
assert.equal(missing.setupComplete,false);
assert.equal(missing.paybackDays,null);
assert.equal(missing.setupMissing.includes('SILVER_FANG'),true);

const snow=MINION_DATA.definitions['Snow Minion'];
assert.ok(snow);
const baseSnow=calculateMinion(snow,base,ctx);
const spread=calculateMinion(snow,{...base,upgrade1:'DIAMOND_SPREADING'},ctx);
const expectedDiamonds=baseSnow.outputDetails.filter(x=>x.source==='MINION').reduce((n,x)=>n+x.rawUnitsPerDay,0)*0.1;
const diamond=spread.outputDetails.find(x=>x.item==='DIAMOND'&&x.source==='DIAMOND_SPREADING');
assert.ok(diamond);
assert.ok(Math.abs(diamond.rawUnitsPerDay-expectedDiamonds)<1e-6,'Diamond Spreading per item');

const sorted=calculateMinionRankings({...base,tier:11,sort:'PAYBACK'}, {...ctx,market:missingMarket});
const validIndex=sorted.rows.findIndex(x=>x.supported&&Number.isFinite(x.paybackDays));
const missingIndex=sorted.rows.findIndex(x=>x.supported&&x.paybackDays==null);
assert.ok(validIndex>=0&&missingIndex>validIndex,'N/A sorts after priced rows');

const opts={...base,sort:'NET',optimizeFor:'HORIZON',horizonDays:3};
const horizon=calculateMinionRankings(opts,ctx);
assert.equal(horizon.horizonDays,3);
assert.ok(horizon.rows.some(x=>x.supported&&x.optimizeFor==='HORIZON'));
const paybackOpt=calculateMinionRankings({...base,optimizeFor:'PAYBACK',sort:'PAYBACK'},ctx);
assert.ok(paybackOpt.rows.some(x=>x.supported&&x.optimizeFor==='PAYBACK'));
const highTier={...ghast,tiers:{...ghast.tiers,13:{speed:28,recipe:null,exactRecipe:false}}};
const future=calculateMinion(highTier,{...base,tier:13},ctx);
assert.equal(future.supported,true);
assert.equal(future.tier,13);
assert.equal(future.paybackDays,null,'unverified future tier fails closed');
const missingLegacy=calculateMinion(MINION_DATA.definitions['Acacia Minion'],{...base,tier:2},ctx);
assert.equal(missingLegacy.setupComplete,false);
assert.equal(missingLegacy.paybackDays,null);

const cat=minionCatalog();
assert.ok(cat.minions.length>=61);
const srv=fs.readFileSync('candidate-src/server.mjs','utf8');
const html=fs.readFileSync('candidate-src/public/minions.html','utf8');
const js=fs.readFileSync('candidate-src/public/minions.js','utf8');
for(const x of ['optimizeFor','horizonDays']) {
 assert.ok(srv.includes(x),'API '+x);
 assert.ok(html.includes('id="'+x+'"'),'UI '+x);
 assert.ok(js.includes("'"+x+"'"),'UI params '+x);
}
assert.ok(!js.includes('for(let i=1;i<=12;i++)'));
console.log(JSON.stringify({status:'PASS',families:cat.minions.length,ghast11:exp,ghast12:r12.setupCost,diamondSnow:diamond.rawUnitsPerDay,expectedDiamonds,paybackNARank:missingIndex,horizon:3,tests:23}));
