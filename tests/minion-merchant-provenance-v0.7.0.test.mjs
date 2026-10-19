import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {VERIFIED_MERCHANT_UPGRADES} from '../candidate-src/src/minion-merchant-recipes.mjs';
import {resolveCumulativeTierRecipe} from '../candidate-src/src/minion-recipes.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';

// Cross-checked individually against the 2026 community wiki tier XII vendor
// tables at https://hypixelskyblock.minecraft.wiki/w/<Minion_name>
// Item / requirement amounts are SOURCE facts; virtual-currency prices are not.
const cases={
 CACTUS_GENERATOR:['Tony',{ENCHANTED_CACTUS:32,PELTS:75}],
 CARROT_GENERATOR:['Tony',{ENCHANTED_GOLDEN_CARROT:32,PELTS:75}],
 CHICKEN_GENERATOR:['Tony',{ENCHANTED_RAW_CHICKEN:1024,PELTS:75}],
 COAL_GENERATOR:['Bulvar',{ENCHANTED_COAL_BLOCK:16,COINS:2000000}],
 COBBLESTONE_GENERATOR:['Bulvar',{ENCHANTED_COBBLESTONE:1024,COINS:2000000}],
 COCOA_GENERATOR:['Tony',{ENCHANTED_COOKIE:16,PELTS:75}],
 COW_GENERATOR:['Tony',{ENCHANTED_LEATHER:1024,PELTS:75}],
 DIAMOND_GENERATOR:['Bulvar',{ENCHANTED_DIAMOND_BLOCK:16,COINS:2000000}],
 EMERALD_GENERATOR:['Bulvar',{ENCHANTED_EMERALD_BLOCK:16,COINS:2000000}],
 GOLD_GENERATOR:['Bulvar',{ENCHANTED_GOLD_BLOCK:16,COINS:2000000}],
 HARD_STONE_GENERATOR:['Bulvar',{CONCENTRATED_STONE:16,COINS:2000000}],
 ICE_GENERATOR:['Einary',{ENCHANTED_ICE:1024,COINS:1000000,NORTH_STARS:300}],
 IRON_GENERATOR:['Bulvar',{ENCHANTED_IRON_BLOCK:16,COINS:2000000}],
 LAPIS_GENERATOR:['Bulvar',{ENCHANTED_LAPIS_LAZULI_BLOCK:64,COINS:2000000}],
 MELON_GENERATOR:['Tony',{ENCHANTED_MELON_BLOCK:32,PELTS:75}],
 MITHRIL_GENERATOR:['Bulvar',{REFINED_MITHRIL:16,COINS:2000000}],
 MUSHROOM_GENERATOR:['Tony',{ENCHANTED_BROWN_MUSHROOM:512,ENCHANTED_RED_MUSHROOM:512,PELTS:75}],
 NETHER_WARTS_GENERATOR:['Tony',{ENCHANTED_NETHER_STALK:1024,PELTS:75}],
 OBSIDIAN_GENERATOR:['Bulvar',{ENCHANTED_OBSIDIAN:1024,COINS:2000000}],
 PIG_GENERATOR:['Tony',{ENCHANTED_GRILLED_PORK:16,PELTS:75}],
 POTATO_GENERATOR:['Tony',{ENCHANTED_BAKED_POTATO:32,PELTS:75}],
 PUMPKIN_GENERATOR:['Tony',{ENCHANTED_PUMPKIN:1024,PELTS:75}],
 RABBIT_GENERATOR:['Tony',{ENCHANTED_COOKED_RABBIT:16,PELTS:75}],
 RED_SAND_GENERATOR:['Marthos',{ENCHANTED_RED_SAND_CUBE:32,COINS:2000000}],
 REDSTONE_GENERATOR:['Bulvar',{ENCHANTED_REDSTONE_BLOCK:32,COINS:2000000}],
 SHEEP_GENERATOR:['Tony',{ENCHANTED_COOKED_MUTTON:16,PELTS:75}],
 SUGAR_CANE_GENERATOR:['Tony',{ENCHANTED_SUGAR_CANE:32,PELTS:75}],
 SUNFLOWER_GENERATOR:['SkyMart',{COMPACTED_SUNFLOWER:32}],
 WHEAT_GENERATOR:['Tony',{ENCHANTED_WHEAT:1024,PELTS:75}]
};
assert.equal(Object.keys(cases).length,29);
assert.equal(Object.keys(VERIFIED_MERCHANT_UPGRADES).length,29,'All Tier XII trades must be source audited');
const reverse=new Map(Object.values(MINION_DATA.definitions).map(v=>[v.id,v]));
for(const [id,[vendor,parts]] of Object.entries(cases)){
 const trade=VERIFIED_MERCHANT_UPGRADES[id]?.[12];
 assert.ok(trade,'Missing merchant Tier XII: '+id);
 assert.equal(trade.vendor,vendor,'Wrong vendor: '+id);
 assert.match(trade.source,/^https:\/\/hypixelskyblock\.minecraft\.wiki\/w\/[A-Za-z_]+_Minion$/,\n   'Trade lacks cross-checked contemporary wiki source: '+id);
 assert.deepEqual(Object.fromEntries(trade.items.map(x=>[x.item,x.amount])),parts,
   'Tier XII ingredient, currency or number mismatch: '+id);
 const minion=reverse.get(id);
 assert.ok(minion,'Minion definition missing: '+id);
 const recipe=resolveCumulativeTierRecipe(minion,12);
 assert.equal(recipe.complete,true,'Cannot resolve every tier step: '+id);
 const t12=recipe.byTier.filter(x=>x.tier===12);
 assert.deepEqual(Object.fromEntries(t12.map(x=>[x.item,x.amount])),parts,
   'Tier XII missing from cumulative recipe: '+id);
 if(id==='RED_SAND_GENERATOR')assert.equal(trade.requirements[0].amount,12000);
 // Token-only costs are deliberately NOT converted into fake Bazaar coins.
 if(parts.PELTS||parts.NORTH_STARS){
   const r=calculateMinion(minion,{tier:12,count:1,fuel:'NONE',shipping:'NONE',
       upgrade1:'NONE',upgrade2:'NONE',collectionIntervalDays:1},
      {market:{},historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125});
   assert.equal(r.setupComplete,false,'Nontradable currency must make setup cost incomplete: '+id);
   assert.equal(r.setupCost,null,'Never invent Pelts/North Stars as coins: '+id);
 }
}
for(const name of ['Snow Minion','Flower Minion']){
 const m=MINION_DATA.definitions[name];
 assert.equal(m.starterAcquisition,'EXTERNAL_UNPRICED');
 for(let tier=1;tier<=12;tier++){
  const x=resolveCumulativeTierRecipe(m,tier);
  assert.equal(x.complete,false,'Cannot give an exact auction/gift starter cost: '+name+'/T'+tier);
  assert.equal(x.source,'EXTERNAL_STARTER_COST_UNKNOWN');
 }
}
console.log(JSON.stringify({PASS:true,sourceAuditedTierXII:29,
  externalGiftOrAuctionTiers:24,noInventedNonBazaarCurrency:true}));
