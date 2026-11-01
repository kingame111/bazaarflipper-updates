import fs from 'node:fs';
import assert from 'node:assert/strict';
import { MINION_DATA } from '../candidate-src/src/minion-data.mjs';
import { simulateUpgradeOffline } from '../candidate-src/src/offline-upgrade-inventory.mjs';

// Sensitivity test, not an assertion about undocumented game processing priority.
const combos=[
 ['Snow Minion','DIAMOND_SPREADING','SUPER_COMPACTOR_3000'],
 ['Slime Minion','CORRUPT_SOIL','SUPER_COMPACTOR_3000'],
 ['Zombie Minion','DIAMOND_SPREADING','SUPER_COMPACTOR_3000'],
 ['Sheep Minion','CORRUPT_SOIL','DIAMOND_SPREADING'],
 ['Ghast Minion','SOULFLOW_ENGINE','SUPER_COMPACTOR_3000'],
 ['Ghast Minion','LESSER_SOULFLOW_ENGINE','SUPER_COMPACTOR_3000'],
 ['Carrot Minion','BERBERIS_FUEL_INJECTOR','SUPER_COMPACTOR_3000'],
 ['Chicken Minion','ENCHANTED_EGG','SUPER_COMPACTOR_3000'],
 ['Gravel Minion','FLINT_SHOVEL','SUPER_COMPACTOR_3000'],
 ['Fishing Minion','DIAMOND_SPREADING','SUPER_COMPACTOR_3000'],
 ['Flower Minion','DIAMOND_SPREADING','SUPER_COMPACTOR_3000'],
 ['Voidling Minion','SOULFLOW_ENGINE','SUPER_COMPACTOR_3000']
];
const cash=(result,days,shipping)=>result.outputs.reduce((sum,row)=>
 sum+days*row.npc*(row.unitsPerDay+(shipping==='ENCHANTED_HOPPER'?0.7*row.overflowUnitsPerDay:0)),0);
const cases=[];
for(const [name,a,b] of combos){
 const minion=MINION_DATA.definitions[name];
 const upgrades=[a,b].map(id=>({id,...MINION_DATA.upgrades[id]}));
 const bonus=upgrades.reduce((n,u)=>n+(u.speed||0),0);
 for(const days of [1,3,7])for(const largeStorage of [false,true])
 for(const shipping of ['NONE','ENCHANTED_HOPPER']){
  const opts={days,largeStorage,upgrades,fuel:MINION_DATA.fuels.NONE,
    secondsPerAction:minion.tiers[11].speed/(1+bonus)};
  const native=simulateUpgradeOffline(minion,11,{...opts,dropOrder:'MINION_FIRST'});
  const external=simulateUpgradeOffline(minion,11,{...opts,dropOrder:'EXTERNAL_FIRST'});
  assert.ok(native&&external);
  const nativeCoins=cash(native,days,shipping),externalCoins=cash(external,days,shipping);
  const difference=nativeCoins-externalCoins;
  const relative=externalCoins?difference/externalCoins:null;
  cases.push({name,upgrades:[a,b],days,largeStorage,shipping,nativeCoins,externalCoins,
   difference,relative,slots:minion.tiers[11].storage/64+(largeStorage?15:0)});
 }
}
// If nothing is close to filling storage, drop priority must have no influence.
const minion=MINION_DATA.definitions['Snow Minion'];
const ups=['DIAMOND_SPREADING','SUPER_COMPACTOR_3000'].map(id=>({id,...MINION_DATA.upgrades[id]}));
const tiny={days:0.001,largeStorage:true,upgrades:ups,fuel:MINION_DATA.fuels.NONE,secondsPerAction:minion.tiers[11].speed};
const a=simulateUpgradeOffline(minion,11,{...tiny,dropOrder:'MINION_FIRST'});
const b=simulateUpgradeOffline(minion,11,{...tiny,dropOrder:'EXTERNAL_FIRST'});
assert.ok(Math.abs(cash(a,tiny.days,'NONE')-cash(b,tiny.days,'NONE'))<1e-8,'Order must not change unconstrained revenue');

// Explicit regression for user-confirmed linked chest compaction.
const synthetic={id:'TEST_CHEST_COMPACTION',name:'Chest compaction fixture',
 tiers:{11:{speed:1,storage:64}},
 drops:[{item:'TEST_RAW',amount:64,chance:1,npc:1,enchanted:{TEST_ENCHANTED:160}}]};
const fixtureUps=[{id:'FIXTURE_UPGRADE',outputMultiplier:1},{id:'SUPER_COMPACTOR_3000',...MINION_DATA.upgrades.SUPER_COMPACTOR_3000}];
const fixture={fuel:MINION_DATA.fuels.NONE,upgrades:fixtureUps,
 days:400/86400,secondsPerAction:1,dropOrder:'MINION_FIRST'};
const withChest=simulateUpgradeOffline(synthetic,11,{...fixture,largeStorage:true});
const withoutChest=simulateUpgradeOffline(synthetic,11,{...fixture,largeStorage:false});
assert.ok(withChest.outputs.some(x=>x.item==='TEST_ENCHANTED'&&x.unitsPerDay>0),
  'SC3000 must compact resource stacks in linked storage');
assert.ok(!withoutChest.outputs.some(x=>x.item==='TEST_ENCHANTED'&&x.unitsPerDay>0),
  'No linked chest means fixture should not reach compaction threshold');
const sorted=cases.slice().sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference));
const biggestPercentage=cases.filter(x=>x.relative!=null).sort((a,b)=>Math.abs(b.relative)-Math.abs(a.relative));
const report={scope:'NPC coins, tier XI, 12 representative mixes, 1/3/7 days, alternate entry priority',
 assumptions:{chestCompaction:'User-confirmed, implemented',nativeFirst:'Tentative, not empirically confirmed'},
 summary:{cases:cases.length,nonZero:cases.filter(x=>Math.abs(x.difference)>0.0001).length,
 maxAbsoluteCoins:sorted[0],maxAbsoluteRelative:biggestPercentage[0],
 maxDiffCases:sorted.slice(0,25),maxRelativeCases:biggestPercentage.slice(0,25)},
 cases};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-drop-order-sensitivity.json',JSON.stringify(report,null,2)+'\n');
console.log('DROP_ORDER_SENSITIVITY_SUMMARY',JSON.stringify(report.summary,null,2));
