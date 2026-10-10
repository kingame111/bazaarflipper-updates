import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
const encoded=manifest.bundle.parts.map(x=>fs.readFileSync(x,'utf8').trim()).join('');
const archive=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')).toString('utf8')).files;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'minion-deep-'));
for(const [p,b] of Object.entries(archive)){const file=path.join(temp,p);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(b,'base64'));}
const {MINION_DATA:D}=await import(pathToFileURL(path.join(temp,'src/minion-data.mjs')).href);
const {calculateMinion:C,calculateMinionRankings:rank}=await import(pathToFileURL(path.join(temp,'src/minions.mjs')).href);
const options={tier:11,count:1,collectionIntervalDays:1,fuel:'NONE',upgrade1:'NONE',upgrade2:'NONE',sellMethod:'ORDER',priceMode:'LIVE'};
const original={market:{},historyStats:new Map(),itemMeta:new Map(),taxRate:0,priceMode:'LIVE',sellMethod:'ORDER',historyDays:7};
const quote=(b,s)=>({buy_summary:[{pricePerUnit:b}],sell_summary:[{pricePerUnit:s}],quick_status:{buyPrice:b,sellPrice:s}});
const seedMarket={GHAST_TEAR:quote(10,20),ENCHANTED_GHAST_TEAR:quote(90,100),SILVER_FANG:quote(2500,3000),ENCHANTED_LAVA_BUCKET:quote(2000,3000)};
for(const m of Object.values(D.definitions)){for(const tier of Object.values(m.tiers||{}))for(const row of tier.recipe||[])if(!seedMarket[row.item])seedMarket[row.item]=quote(100,110);for(const drop of m.drops||[])if(!seedMarket[drop.item])seedMarket[drop.item]=quote(100,110);}
for(const [k,u] of Object.entries(D.upgrades)){if(!seedMarket[k])seedMarket[k]=quote(100,110);for(const drop of u.extraDrops||[])if(!seedMarket[drop.item])seedMarket[drop.item]=quote(100,110);}
for(const [k] of Object.entries(D.fuels))if(!seedMarket[k])seedMarket[k]=quote(100,110);
const ctx={...original,market:seedMarket};
const report={version:manifest.version,checks:[]};
const add=(name,data)=>report.checks.push({name,...data});
const ghast=D.definitions['Ghast Minion'];
const g=C(ghast,{...options,tier:11},ctx);
const expectedBuilding=960*20+768*100+992*3000;
const actualBuilding=960*20+5728*100;
assert.equal(g.setupCost,actualBuilding);
add('Ghast tier XI material pricing',{expectedTierCostAtSyntheticPrices:expectedBuilding,actualMinionSetup:g.setupCost,underestimate:expectedBuilding-g.setupCost,actualPercentOfExpected:g.setupCost/expectedBuilding,recipe:g.setupBreakdown});
const g12=C(ghast,{...options,tier:12},ctx);
add('Ghast tier XII cost',{codeRecipe:g12.setupBreakdown,hasCoinRequirement:ghast.tiers['12'].recipe.some(x=>x.item==='COINS')});
const hmap=new Map([['GHAST_TEAR',{avgBuy7d:25,avgSell7d:777,samples7d:1200,coverage7d:0.97}]]);
const hist=C(ghast,{...options,tier:1,priceMode:'7D',sellMethod:'ORDER'}, {...ctx,historyStats:hmap,priceMode:'7D',sellMethod:'ORDER'});
const live=C(ghast,{...options,tier:1,priceMode:'LIVE',sellMethod:'ORDER'},ctx);
add('Historical ORDER price',{currentSellOrder:live.outputDetails.find(x=>x.item==='GHAST_TEAR')?.quote.raw,expectedHistoricalSellOrder:777,actualHistoryOrder:hist.outputDetails.find(x=>x.item==='GHAST_TEAR')?.quote.raw,historySamples:1200});
const snow=D.definitions['Snow Minion'],clay=D.definitions['Clay Minion'];
for(const m of [snow,clay].filter(Boolean)){
  const r=C(m,{...options,tier:11,upgrade1:'DIAMOND_SPREADING',sellMethod:'NPC'}, {...ctx,sellMethod:'NPC'});
  const diamond=r.outputDetails.find(x=>x.item==='DIAMOND'&&x.source==='DIAMOND_SPREADING');
  const base=C(m,{...options,tier:11,upgrade1:'NONE',sellMethod:'NPC'}, {...ctx,sellMethod:'NPC'});
  add('Diamond spreading '+m.name,{cyclesPerDay:r.cyclesPerDay,baseRawDropsPerDay:base.outputDetails.filter(x=>x.source==='MINION').reduce((a,x)=>a+x.unitsPerDay,0),actualDiamondsPerDay:diamond?.unitsPerDay,algorithmPerCycle:r.cyclesPerDay*0.1});
}
const emptyMarket={...seedMarket};delete emptyMarket.ENCHANTED_GHAST_TEAR;
const ranks=rank({...options,tier:11,sort:'PAYBACK'}, {...ctx,market:emptyMarket});
const eligible=ranks.rows.filter(x=>x.supported&&x.paybackDays!=null);
const notEligible=ranks.rows.filter(x=>x.supported&&x.paybackDays==null);
add('PAYBACK sorting partial-market',{first:ranks.rows.slice(0,12).map(x=>({name:x.name,days:x.paybackDays,rank:x.sortRank,setupComplete:x.setupComplete})),eligibleCount:eligible.length,unpricedCount:notEligible.length,naRankBeforeValid:ranks.rows.findIndex(x=>x.supported&&x.paybackDays==null)<ranks.rows.findIndex(x=>x.supported&&x.paybackDays!=null)});
const tier12=Object.values(D.definitions).filter(m=>m.tiers?.['12']);
const tier12Coins=tier12.filter(m=>(m.tiers['12'].recipe||[]).some(item=>item.item==='COINS'));
add('Tier XII coin fees',{t12Minions:tier12.length,t12WithCoinRequirements:tier12Coins.length,missingCoinFees:tier12.filter(m=>!tier12Coins.includes(m)).map(m=>m.name)});
const rareMissing=[];
for(const m of Object.values(D.definitions)){if(m.special)continue;let missing=(Object.entries(m.tiers||{})).filter(([tier,v])=>!v.exactRecipe).map(([tier])=>tier);if(missing.length&&missing.join(',')!=='2,4,6,8,10')rareMissing.push({minion:m.name,missing})}
add('Recipe exception patterns',{exceptions:rareMissing,total:rareMissing.length});
console.log('MINION_DEEP_REPORT_BEGIN');console.log(JSON.stringify(report));console.log('MINION_DEEP_REPORT_END');
