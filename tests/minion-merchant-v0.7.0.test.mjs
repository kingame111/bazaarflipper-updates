import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';
import {resolveCumulativeTierRecipe} from '../candidate-src/src/minion-recipes.mjs';
import {VERIFIED_MERCHANT_UPGRADES} from '../candidate-src/src/minion-merchant-recipes.mjs';

const verified={
 COBBLESTONE_GENERATOR:['ENCHANTED_COBBLESTONE',1024],
 COAL_GENERATOR:['ENCHANTED_COAL_BLOCK',16],
 DIAMOND_GENERATOR:['ENCHANTED_DIAMOND_BLOCK',16],
 OBSIDIAN_GENERATOR:['ENCHANTED_OBSIDIAN',1024],
 HARD_STONE_GENERATOR:['CONCENTRATED_STONE',16]
};
const price=17;
for(const minion of Object.values(MINION_DATA.definitions)){
 if(!Object.hasOwn(verified,minion.id))continue;
 const tier11=resolveCumulativeTierRecipe(minion,11);
 const t12=resolveCumulativeTierRecipe(minion,12);
 assert.ok(tier11.complete,minion.name+' must have verified tier XI');
 assert.ok(t12.complete,minion.name+' tier XII NPC trade must resolve');
 assert.equal(t12.source,'VERIFIED_MERCHANT_PLUS_STEPS');
 const last=t12.byTier.filter(x=>x.tier===12);
 const [item,amount]=verified[minion.id];
 assert.deepEqual(last.map(x=>({item:x.item,amount:x.amount})),[
   {item,amount},{item:'COINS',amount:2000000}
 ]);
 const previous=t12.byTier.filter(x=>x.tier<12);
 assert.deepEqual(previous,tier11.byTier,minion.name+' previous 11 levels preserved');
 const market=Object.fromEntries(t12.recipe.filter(x=>x.item!=='COINS').map(x=>[
   x.item,{buy_summary:[{pricePerUnit:price,amount:99999999}],
     sell_summary:[{pricePerUnit:price/2,amount:99999999}],
     quick_status:{buyPrice:price,sellPrice:price/2}}
 ]));
 const result=calculateMinion(minion,{tier:12,count:1,fuel:'NONE',
   shipping:'NONE',upgrade1:'NONE',upgrade2:'NONE',collectionIntervalDays:1},
   {market,historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125,
     priceMode:'LIVE',sellMethod:'BEST',historyDays:7});
 assert.equal(result.setupComplete,true,minion.name+' no hidden missing price');
 assert.equal(result.setupCost,2000000+t12.recipe.filter(x=>x.item!=='COINS').
   reduce((sum,x)=>sum+x.amount*price,0),minion.name+' cost must include 2M fee');
 assert.equal(result.setupBreakdown.filter(x=>x.item==='COINS').length,1);
 assert.equal(result.setupBreakdown.find(x=>x.item==='COINS').total,2000000);
 assert.ok(VERIFIED_MERCHANT_UPGRADES[minion.id]?.[12]?.source.startsWith('https://'));
}
const carrot=MINION_DATA.definitions['Carrot Minion'];
const carrotRecipe=resolveCumulativeTierRecipe(carrot,12);
assert.equal(carrotRecipe.complete,true,'NPC requirement from Tony is verified');
assert.deepEqual(carrotRecipe.byTier.filter(x=>x.tier===12).map(x=>({item:x.item,amount:x.amount})),[
  {item:'ENCHANTED_GOLDEN_CARROT',amount:32},{item:'PELTS',amount:75}
]);
const carrotMarket=Object.fromEntries(carrotRecipe.recipe.filter(x=>x.item!=='PELTS').map(x=>[
 x.item,{buy_summary:[{pricePerUnit:price,amount:999999}],
   sell_summary:[{pricePerUnit:price/2,amount:999999}]}]));
const carrotPrice=calculateMinion(carrot,{tier:12,count:1,fuel:'NONE',shipping:'NONE',
  upgrade1:'NONE',upgrade2:'NONE',collectionIntervalDays:1},
 {market:carrotMarket,historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125,
   priceMode:'LIVE',sellMethod:'BEST',historyDays:7});
assert.equal(carrotPrice.setupComplete,false,'75 Pelts are non-coin currency and must remain unpriced');
assert.equal(carrotPrice.paybackDays,null,'Cannot calculate exact payback with unpriced Pelts');
assert.ok(carrotPrice.setupMissing.includes('PELTS'));
const notVerified=MINION_DATA.definitions['Cactus Minion'];
assert.equal(resolveCumulativeTierRecipe(notVerified,12).complete,false,
  'Do not invent generic tier 12 recipes or currencies');
const notCraftable=resolveCumulativeTierRecipe(MINION_DATA.definitions['Flower Minion'],1);
assert.equal(notCraftable.complete,false,'External starter value must not be fabricated');
console.log(JSON.stringify({PASS:true,verifiedMerchantTrades:Object.keys(verified).length+1,
  merchantFeesIncluded:true,previousTiersPreserved:true,noGenericAssumptions:true}));
