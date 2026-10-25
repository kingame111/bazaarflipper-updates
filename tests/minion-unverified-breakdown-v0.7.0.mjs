import {fetchBazaar,fetchItemMetadata} from '../candidate-src/src/hypixel.mjs';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';
import {resolveCumulativeTierRecipe} from '../candidate-src/src/minion-recipes.mjs';
const [marketData,metaData]=await Promise.all([fetchBazaar(25000),fetchItemMetadata(25000)]);
const market=marketData.products;
const ctx={market,historyStats:new Map(),itemMeta:metaData.map,taxRate:0.0125,
  priceMode:'LIVE',sellMethod:'BEST',historyDays:7};
const byItem=new Map(),byFamily=new Map(),byReason=new Map(),records=[];
for(const m of Object.values(MINION_DATA.definitions)){
 if(m.special)continue;
 for(const tier of Object.keys(m.tiers).map(Number)){
  const recipe=resolveCumulativeTierRecipe(m,tier);
  const result=calculateMinion(m,{tier,count:1,fuel:'NONE',shipping:'NONE',
   upgrade1:'NONE',upgrade2:'NONE',collectionIntervalDays:1},ctx);
  if(result.setupComplete)continue;
  const missing=result.setupMissing||[];
  const reason=!recipe.complete?'RECIPE_OR_STARTER':missing.includes('PELTS')||
     missing.includes('NORTH_STARS')?'NON_BAZAAR_CURRENCY':'INGREDIENT_UNPRICED';
  const entry={name:m.name,tier,reason,missing,recipeComplete:recipe.complete,source:recipe.source};
  records.push(entry);
  byFamily.set(m.name,(byFamily.get(m.name)||0)+1);
  byReason.set(reason,(byReason.get(reason)||0)+1);
  for(const key of missing){const v=byItem.get(key)||{count:0,families:new Set()};v.count++;v.families.add(m.name);byItem.set(key,v)}
 }
}
console.log(JSON.stringify({at:new Date().toISOString(),reviewed:records.length,
  categories:Object.fromEntries([...byReason].sort()),
  byMissingItem:[...byItem].map(([id,v])=>({id,count:v.count,families:[...v.families]}))
   .sort((a,b)=>b.count-a.count),
  byFamily:[...byFamily].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),
  examples:records.filter(x=>x.reason!=='NON_BAZAAR_CURRENCY').slice(0,65)
},null,2));
