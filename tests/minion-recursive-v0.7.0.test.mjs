import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';
import {resolveCumulativeTierRecipe} from '../candidate-src/src/minion-recipes.mjs';

function ask(p){
 return {buy_summary:[{pricePerUnit:p,amount:100000,orders:10}],
         sell_summary:[{pricePerUnit:p*.9,amount:100000,orders:10}],
         quick_status:{buyPrice:p,sellPrice:p*.9}};
}
const prices={
 ROTTEN_FLESH:10,REVENANT_FLESH:50,CRYSTALLIZED_HEART:300,
 STRING:5,TARANTULA_WEB:50,ENCHANTED_FERMENTED_SPIDER_EYE:300,
 NULL_SPHERE:40,ENDER_PEARL:5,OBSIDIAN:2
};
const market=Object.fromEntries(Object.entries(prices).map(([name,p])=>[name,ask(p)]));
const context={market,historyStats:new Map(),itemMeta:new Map(),
  taxRate:0.0125,priceMode:'LIVE',sellMethod:'BEST',historyDays:7};
const opts={tier:1,count:1,fuel:'NONE',shipping:'NONE',upgrade1:'NONE',upgrade2:'NONE',
  collectionIntervalDays:1,horizonDays:30};
function calculate(name,tier){
 const minion=MINION_DATA.definitions[name];
 assert.ok(minion,'Missing '+name);
 return calculateMinion(minion,{...opts,tier},context);
}
function verify(name,tier,cost){
 const result=calculate(name,tier);
 assert.equal(result.setupComplete,true,name+' T'+tier+' ingredients must be fully priced');
 assert.equal(result.setupCost,cost,name+' T'+tier+' cost must include sub-minion cumulative recipe');
 return result;
}
verify('Zombie Minion',1,80*10);
verify('Zombie Minion',2,(80+160)*10);
verify('Spider Minion',1,80*5);
verify('Enderman Minion',1,64*5);
const revenant=verify('Revenant Minion',2,(80+140)*50+300+80*10);
assert.ok(revenant.setupBreakdown.some(e=>e.item==='ZOMBIE_GENERATOR_1'&&e.source==='MINION_CRAFT'),
 'Slayer cost must show recursive minion ingredient provenance');
const tarantula=verify('Tarantula Minion',2,(80+140)*50+300+80*5);
assert.ok(tarantula.setupBreakdown.some(e=>e.item==='SPIDER_GENERATOR_1'&&e.unitPrice===400));
const voidling=verify('Voidling Minion',1,80*40+64*5);
assert.ok(voidling.setupBreakdown.some(e=>e.item==='ENDERMAN_GENERATOR_1'&&e.unitPrice===320));
// Missing fundamental ingredient must fail closed, never show partial setup cost.
const incompleteMarket={...market};
delete incompleteMarket.ENDER_PEARL;
const incomplete=calculateMinion(MINION_DATA.definitions['Voidling Minion'],opts,
  {...context,market:incompleteMarket});
assert.equal(incomplete.setupComplete,false);
assert.equal(incomplete.setupCost,null);
assert.equal(incomplete.paybackDays,null);
assert.ok(incomplete.setupMissing.includes('ENDER_PEARL'));
const hardStoneXII=resolveCumulativeTierRecipe(MINION_DATA.definitions['Hard Stone Minion'],12);
assert.ok(hardStoneXII.byTier.some(x=>x.tier===12&&x.item==='CONCENTRATED_STONE'&&x.amount===32),
 'Official Hypixel Concentrated Stone wiki specifies 32 for Hard Stone XII');
assert.ok(hardStoneXII.byTier.some(x=>x.tier===12&&x.item==='COINS'&&x.amount===2000000));
const unknown=resolveCumulativeTierRecipe(MINION_DATA.definitions['Revenant Minion'],19);
assert.equal(unknown.complete,false);
console.log(JSON.stringify({PASS:true,recursiveMinionCost:true,revenantTier2:revenant.setupCost,
  tarantulaTier2:tarantula.setupCost,voidlingTier1:voidling.setupCost,
  missingSubcomponentFailsClosed:true}));
