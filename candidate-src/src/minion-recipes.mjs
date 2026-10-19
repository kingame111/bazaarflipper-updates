import {VERIFIED_MERCHANT_UPGRADES} from './minion-merchant-recipes.mjs';
// Versioned, data-driven per-tier upgrade recipe resolver.
// Exact step recipes win; legacy cumulative figures remain a fallback only where explicitly marked exact.
const key = value => String(value || '').trim().toUpperCase();
const validIngredient = row => row && typeof row.item === 'string' && row.item.trim() &&
  Number.isFinite(Number(row.amount)) && Number(row.amount) > 0;
export function resolveCumulativeTierRecipe(minion, tier) {
  const selected = Number(tier);
  if (!Number.isInteger(selected) || selected < 1 || !minion?.tiers?.[selected])
    return {complete:false, source:'INVALID_TIER', recipe:[],missing:['Tier unavailable']};
  // Some Tier I minions (Snow/Flower) are acquired from gifts or auctions
  // rather than the Bazaar. Their legacy cumulative upgrade recipes exclude
  // the starting minion's acquisition cost and must not yield a fake payback.
  if(minion.starterAcquisition==='EXTERNAL_UNPRICED')return {
    complete:false,source:'EXTERNAL_STARTER_COST_UNKNOWN',recipe:[],byTier:[],
    missing:[minion.starterPriceWarning||'Tier I acquisition cost is unverified']
  };
  const steps = minion.upgradeRecipes;
  if (steps && typeof steps === 'object') {
    const details=[], merged=new Map(), missing=[];
    for (let level=1;level<=selected;level++) {
      // NPC trades do not appear in crafting-only NotEnoughUpdates tier files.
      // Attach a merchant trade only when its exact requirements have an audit source.
      const external=VERIFIED_MERCHANT_UPGRADES[minion.id]?.[level];
      const part=steps[level]||external?.items;
      if (!Array.isArray(part) || !part.length || part.some(row=>!validIngredient(row))) {
        missing.push('Unverified tier '+level+' recipe');
        continue;
      }
      for (const entry of part) {
        const item=key(entry.item), amount=Number(entry.amount);
        details.push({tier:level,item,amount});
        merged.set(item,(merged.get(item)||0)+amount);
      }
    }
    return {
      complete:missing.length===0,
      source:VERIFIED_MERCHANT_UPGRADES[minion.id]?.[selected]?'VERIFIED_MERCHANT_PLUS_STEPS':(minion.recipeSource||'EXPLICIT_STEPS'),
      recipe:[...merged].map(([item,amount])=>({item,amount})),
      byTier:details,
      missing
    };
  }
  const legacy=minion.tiers[selected];
  if (legacy.exactRecipe && Array.isArray(legacy.recipe) && legacy.recipe.length &&
      legacy.recipe.every(validIngredient)) {
    return {complete:true,source:'LEGACY_CUMULATIVE',
      recipe:legacy.recipe.map(x=>({item:key(x.item),amount:Number(x.amount)})),
      byTier:[],missing:[]};
  }
  return {complete:false,source:'UNVERIFIED',recipe:[],byTier:[],
    missing:['Exact tier '+selected+' recipe unavailable']};
}
