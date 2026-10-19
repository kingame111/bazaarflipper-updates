import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {VERIFIED_MERCHANT_UPGRADES} from '../candidate-src/src/minion-merchant-recipes.mjs';
import {resolveCumulativeTierRecipe} from '../candidate-src/src/minion-recipes.mjs';

// Verify that every exact historical cumulative recipe agrees with the
// cost of buying the new material AT EACH tier, not the raw item at all tiers.
let verifiedCumulatives=0,unsupportedFamilies=0,totalTiers=0,merchantTiers=0,externalStarters=0;
for(const minion of Object.values(MINION_DATA.definitions)){
 if(minion.special){unsupportedFamilies++;continue}
 const running=new Map();
 const levels=Object.keys(minion.tiers||{}).map(Number).sort((a,b)=>a-b);
 for(const tier of levels){
  totalTiers++;
  const raw=minion.tiers[tier];
  const next=minion.upgradeRecipes?.[tier];
  const merchant=VERIFIED_MERCHANT_UPGRADES[minion.id]?.[tier];
  const external=minion.starterAcquisition==='EXTERNAL_UNPRICED';
  if(external){
   externalStarters++;
   const result=resolveCumulativeTierRecipe(minion,tier);
   assert.equal(result.complete,false,'Unpriced external starter cannot have exact cost: '+minion.name);
   continue;
  }
  if(merchant)merchantTiers++;
  if(!next&&!merchant&&!raw?.exactRecipe){
   assert.fail('Tier step has no verified path: '+minion.name+'/T'+tier);
  }
  if(Array.isArray(next)){
   for(const item of next){
    assert.ok(typeof item.item==='string'&&item.item.length>0);
    assert.ok(Number.isFinite(item.amount)&&item.amount>0);
    running.set(item.item,(running.get(item.item)||0)+item.amount);
   }
  }
  if(raw?.exactRecipe&&Array.isArray(raw.recipe)&&next){
   verifiedCumulatives++;
   const expected=new Map(raw.recipe.map(x=>[x.item,x.amount]));
   assert.deepEqual([...running].sort(([a],[b])=>a.localeCompare(b)),
      [...expected].sort(([a],[b])=>a.localeCompare(b)),
      'Cumulative recipe disagrees with per-tier step materials: '+minion.name+'/T'+tier);
  }
  const resolved=resolveCumulativeTierRecipe(minion,tier);
  assert.equal(resolved.complete,true,'Verified tier recipe not resolvable: '+minion.name+'/T'+tier);
 }
}
assert.ok(verifiedCumulatives>=649,'Fewer cumulative recipe checks than previously audited');
assert.equal(merchantTiers,29,'Tier XII merchant override count changed without verification');
assert.equal(externalStarters,24,'External starter levels changed without a provenance audit');
assert.equal(unsupportedFamilies,1,'Unsupported family count changed; verify new variants');
console.log(JSON.stringify({PASS:true,verifiedCumulatives,
  totalTiers,merchantTiers,externalStarters,unsupportedFamilies}));
