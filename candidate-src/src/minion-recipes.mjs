// Versioned, data-driven per-tier upgrade recipe resolver.
// Exact step recipes win; legacy cumulative figures remain a fallback only where explicitly marked exact.
const key = value => String(value || '').trim().toUpperCase();
const validIngredient = row => row && typeof row.item === 'string' && row.item.trim() &&
  Number.isFinite(Number(row.amount)) && Number(row.amount) > 0;
export function resolveCumulativeTierRecipe(minion, tier) {
  const selected = Number(tier);
  if (!Number.isInteger(selected) || selected < 1 || !minion?.tiers?.[selected])
    return {complete:false, source:'INVALID_TIER', recipe:[],missing:['Tier unavailable']};
  const steps = minion.upgradeRecipes;
  if (steps && typeof steps === 'object') {
    const details=[], merged=new Map(), missing=[];
    for (let level=1;level<=selected;level++) {
      const part=steps[level];
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
      source:'EXPLICIT_STEPS',
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
