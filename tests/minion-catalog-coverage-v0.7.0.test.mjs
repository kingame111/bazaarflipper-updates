import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {resolveCumulativeTierRecipe} from '../candidate-src/src/minion-recipes.mjs';
import {VERIFIED_MERCHANT_UPGRADES as trades} from '../candidate-src/src/minion-merchant-recipes.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';

const expected={
  COBBLESTONE_GENERATOR:[['ENCHANTED_COBBLESTONE',1024],['COINS',2000000]],
  COAL_GENERATOR:[['ENCHANTED_COAL_BLOCK',16],['COINS',2000000]],
  DIAMOND_GENERATOR:[['ENCHANTED_DIAMOND_BLOCK',16],['COINS',2000000]],
  OBSIDIAN_GENERATOR:[['ENCHANTED_OBSIDIAN',1024],['COINS',2000000]],
  HARD_STONE_GENERATOR:[['CONCENTRATED_STONE',16],['COINS',2000000]],
  IRON_GENERATOR:[['ENCHANTED_IRON_BLOCK',16],['COINS',2000000]],
  GOLD_GENERATOR:[['ENCHANTED_GOLD_BLOCK',16],['COINS',2000000]],
  EMERALD_GENERATOR:[['ENCHANTED_EMERALD_BLOCK',16],['COINS',2000000]],
  LAPIS_GENERATOR:[['ENCHANTED_LAPIS_LAZULI_BLOCK',64],['COINS',2000000]],
  MITHRIL_GENERATOR:[['REFINED_MITHRIL',16],['COINS',2000000]],
  REDSTONE_GENERATOR:[['ENCHANTED_REDSTONE_BLOCK',32],['COINS',2000000]],
  RED_SAND_GENERATOR:[['ENCHANTED_RED_SAND_CUBE',32],['COINS',2000000]],
  ICE_GENERATOR:[['ENCHANTED_ICE',1024],['COINS',1000000],['NORTH_STARS',300]],
  CARROT_GENERATOR:[['ENCHANTED_GOLDEN_CARROT',32],['PELTS',75]],
  CACTUS_GENERATOR:[['ENCHANTED_CACTUS',32],['PELTS',75]],
  CHICKEN_GENERATOR:[['ENCHANTED_RAW_CHICKEN',1024],['PELTS',75]],
  COW_GENERATOR:[['ENCHANTED_LEATHER',1024],['PELTS',75]],
  COCOA_GENERATOR:[['ENCHANTED_COOKIE',16],['PELTS',75]],
  MELON_GENERATOR:[['ENCHANTED_MELON_BLOCK',32],['PELTS',75]],
  MUSHROOM_GENERATOR:[['ENCHANTED_BROWN_MUSHROOM',512],
    ['ENCHANTED_RED_MUSHROOM',512],['PELTS',75]],
  NETHER_WARTS_GENERATOR:[['ENCHANTED_NETHER_STALK',1024],['PELTS',75]],
  PIG_GENERATOR:[['ENCHANTED_GRILLED_PORK',16],['PELTS',75]],
  POTATO_GENERATOR:[['ENCHANTED_BAKED_POTATO',32],['PELTS',75]],
  PUMPKIN_GENERATOR:[['ENCHANTED_PUMPKIN',1024],['PELTS',75]],
  RABBIT_GENERATOR:[['ENCHANTED_COOKED_RABBIT',16],['PELTS',75]],
  SHEEP_GENERATOR:[['ENCHANTED_COOKED_MUTTON',16],['PELTS',75]],
  SUGAR_CANE_GENERATOR:[['ENCHANTED_SUGAR_CANE',32],['PELTS',75]],
  WHEAT_GENERATOR:[['ENCHANTED_WHEAT',1024],['PELTS',75]],
  SUNFLOWER_GENERATOR:[['COMPACTED_SUNFLOWER',32]]
};
assert.deepEqual(Object.keys(trades).sort(),Object.keys(expected).sort(),
  'No undocumented or forgotten tier XII trade');
const byId=new Map(Object.values(MINION_DATA.definitions).map(d=>[d.id,d]));
let allTiers=0;
for(const [id,parts] of Object.entries(expected)){
  const source=trades[id]?.[12];
  assert.ok(source?.source?.startsWith('https://'),id+' missing source');
  assert.ok(source?.vendor,id+' missing vendor');
  assert.deepEqual(source.items.map(i=>[i.item,i.amount]),parts,id+' missing/changed trade requirement');
  const def=byId.get(id);
  assert.ok(def?.tiers?.[12],id+' lacks tier XII');
  const prev=resolveCumulativeTierRecipe(def,11);
  const up=resolveCumulativeTierRecipe(def,12);
  assert.equal(prev.complete,true,id+' XI incomplete');
  assert.equal(up.complete,true,id+' XII incomplete');
  assert.deepEqual(up.byTier.filter(x=>x.tier<12),prev.byTier,id+' mutated earlier recipe');
  assert.deepEqual(up.byTier.filter(x=>x.tier===12).map(x=>[x.item,x.amount]),parts);
}
for(const minion of Object.values(MINION_DATA.definitions)){
  if(minion.special||minion.starterAcquisition==='EXTERNAL_UNPRICED')continue;
  for(const level of Object.keys(minion.tiers)){
    assert.equal(resolveCumulativeTierRecipe(minion,Number(level)).complete,true,
      minion.name+' '+level+' missing recipe');
    allTiers++;
  }
}
for(const minion of Object.values(MINION_DATA.definitions).filter(x=>x.starterAcquisition==='EXTERNAL_UNPRICED')){
 assert.equal(resolveCumulativeTierRecipe(minion,1).complete,false,
  'Do not invent auction/gift starting cost for '+minion.name);
}
const red=trades.RED_SAND_GENERATOR[12];
assert.deepEqual(red.requirements,[{kind:'BARBARIAN_REPUTATION',amount:12000}]);
for(const [id,parts] of Object.entries(expected)){
 if(!parts.some(([item])=>['PELTS','NORTH_STARS'].includes(item)))continue;
 const def=byId.get(id);
 const recipe=resolveCumulativeTierRecipe(def,12);
 const market=Object.fromEntries(recipe.recipe.filter(x=>!['PELTS','NORTH_STARS','COINS'].includes(x.item))
  .map(x=>[x.item,{buy_summary:[{pricePerUnit:19,amount:100000000}],
   sell_summary:[{pricePerUnit:18,amount:100000000}]}]));
 const model=calculateMinion(def,{tier:12,count:1,fuel:'NONE',shipping:'NONE',
   upgrade1:'NONE',upgrade2:'NONE',collectionIntervalDays:1},{
   market,historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125,priceMode:'LIVE',
   sellMethod:'BEST',historyDays:7});
 assert.equal(model.setupComplete,false,'No fabricated currency price for '+id);
 assert.equal(model.setupCost,null,'Must not fabricate total setup cost for '+id);
 assert.ok(model.setupMissing.some(k=>['PELTS','NORTH_STARS'].includes(k)),id+' currency warning missing');
}
console.log(JSON.stringify({PASS:true,verifiedNPCTrades:Object.keys(expected).length,
 completeKnownCraftTierRecipes:allTiers,unpricedSpecialCurrenciesFailClosed:true,
 externalStarterMinionsNeverAssignedFictionalCost:true}));
