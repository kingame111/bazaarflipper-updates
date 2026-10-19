import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';
import {VERIFIED_NON_BAZAAR_INGREDIENTS as recipes} from '../candidate-src/src/minion-ingredient-recipes.mjs';

assert.deepEqual(recipes.FISHING_ROD.recipe,[{item:'LOG',amount:1},{item:'STRING',amount:2}]);
assert.deepEqual(recipes.ZOMBIE_HEART.recipe,[{item:'ENCHANTED_ROTTEN_FLESH',amount:256}]);
assert.deepEqual(recipes.CRYSTALLIZED_HEART.recipe,[{item:'ENCHANTED_DIAMOND',amount:256},
 {item:'ZOMBIE_HEART',amount:1}]);
assert.deepEqual(recipes.BAT_PERSON_HELMET.recipe,[{item:'SPOOKY_SHARD',amount:5},
 {item:'PURPLE_CANDY',amount:64}]);
const p=12;
const quoted=id=>[id,{buy_summary:[{pricePerUnit:p,amount:1000000}],
 sell_summary:[{pricePerUnit:p-1,amount:1000000}]}];
const market=Object.fromEntries([
 'REVENANT_FLESH','HEMOVIBE','ENCHANTED_ROTTEN_FLESH',
 'ENCHANTED_DIAMOND','SPOOKY_SHARD','PURPLE_CANDY'
].map(quoted));
const opts={tier:1,count:1,fuel:'NONE',shipping:'NONE',
 upgrade1:'NONE',upgrade2:'NONE',collectionIntervalDays:1};
const ctx={market,historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125,
 priceMode:'LIVE',sellMethod:'BEST',historyDays:7};
const calculate=(name,m=market)=>calculateMinion(MINION_DATA.definitions[name],opts,{...ctx,market:m});
const rev=calculate('Revenant Minion');
assert.equal(rev.setupComplete,true);
assert.equal(rev.setupCost,(80+256+256)*p);
assert.ok(rev.setupBreakdown.some(x=>x.item==='CRYSTALLIZED_HEART'&&x.total===512*p));
const vamp=calculate('Vampire Minion');
assert.equal(vamp.setupComplete,true);
assert.equal(vamp.setupCost,(80+5+64)*p);
assert.ok(vamp.setupBreakdown.some(x=>x.item==='BAT_PERSON_HELMET'&&x.total===69*p));
const missing=Object.fromEntries(Object.entries(market).filter(([id])=>id!=='SPOOKY_SHARD'));
const bad=calculate('Vampire Minion',missing);
assert.equal(bad.setupComplete,false);
assert.equal(bad.setupCost,null);
assert.ok(bad.setupMissing.includes('SPOOKY_SHARD'));
assert.equal(bad.paybackDays,null);
const fishingMarket={...market,RAW_FISH:{buy_summary:[{pricePerUnit:12,amount:1e6}],
 sell_summary:[{pricePerUnit:11,amount:1e6}]},
 WATER_LILY:{buy_summary:[{pricePerUnit:12,amount:1e6}],
 sell_summary:[{pricePerUnit:11,amount:1e6}]},
 LOG:{buy_summary:[{pricePerUnit:40,amount:1e6}],sell_summary:[{pricePerUnit:39,amount:1e6}]},
 STRING:{buy_summary:[{pricePerUnit:7,amount:1e6}],sell_summary:[{pricePerUnit:6,amount:1e6}]}};
for(const name of ['Fishing Minion','Lily Pad Minion']){
 const model=calculate(name,fishingMarket);
 assert.equal(model.setupComplete,true,'Verified fishing rod craft must be priced: '+name);
 assert.equal(model.setupCost,64*12+40+2*7,'Full material cost: '+name);
 const rod=model.setupBreakdown.find(x=>x.item==='FISHING_ROD');
 assert.equal(rod.unitPrice,54,'Rod cost must use 1 full oak log and 2 strings');
}
const noLog={...fishingMarket};delete noLog.LOG;
const missingRod=calculate('Fishing Minion',noLog);
assert.equal(missingRod.setupComplete,false);
assert.equal(missingRod.setupCost,null);
assert.ok(missingRod.setupMissing.includes('LOG'));
console.log(JSON.stringify({PASS:true,craftCost:rev.setupCost,batHelmetCost:69*p,
 nonBazaarNestedCraftingVerified:true,missingIngredientFailsClosed:true}));
