import { MINION_DATA } from './minion-data.mjs';

const DAY_SECONDS = 86400;
const safe = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, safe(value)));
const upper = (value) => String(value || '').trim().toUpperCase();

function firstBookPrice(product, side) {
  const levels = side === 'BUY'
    ? (Array.isArray(product?.buy_summary) ? product.buy_summary : [])
    : (Array.isArray(product?.sell_summary) ? product.sell_summary : []);
  const price = safe(levels[0]?.pricePerUnit);
  if (price > 0) return price;
  const q = product?.quick_status || {};
  return side === 'BUY' ? safe(q.buyPrice) : safe(q.sellPrice);
}

function currentPrice(productId, market) {
  const product = market?.[productId];
  return {
    instantSell: firstBookPrice(product, 'BUY'),
    sellOrder: firstBookPrice(product, 'SELL'),
    acquisition: firstBookPrice(product, 'SELL')
  };
}

function historyPrice(productId, historyStats, days=7) {
  const h = historyStats?.get?.(productId);
  const d=Math.max(1,Math.min(7,Math.round(safe(days,7))));
  return {
    instantSell: safe(h?.[`avgBuy${d}d`]),
    sellOrder: safe(h?.[`avgSell${d}d`]),
    coverage: clamp(h?.[`coverage${d}d`], 0, 1),
    cv: Math.max(0, safe(h?.[`cvMid${d}d`])),
    samples: Math.max(0, safe(h?.[`samples${d}d`]))
  };
}

function getNpcPrice(itemId, fallbackNpc, itemMeta) {
  const meta = itemMeta?.get?.(itemId);
  const candidates = [
    meta?.npcSellPrice, meta?.npc_sell_price, meta?.npcPrice, meta?.npc_price,
    meta?.sellPrice, meta?.sell_price, fallbackNpc
  ];
  for (const value of candidates) {
    const price = safe(value);
    if (price > 0) return price;
  }
  return Math.max(0, safe(fallbackNpc));
}

function saleQuote(itemId, fallbackNpc, ctx) {
  const live = currentPrice(itemId, ctx.market);
  const hist = historyPrice(itemId, ctx.historyStats, ctx.historyDays);
  const mode = upper(ctx.priceMode) === '7D' ? '7D' : 'LIVE';
  const taxFactor = 1 - clamp(ctx.taxRate, 0, 0.25);
  const npc = getNpcPrice(itemId, fallbackNpc, ctx.itemMeta);

  let instant = live.instantSell;
  let order = live.sellOrder;
  let usedHistorical = false;
  let historicalFallback = false;
  if (mode === '7D') {
    if (hist.instantSell > 0) {
      instant = hist.instantSell;
      usedHistorical = true;
    } else historicalFallback = true;
    if (hist.sellOrder > 0) {
      order = hist.sellOrder;
      usedHistorical = true;
    } else historicalFallback = true;
  }

  const methods = {
    INSTANT: instant > 0 ? instant * taxFactor : 0,
    ORDER: order > 0 ? order * taxFactor : 0,
    NPC: npc
  };
  const requested = upper(ctx.sellMethod || 'BEST');
  let method = requested;
  if (requested === 'BEST') {
    method = Object.entries(methods).sort((a,b) => b[1]-a[1])[0]?.[0] || 'NPC';
  }
  const price = Math.max(0, safe(methods[method]));
  return {
    price,
    method,
    raw: method === 'INSTANT' ? instant : method === 'ORDER' ? order : npc,
    taxApplied: method === 'INSTANT' || method === 'ORDER',
    historicalCoverage: hist.coverage,
    historicalCv: hist.cv,
    historicalSamples: hist.samples,
    historicalFallback,
    usedHistorical,
    liveInstant: live.instantSell,
    liveOrder: live.sellOrder,
    npc
  };
}

function acquisitionQuote(itemId, market) {
  if (!itemId) return { price: 0, available: true };
  const price = currentPrice(itemId, market).acquisition;
  return { price, available: price > 0 };
}

function compactDropStream(drop, rawUnitsPerDay, useCompactor, collectionIntervalDays = 1) {
  const perDay = Math.max(0, safe(rawUnitsPerDay));
  const interval = Math.max(1 / 24, Math.min(30, safe(collectionIntervalDays, 1)));
  if (!useCompactor || !drop?.enchanted || typeof drop.enchanted !== 'object') {
    return [{ item:drop.item, unitsPerDay:perDay, npc:Math.max(0,safe(drop.npc)), compacted:false, ratio:1, compactionLevel:0 }];
  }
  const first = Object.entries(drop.enchanted).find(([,ratio]) => safe(ratio) > 0);
  if (!first) return [{ item:drop.item, unitsPerDay:perDay, npc:Math.max(0,safe(drop.npc)), compacted:false, ratio:1, compactionLevel:0 }];

  const stages=[{item:drop.item,ratioFromPrev:1,npc:Math.max(0,safe(drop.npc)),cumulativeRatio:1}];
  let currentItem=drop.item, currentNpc=Math.max(0,safe(drop.npc)), cumulative=1;
  let [nextItem,nextRatioRaw]=first;
  let nextRatio=safe(nextRatioRaw);
  const seen=new Set([currentItem]);

  while(nextItem && nextRatio>0 && !seen.has(nextItem) && stages.length<8){
    cumulative*=nextRatio;
    currentNpc*=nextRatio;
    stages.push({item:nextItem,ratioFromPrev:nextRatio,npc:currentNpc,cumulativeRatio:cumulative});
    seen.add(nextItem);
    const more=MINION_DATA.compactionNext?.[nextItem];
    currentItem=nextItem;
    if(!more) break;
    nextItem=more.item;
    nextRatio=safe(more.ratio);
  }

  let units=perDay*interval;
  const outputs=[];
  for(let i=0;i<stages.length-1;i++){
    const ratio=stages[i+1].ratioFromPrev;
    const made=Math.floor((units+1e-9)/ratio);
    const remainder=Math.max(0,units-made*ratio);
    if(remainder>1e-9) outputs.push({
      item:stages[i].item,unitsPerDay:remainder/interval,npc:stages[i].npc,
      compacted:i>0,ratio:stages[i].cumulativeRatio,compactionLevel:i
    });
    units=made;
  }
  const last=stages[stages.length-1];
  if(units>1e-9) outputs.push({
    item:last.item,unitsPerDay:units/interval,npc:last.npc,
    compacted:stages.length>1,ratio:last.cumulativeRatio,compactionLevel:stages.length-1
  });
  return outputs;
}

function conditionMatches(upgrade, minion) {
  const c = upgrade?.condition;
  if (!c) return true;
  if (c.family && String(c.family).toLowerCase() !== String(minion.family).toLowerCase()) return false;
  if (c.mobSpawning != null && Boolean(c.mobSpawning) !== Boolean(minion.mobSpawning)) return false;
  if (c.name && c.name !== minion.name) return false;
  return true;
}

function normalizeUpgrades(ids, minion) {
  const selected = [];
  const warnings = [];
  for (const idRaw of ids) {
    const id = upper(idRaw || 'NONE');
    const upgrade = MINION_DATA.upgrades[id];
    if (!upgrade || id === 'NONE') continue;
    if (!conditionMatches(upgrade, minion)) {
      warnings.push(`${upgrade.name} is not compatible with ${minion.name}`);
      continue;
    }
    if (!upgrade.allowDuplicate && selected.some((x) => x.id === id)) {
      warnings.push(`${upgrade.name} cannot be counted twice`);
      continue;
    }
    selected.push({ id, ...upgrade });
  }
  return { selected, warnings };
}

function applyUpgradeDropTransforms(drop, upgrades) {
  let current = { ...drop };
  for (const upgrade of upgrades) for (const transform of upgrade.dropTransforms || []) {
    if (upper(transform.from) !== upper(current.item)) continue;
    current = { ...current, item: transform.to || current.item, npc: transform.npc == null ? current.npc : transform.npc, enchanted: transform.enchanted == null ? current.enchanted : transform.enchanted };
  }
  return current;
}

function upgradePairCompatible(a, b) {
  if (!a || !b) return true;
  if (a.id === b.id && !a.allowDuplicate) return false;
  if (a.exclusiveGroup && b.exclusiveGroup && a.exclusiveGroup === b.exclusiveGroup) return false;
  if ((a.incompatibleWith || []).includes(b.id)) return false;
  if ((b.incompatibleWith || []).includes(a.id)) return false;
  return true;
}

function upgradeCombinations(minion) {
  const eligible = Object.entries(MINION_DATA.upgrades).filter(([id,u]) => id !== 'NONE' && conditionMatches(u,minion)).map(([id,u]) => ({id,...u}));
  const combinations=[[]];
  for(let i=0;i<eligible.length;i++){
    combinations.push([eligible[i].id]);
    for(let j=i;j<eligible.length;j++) if(upgradePairCompatible(eligible[i],eligible[j])) combinations.push([eligible[i].id,eligible[j].id]);
  }
  return combinations;
}

function recipeCost(tierInfo, market) {
  if (!tierInfo?.exactRecipe || !Array.isArray(tierInfo.recipe)) {
    return { cost: null, complete: false, missing: ['Exact tier recipe unavailable'] };
  }
  if (!tierInfo.recipe.length) {
    return { cost: null, complete: false, missing: ['Base minion acquisition cost unavailable'] };
  }
  let cost = 0;
  const missing = [];
  for (const entry of tierInfo.recipe) {
    const amount = Math.max(0, safe(entry.amount));
    if (!amount) continue;
    if (String(entry.item).toUpperCase() === 'COINS') {
      cost += amount;
      continue;
    }
    const q = acquisitionQuote(entry.item, market);
    if (!q.available) {
      missing.push(entry.item);
      continue;
    }
    cost += q.price * amount;
  }
  return { cost, complete: missing.length === 0, missing };
}

function setupExtraCost(fuel, upgrades, market) {
  let cost = 0;
  const missing = [];
  if (fuel?.duration === -1 && fuel?.itemId) {
    const q = acquisitionQuote(fuel.itemId, market);
    if (q.available) cost += q.price;
    else missing.push(fuel.itemId);
  }
  for (const up of upgrades) {
    const q = acquisitionQuote(up.id, market);
    if (q.available) cost += q.price;
    else missing.push(up.id);
  }
  return { cost, complete: missing.length === 0, missing };
}

function finiteFuelExpensePerDay(fuel, market) {
  if (!fuel?.itemId || !(safe(fuel.duration) > 0)) return { cost: 0, available: true, unitsPerDay: 0 };
  const q = acquisitionQuote(fuel.itemId, market);
  const unitsPerDay = DAY_SECONDS / safe(fuel.duration);
  return { cost: q.price * unitsPerDay, available: q.available, unitsPerDay };
}

function confidenceLabel(score) {
  if (score >= 0.80) return 'HIGH';
  if (score >= 0.55) return 'MEDIUM';
  return 'LOW';
}

export function minionCatalog() {
  return {
    minions: Object.values(MINION_DATA.definitions).map((m) => ({
      id: m.id,
      name: m.name,
      family: m.family,
      tiers: Object.keys(m.tiers || {}).map(Number).sort((a,b)=>a-b),
      special: m.special || null,
      confidence: m.confidence || 'HIGH'
    })).sort((a,b)=>a.name.localeCompare(b.name)),
    fuels: Object.entries(MINION_DATA.fuels).map(([id,f]) => ({ id, ...f })),
    upgrades: Object.entries(MINION_DATA.upgrades).map(([id,u]) => ({ id, name:u.name, condition:u.condition || null, allowDuplicate:Boolean(u.allowDuplicate) })),
    defaults: {
      tier: 11,
      count: 1,
      fuel: 'ENCHANTED_LAVA_BUCKET',
      sellMethod: 'BEST',
      priceMode: 'LIVE',
      horizonDays: 1,
      collectionIntervalDays: 1
    }
  };
}

export function calculateMinion(minion, options, context) {
  if (!minion || minion.special) {
    return {
      id: minion?.id || '',
      name: minion?.name || 'Unknown',
      supported: false,
      reason: minion?.unsupportedReason || 'This minion is not yet supported.'
    };
  }

  const tier = Math.max(1, Math.min(12, Math.floor(safe(options.tier, 11))));
  const count = Math.max(1, Math.min(100, Math.floor(safe(options.count, 1))));
  const collectionIntervalDays = Math.max(1/24, Math.min(30, safe(options.collectionIntervalDays, 1)));
  const tierInfo = minion.tiers?.[tier];
  if (!tierInfo || !(safe(tierInfo.speed) > 0)) {
    return { id:minion.id, name:minion.name, family:minion.family, tier, supported:false, reason:`Tier ${tier} is not available for this minion.` };
  }

  const fuelId = upper(options.fuel || 'NONE');
  let fuel = MINION_DATA.fuels[fuelId] || MINION_DATA.fuels.NONE;
  const warnings = Array.isArray(minion.warnings) ? [...minion.warnings] : [];
  if (fuel.condition?.family && String(fuel.condition.family).toLowerCase() !== String(minion.family).toLowerCase()) {
    warnings.push(`${fuel.name} is not compatible with ${minion.family} minions; fuel bonus ignored.`);
    fuel = MINION_DATA.fuels.NONE;
  }

  const { selected: upgrades, warnings: upgradeWarnings } = normalizeUpgrades([options.upgrade1, options.upgrade2], minion);
  warnings.push(...upgradeWarnings);

  const expanderCount = upgrades.filter((u)=>u.id==='MINION_EXPANDER').length;
  const expanderBonus = expanderCount > 0 ? Math.pow(1.05,expanderCount)-1 : 0;
  const ordinaryUpgradeSpeed = upgrades
    .filter((u)=>u.id!=='MINION_EXPANDER')
    .reduce((sum,u)=>sum+Math.max(0,safe(u.speed)),0);
  const speedBonus = Math.max(0,
    safe(fuel.speed) +
    ordinaryUpgradeSpeed +
    expanderBonus +
    clamp(options.beaconPercent,0,100)/100 +
    clamp(options.crystalPercent,0,100)/100 +
    clamp(options.otherSpeedPercent,0,500)/100
  );
  const secondsPerAction = safe(tierInfo.speed) / (1 + speedBonus);
  const cyclesPerDay = DAY_SECONDS / (secondsPerAction * 2);
  const fuelDropMultiplier = Math.max(0, safe(fuel.drops, 1));
  const normalOutputMultiplier = upgrades.reduce((m,u)=>m*Math.max(0,safe(u.outputMultiplier,1)),1);
  const useCompactor = upgrades.some((u)=>u.compactor);

  const generated = [];
  const addDrop = (drop, cycles, source, outputMultiplier = 1) => {
    if (!drop || !(safe(drop.amount) > 0) || !(safe(drop.chance,1) > 0) || !(cycles > 0)) return;
    const effectiveDrop = applyUpgradeDropTransforms(drop, upgrades);
    const baseUnits = cycles * safe(effectiveDrop.amount) * safe(effectiveDrop.chance,1) * outputMultiplier;
    const stream=compactDropStream(effectiveDrop,baseUnits,useCompactor,collectionIntervalDays);
    for(const part of stream) generated.push({
      source,
      rawItem:drop.item,
      item:part.item,
      rawUnitsPerDay:baseUnits,
      unitsPerDay:part.unitsPerDay,
      npc:part.npc,
      compacted:part.compacted,
      ratio:part.ratio || 1,
      compactionLevel:part.compactionLevel || 0
    });
  };

  for (const drop of minion.drops || []) addDrop(drop,cyclesPerDay,'MINION',fuelDropMultiplier*normalOutputMultiplier);
  for (const up of upgrades) {
    for (const drop of up.extraDrops || []) addDrop(drop,cyclesPerDay,up.id,fuelDropMultiplier);
    if (up.cooldownDrop?.item && safe(up.cooldownDrop.seconds)>0) {
      let amountMultiplier = 1;
      if (minion.id === 'VOIDLING_GENERATOR' && up.id === 'SOULFLOW_ENGINE') amountMultiplier = 1 + 0.03*tier;
      const drop={item:up.cooldownDrop.item,amount:amountMultiplier,chance:1,npc:up.cooldownDrop.npc,enchanted:up.cooldownDrop.enchanted};
      addDrop(drop,DAY_SECONDS/safe(up.cooldownDrop.seconds),up.id,1);
    }
  }

  let grossPerMinionDay = 0;
  let bazaarTaxPerMinionDay = 0;
  let weightedCoverage = 0;
  let weightedCv = 0;
  let historicalRevenue = 0;
  let fallbackRevenue = 0;
  let unpricedOutputs = 0;
  const outputDetails = generated.map((g) => {
    const quote = saleQuote(g.item,g.npc,context);
    const grossRevenue = g.unitsPerDay * Math.max(0, safe(quote.raw));
    const revenue = g.unitsPerDay * quote.price;
    const bazaarTax = Math.max(0, grossRevenue - revenue);
    grossPerMinionDay += grossRevenue;
    bazaarTaxPerMinionDay += bazaarTax;
    if (quote.historicalSamples > 0 && revenue > 0) {
      historicalRevenue += revenue;
      weightedCoverage += revenue * quote.historicalCoverage;
      weightedCv += revenue * quote.historicalCv;
    }
    if (quote.price <= 0 && g.unitsPerDay > 0) unpricedOutputs += 1;
    if (upper(context.priceMode)==='7D' && quote.historicalFallback) fallbackRevenue += revenue;
    return { ...g, quote, grossRevenuePerDay:grossRevenue, bazaarTaxPerDay:bazaarTax, revenuePerDay:revenue };
  });

  const fuelExpense = finiteFuelExpensePerDay(fuel,context.market);
  const fuelExpensePerMinionDay = fuelExpense.cost;
  const netPerMinionDay = grossPerMinionDay - bazaarTaxPerMinionDay - fuelExpensePerMinionDay;
  const grossDay = grossPerMinionDay * count;
  const bazaarTaxDay = bazaarTaxPerMinionDay * count;
  const expensesDay = fuelExpensePerMinionDay * count;
  const netDay = netPerMinionDay * count;

  const recipe = recipeCost(tierInfo,context.market);
  const extras = setupExtraCost(fuel,upgrades,context.market);
  const setupComplete = recipe.complete && extras.complete;
  const setupPerMinion = recipe.cost == null ? null : recipe.cost + extras.cost;
  const setupCost = setupPerMinion == null ? null : setupPerMinion * count;
  const paybackDays = setupComplete && setupCost != null && netDay > 0 ? setupCost / netDay : null;
  const roi30dPercent = setupComplete && setupCost > 0 ? (netDay*30/setupCost)*100 : null;

  const histCoverage = historicalRevenue > 0 ? weightedCoverage / historicalRevenue : 0;
  const cv = historicalRevenue > 0 ? weightedCv / historicalRevenue : 0;
  let confidenceScore = 1;
  if (!setupComplete) confidenceScore -= 0.10;
  if (!fuelExpense.available) confidenceScore -= 0.10;
  if (unpricedOutputs > 0) confidenceScore -= Math.min(0.35,unpricedOutputs/Math.max(1,generated.length)*0.35);
  if (upper(context.priceMode)==='7D') {
    confidenceScore *= Math.max(0.20,histCoverage);
    if (fallbackRevenue > 0) confidenceScore -= Math.min(0.35,fallbackRevenue/Math.max(1,grossPerMinionDay)*0.35);
  }
  if (minion.confidence === 'MEDIUM') confidenceScore -= 0.15;
  confidenceScore = clamp(confidenceScore,0,1);

  return {
    id:minion.id,
    name:minion.name,
    family:minion.family,
    tier,
    count,
    collectionIntervalDays,
    supported:true,
    baseSecondsPerAction:safe(tierInfo.speed),
    effectiveSecondsPerAction:secondsPerAction,
    speedBonusPercent:speedBonus*100,
    cyclesPerDay,
    fuel:{id:fuelId,name:fuel.name,dropMultiplier:fuelDropMultiplier,duration:fuel.duration},
    upgrades:upgrades.map(u=>({id:u.id,name:u.name})),
    grossPerMinionDay,
    bazaarTaxPerMinionDay,
    fuelExpensePerMinionDay,
    netPerMinionDay,
    grossDay,
    bazaarTaxDay,
    expensesDay,
    netDay,
    setupPerMinion,
    setupCost,
    setupComplete,
    setupMissing:[...(recipe.missing||[]),...(extras.missing||[])],
    paybackDays,
    roi30dPercent,
    historicalCoverage:histCoverage,
    stabilityCv:cv,
    confidenceScore,
    confidence:confidenceLabel(confidenceScore),
    unpricedOutputs,
    warnings,
    outputDetails
  };
}

function calculateBestUpgradeSetup(minion, options, context) {
  if (!minion || minion.special) return calculateMinion(minion, options, context);
  const candidates = upgradeCombinations(minion)
    .map(ids => calculateMinion(minion,{...options,upgrade1:ids[0]||'NONE',upgrade2:ids[1]||'NONE'},context))
    .filter(row => row.supported)
    .sort((a,b) => safe(b.netPerMinionDay,-Infinity)-safe(a.netPerMinionDay,-Infinity) || Number(Boolean(b.setupComplete))-Number(Boolean(a.setupComplete)) || safe(a.setupPerMinion,Infinity)-safe(b.setupPerMinion,Infinity) || a.upgrades.length-b.upgrades.length);
  const best=candidates[0] || calculateMinion(minion,{...options,upgrade1:'NONE',upgrade2:'NONE'},context);
  const bestNet=safe(best.netPerMinionDay);
  best.upgradeSearchCount=candidates.length;
  best.upgradeAlternatives=candidates.map((row,index)=>({rank:index+1,upgrades:row.upgrades,grossPerMinionDay:row.grossPerMinionDay,bazaarTaxPerMinionDay:row.bazaarTaxPerMinionDay,expensesPerMinionDay:row.fuelExpensePerMinionDay,netPerMinionDay:row.netPerMinionDay,totalNetDay:row.netDay,setupPerMinion:row.setupPerMinion,setupComplete:row.setupComplete,speedBonusPercent:row.speedBonusPercent,deltaFromBestPerMinionDay:row.netPerMinionDay-bestNet}));
  return best;
}

export function calculateMinionRankings(options = {}, context = {}) {
  const priceMode = upper(options.priceMode || 'LIVE') === '7D' ? '7D' : 'LIVE';
  const sellMethod = ['BEST','ORDER','INSTANT','NPC'].includes(upper(options.sellMethod)) ? upper(options.sellMethod) : 'BEST';
  const ctx = {
    market:context.market || {},
    historyStats:context.historyStats || new Map(),
    itemMeta:context.itemMeta || new Map(),
    taxRate:clamp(context.taxRate,0,0.25),
    priceMode,
    sellMethod,
    historyDays:Math.max(1,Math.min(7,Math.round(safe(options.compareDays,7))))
  };
  const family = String(options.family || 'ALL').toLowerCase();
  const search = String(options.search || '').trim().toLowerCase();
  const rows=[];
  for (const minion of Object.values(MINION_DATA.definitions)) {
    if (family !== 'all' && String(minion.family).toLowerCase() !== family) continue;
    if (search && !String(minion.name).toLowerCase().includes(search)) continue;
    const compareDays=Math.max(1,Math.min(7,Math.round(safe(options.compareDays,7))));
    const activeBest = calculateBestUpgradeSetup(minion,options,{...ctx,priceMode,historyDays:compareDays});
    if (!activeBest.supported) {
      rows.push(activeBest);
      continue;
    }
    const setupOptions={...options,upgrade1:activeBest.upgrades?.[0]?.id||'NONE',upgrade2:activeBest.upgrades?.[1]?.id||'NONE'};
    const liveRow = calculateMinion(minion,setupOptions,{...ctx,priceMode:'LIVE',historyDays:compareDays});
    const expectedHistoryRow = calculateMinion(minion,setupOptions,{...ctx,priceMode:'7D',historyDays:compareDays});
    const row = priceMode === '7D' ? expectedHistoryRow : liveRow;
    row.upgradeSearchCount=activeBest.upgradeSearchCount;
    row.upgradeAlternatives=activeBest.upgradeAlternatives;
    row.compareDays=compareDays;
    row.liveNetDay = liveRow.netDay;
    row.expectedHistoryNetDay = expectedHistoryRow.netDay;
    row.expected7dNetDay = expectedHistoryRow.netDay;
    row.currentVsHistoryPercent = Math.abs(expectedHistoryRow.netDay) > 1e-9
      ? ((liveRow.netDay - expectedHistoryRow.netDay) / Math.abs(expectedHistoryRow.netDay)) * 100
      : null;
    row.currentVs7dPercent = row.currentVsHistoryPercent;
    rows.push(row);
  }
  const netRanked=rows.filter(r=>r.supported).slice().sort((a,b)=>safe(b.netDay,-Infinity)-safe(a.netDay,-Infinity));
  for(let i=0;i<netRanked.length;i++){
    const row=netRanked[i],next=netRanked[i+1]||null;
    row.netRank=i+1;
    row.netGapToNextDay=next?safe(row.netDay)-safe(next.netDay):null;
    row.nextNetName=next?.name||null;
  }

  const sort = upper(options.sort || 'NET');
  const metric = (row) => {
    if (!row.supported) return -Infinity;
    if (sort === 'PAYBACK') return row.paybackDays == null ? Infinity : -row.paybackDays;
    if (sort === 'ROI') return safe(row.roi30dPercent,-Infinity);
    if (sort === 'GROSS') return safe(row.grossDay,-Infinity);
    if (sort === 'STABILITY') return -safe(row.stabilityCv,Infinity);
    if (sort === 'VS7D') return safe(row.currentVsHistoryPercent,-Infinity);
    return safe(row.netDay,-Infinity);
  };
  rows.sort((a,b)=>metric(b)-metric(a) || String(a.name).localeCompare(String(b.name)));
  const horizonDays = 1;

  return {
    generatedAt:Date.now(),
    marketUpdatedAt:context.marketUpdatedAt || null,
    priceMode,
    sellMethod,
    horizonDays,
    taxPercent:ctx.taxRate*100,
    options:{...options,horizonDays},
    rows:rows.map((r)=>r.supported?{...r,horizon:{days:horizonDays,gross:r.grossDay*horizonDays,bazaarTax:r.bazaarTaxDay*horizonDays,expenses:r.expensesDay*horizonDays,net:r.netDay*horizonDays}}:r),
    catalog:minionCatalog()
  };
}
