const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const safeNumber = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FIVE_MINUTES_HOURS = 5 / 60;
const DYNAMICS_HALF_LIFE_MS = 7 * DAY_MS;
export const NPC_DAILY_SELL_LIMIT_COINS = 500_000_000;

function heuristicHazard(activeOrders, spreadPercent, hourlyFlow, bookLevels) {
  const orderPressure = clamp(Math.log10(Math.max(0, activeOrders) + 1) / 3, 0, 1);
  const spreadPressure = clamp(Math.log10(Math.max(0, spreadPercent) + 1) / 1.55, 0, 1);
  const activityPressure = clamp(Math.log10(Math.max(0, hourlyFlow) + 1) / 5.5, 0, 1);
  const thinBookPressure = 1 - clamp(bookLevels / 30, 0, 1);
  return 0.05 + orderPressure * 0.60 + spreadPressure * 1.10 + activityPressure * 0.25 + thinBookPressure * 0.20;
}

function blendHazard(prior, events = 0, observedMs = 0) {
  const hours = Math.max(0, safeNumber(observedMs) / HOUR_MS);
  if (hours < 0.10) return prior;
  const observed = (Math.max(0, safeNumber(events)) + 0.35) / (hours + 0.70);
  const weight = clamp(hours / 12, 0, 0.82);
  return prior * (1 - weight) + observed * weight;
}

function spreadReliability(spreadPercent, dynamics) {
  const spread = Math.max(0, safeNumber(spreadPercent));
  let absolute = 1;
  if (spread > 100) absolute = 0.28;
  else if (spread > 60) absolute = 0.42;
  else if (spread > 35) absolute = 0.58;
  else if (spread > 20) absolute = 0.72;
  else if (spread > 10) absolute = 0.86;

  const samples = Math.max(0, safeNumber(dynamics?.marginSamples));
  if (samples < 6) return absolute;

  const mean = Math.max(0, safeNumber(dynamics?.marginMean));
  const variance = samples > 1 ? Math.max(0, safeNumber(dynamics?.marginM2) / Math.max(1, samples - 1)) : 0;
  const std = Math.sqrt(variance);
  const scale = Math.max(0.25, std, mean * 0.15);
  const z = (spread - mean) / scale;
  const abnormalPenalty = z <= 1 ? 1 : clamp(1 - (z - 1) * 0.16, 0.30, 1);
  return Math.min(absolute, abnormalPenalty);
}

function poissonAtLeastOne(ratePerHour, windowHours) {
  const rate = Math.max(0, safeNumber(ratePerHour));
  return clamp(1 - Math.exp(-rate * windowHours), 0, 1);
}

function sumDepthNotional(summary) {
  return summary.reduce((sum, level) => {
    const amount = Math.max(0, safeNumber(level?.amount));
    const price = Math.max(0, safeNumber(level?.pricePerUnit));
    return sum + amount * price;
  }, 0);
}

function historySignals(history, currentMid) {
  const samples = Math.max(0, safeNumber(history?.samples7d));
  const coverage = clamp(safeNumber(history?.coverage7d), 0, 1);
  const avgMid = Math.max(0, safeNumber(history?.avgMid7d));
  const stdMid = Math.max(0, safeNumber(history?.stdMid7d));
  const cv = avgMid > 0 ? stdMid / avgMid : 0;
  const stability = samples >= 6 && avgMid > 0 ? clamp(Math.exp(-cv * 8), 0.05, 1) : 0;
  const vsAveragePercent = avgMid > 0 ? ((currentMid - avgMid) / avgMid) * 100 : 0;
  const zScore = stdMid > 0 ? (currentMid - avgMid) / stdMid : 0;
  const anomaly = samples >= 12 && stdMid > 0 ? clamp((Math.abs(zScore) - 2) / 4, 0, 1) : 0;
  return { samples, coverage, avgMid, stdMid, cv, stability, vsAveragePercent, zScore, anomaly };
}

function computeOpportunityScore({
  confidence,
  roi,
  estimatedCoinsPerHour,
  marketSpeed,
  marketReliability,
  fillChance,
  risk,
  manipulationScore,
  netProfitPerUnit
}) {
  if (!(netProfitPerUnit > 0)) return 0;
  const roiQuality = roi > 0 ? clamp(Math.log10(roi + 1) / 1.7, 0, 1) : 0;
  const hourlyQuality = estimatedCoinsPerHour > 0 ? clamp(Math.log10(estimatedCoinsPerHour + 1) / 8, 0, 1) : 0;
  const speedQuality = marketSpeed > 0 ? clamp(Math.log10(marketSpeed + 1) / 5.5, 0, 1) : 0;
  const raw = clamp(
    confidence * 0.28 +
    hourlyQuality * 100 * 0.30 +
    roiQuality * 100 * 0.12 +
    speedQuality * 100 * 0.08 +
    marketReliability * 100 * 0.12 +
    clamp(fillChance, 0, 1) * 100 * 0.10,
    0,
    100
  );

  let cap = 100;
  if (risk === 'MEDIUM') cap = Math.min(cap, 79);
  if (risk === 'HIGH') cap = Math.min(cap, 49);
  if (manipulationScore >= 70) cap = Math.min(cap, 44);
  else if (manipulationScore >= 55) cap = Math.min(cap, 64);
  if (confidence < 35) cap = Math.min(cap, 45);
  else if (confidence < 50) cap = Math.min(cap, 65);

  return Math.round(Math.min(raw, cap));
}

function recomputeTaxDependent(flip, taxRate) {
  if (!flip || flip.flipType === 'REVERSE_NPC') return flip;
  const safeTax = clamp(safeNumber(taxRate, flip.taxRate), 0, 0.25);
  const taxPerUnit = flip.exitPrice * safeTax;
  const netProfitPerUnit = flip.exitPrice - taxPerUnit - flip.entryPrice;
  const roi = flip.entryPrice > 0 ? (netProfitPerUnit / flip.entryPrice) * 100 : 0;
  const estimatedCoinsPerHour = Math.max(0, netProfitPerUnit) * flip.marketSpeed * flip.executionEfficiency;
  const opportunityScore = computeOpportunityScore({
    confidence: flip.confidence,
    roi,
    estimatedCoinsPerHour,
    marketSpeed: flip.marketSpeed,
    marketReliability: flip.marketReliability,
    fillChance: flip.fillChance,
    risk: flip.risk,
    manipulationScore: flip.manipulationScore,
    netProfitPerUnit
  });

  return {
    ...flip,
    taxRate: safeTax,
    taxPerUnit,
    netProfitPerUnit,
    roi,
    estimatedCoinsPerHour,
    opportunityScore
  };
}

export function analyseProduct(product, itemMeta = null, options = {}, dynamics = null, history = null) {
  const taxRate = clamp(safeNumber(options.taxRate, 0.0125), 0, 0.25);
  const step = Math.max(0, safeNumber(options.orderPriceStep, 0.1));

  const sellSummary = Array.isArray(product?.sell_summary) ? product.sell_summary : [];
  const buySummary = Array.isArray(product?.buy_summary) ? product.buy_summary : [];
  const quick = product?.quick_status ?? {};

  // Hypixel names these from the instant-transaction perspective:
  // sell_summary = current buy orders; buy_summary = current sell offers.
  // Use the top order-book level rather than quick_status, whose prices are weighted 2% averages.
  const bestBuyOrder = sellSummary.length ? safeNumber(sellSummary[0]?.pricePerUnit) : safeNumber(quick.sellPrice);
  const bestSellOffer = buySummary.length ? safeNumber(buySummary[0]?.pricePerUnit) : safeNumber(quick.buyPrice);
  if (!(bestBuyOrder > 0) || !(bestSellOffer > 0) || bestSellOffer <= bestBuyOrder) return null;

  const entryPrice = bestBuyOrder + step;
  const exitPrice = Math.max(0, bestSellOffer - step);
  const grossSpread = exitPrice - entryPrice;
  const spreadPercent = entryPrice > 0 ? (grossSpread / entryPrice) * 100 : 0;
  const currentMid = (bestBuyOrder + bestSellOffer) / 2;

  const sellMovingWeek = Math.max(0, safeNumber(quick.sellMovingWeek));
  const buyMovingWeek = Math.max(0, safeNumber(quick.buyMovingWeek));
  const weeklyTwoWayVolume = sellMovingWeek + buyMovingWeek;
  const weeklyCycleVolume = Math.min(sellMovingWeek, buyMovingWeek);
  const dailyCycleVolume = weeklyCycleVolume / 7;
  const entryFlowPerHour = sellMovingWeek / (7 * 24);
  const exitFlowPerHour = buyMovingWeek / (7 * 24);
  const marketSpeed = Math.min(entryFlowPerHour, exitFlowPerHour);
  const buyVolumePerDay = buyMovingWeek / 7;
  const sellVolumePerDay = sellMovingWeek / 7;
  const weeklyCycleNotional = weeklyCycleVolume * currentMid;

  const sellVolume = Math.max(0, safeNumber(quick.sellVolume));
  const buyVolume = Math.max(0, safeNumber(quick.buyVolume));
  const sellOrders = Math.max(0, safeNumber(quick.sellOrders));
  const buyOrders = Math.max(0, safeNumber(quick.buyOrders));

  const topBuyOrderAmount = Math.max(0, safeNumber(sellSummary[0]?.amount));
  const topSellOfferAmount = Math.max(0, safeNumber(buySummary[0]?.amount));
  const buyDepthUnits = sellSummary.reduce((sum, level) => sum + Math.max(0, safeNumber(level?.amount)), 0);
  const sellDepthUnits = buySummary.reduce((sum, level) => sum + Math.max(0, safeNumber(level?.amount)), 0);
  const buyDepthNotional = sumDepthNotional(sellSummary);
  const sellDepthNotional = sumDepthNotional(buySummary);
  const minDepthNotional = Math.min(buyDepthNotional, sellDepthNotional);
  const bookLevelsBuy = sellSummary.length;
  const bookLevelsSell = buySummary.length;

  const unitLiquidityScore = clamp(Math.log10(weeklyCycleVolume + 1) / 7, 0, 1);
  const notionalLiquidityScore = clamp(Math.log10(weeklyCycleNotional + 1) / 11, 0, 1);
  const liquidityScore = unitLiquidityScore * 0.45 + notionalLiquidityScore * 0.55;
  const orderCountScore = clamp(Math.log10(sellOrders + buyOrders + 1) / 4, 0, 1);
  const sideBalance = weeklyTwoWayVolume > 0
    ? 1 - Math.abs(sellMovingWeek - buyMovingWeek) / weeklyTwoWayVolume
    : 0;
  const bookLevelsScore = clamp((bookLevelsBuy + bookLevelsSell) / 60, 0, 1);
  const depthNotionalScore = clamp(Math.log10(minDepthNotional + 1) / 9, 0, 1);
  const topLevelNotional = Math.min(topBuyOrderAmount * bestBuyOrder, topSellOfferAmount * bestSellOffer);
  const topLevelScore = clamp(Math.log10(topLevelNotional + 1) / 7, 0, 1);
  const bookScore = clamp(bookLevelsScore * 0.35 + depthNotionalScore * 0.45 + topLevelScore * 0.20, 0, 1);

  const entryPriorHazard = heuristicHazard(sellOrders, spreadPercent, entryFlowPerHour, bookLevelsBuy);
  const exitPriorHazard = heuristicHazard(buyOrders, spreadPercent, exitFlowPerHour, bookLevelsSell);
  const entryRepriceHazardPerHour = blendHazard(entryPriorHazard, dynamics?.entryBetterEvents, dynamics?.observedMs);
  const exitRepriceHazardPerHour = blendHazard(exitPriorHazard, dynamics?.exitBetterEvents, dynamics?.observedMs);
  const combinedHazard = entryRepriceHazardPerHour + exitRepriceHazardPerHour;

  const marginStability = spreadReliability(spreadPercent, dynamics);
  const hist = historySignals(history, currentMid);
  const historicalStability = hist.samples >= 6 ? hist.stability : marginStability;
  const historicalEvidence = hist.samples >= 6
    ? historicalStability * (0.60 + 0.40 * hist.coverage)
    : marginStability;

  const sideReliability = 0.50 + 0.50 * sideBalance;
  const depthReliability = 0.45 + 0.55 * bookScore;
  const historyReliability = 0.70 + 0.30 * historicalEvidence;
  const marketReliability = clamp(marginStability * sideReliability * depthReliability * historyReliability, 0.05, 1);

  const competitionScore = Math.round(clamp(
    100 * (orderCountScore * 0.42 + clamp(Math.log10(combinedHazard + 1) / 1.2, 0, 1) * 0.58),
    0,
    100
  ));

  const handlingLoss = clamp(combinedHazard * (8 / 3600), 0, 0.12);
  const competitionEfficiency = clamp((1 - competitionScore / 100 * 0.32) * (1 - handlingLoss), 0.55, 1);
  const executionEfficiency = clamp(marketReliability * competitionEfficiency, 0.03, 1);

  // This is deliberately a one-unit, top-priority estimate rather than a batch-fill promise.
  const entryActivityChance = poissonAtLeastOne(entryFlowPerHour, FIVE_MINUTES_HOURS);
  const exitActivityChance = poissonAtLeastOne(exitFlowPerHour, FIVE_MINUTES_HOURS);
  const repriceSurvival = Math.exp(-combinedHazard * FIVE_MINUTES_HOURS);
  const managedRepostFactor = 0.72 + 0.28 * repriceSurvival;
  const fillChance = clamp(
    entryActivityChance * exitActivityChance * Math.sqrt(marketReliability) * managedRepostFactor,
    0,
    0.995
  );

  const shortStability = marginStability * Math.exp(-combinedHazard * 0.06);
  const blendedStability = hist.samples >= 6
    ? shortStability * (1 - 0.70 * hist.coverage) + historicalStability * (0.70 * hist.coverage)
    : shortStability;
  const priceStability = Math.round(clamp(100 * blendedStability, 0, 100));

  const confidence = Math.round(clamp(
    100 * (
      liquidityScore * 0.24 +
      orderCountScore * 0.10 +
      sideBalance * 0.14 +
      bookScore * 0.22 +
      marginStability * 0.15 +
      historicalEvidence * 0.15
    ),
    0,
    100
  ));

  const manipulationScore = Math.round(clamp(
    (1 - marginStability) * 28 +
    (1 - sideBalance) * 14 +
    (1 - bookScore) * 25 +
    (1 - depthNotionalScore) * 15 +
    clamp(spreadPercent / 50, 0, 1) * 10 +
    hist.anomaly * 8,
    0,
    100
  ));

  let risk = 'LOW';
  if (
    confidence < 35 ||
    weeklyCycleNotional < 5_000_000 ||
    minDepthNotional < 250_000 ||
    spreadPercent > 50 ||
    manipulationScore >= 70 ||
    marketReliability < 0.20
  ) risk = 'HIGH';
  else if (
    confidence < 60 ||
    weeklyCycleNotional < 50_000_000 ||
    minDepthNotional < 2_000_000 ||
    spreadPercent > 20 ||
    manipulationScore >= 45 ||
    marketReliability < 0.42
  ) risk = 'MEDIUM';

  const base = {
    flipType: 'ORDER',
    productId: product.product_id ?? quick.productId ?? 'UNKNOWN',
    itemName: itemMeta?.name ?? humanizeId(product.product_id ?? quick.productId ?? 'UNKNOWN'),
    category: itemMeta?.category ?? null,
    tier: itemMeta?.tier ?? null,
    npcSellPrice: safeNumber(itemMeta?.npcSellPrice, 0),
    bestBuyOrder,
    bestSellOffer,
    entryPrice,
    exitPrice,
    grossSpread,
    marginPercent: spreadPercent,
    spreadPercent,
    taxRate,
    taxPerUnit: 0,
    netProfitPerUnit: 0,
    roi: 0,
    currentMid,
    weeklyTwoWayVolume,
    weeklyCycleVolume,
    weeklyCycleNotional,
    dailyCycleVolume,
    entryFlowPerHour,
    exitFlowPerHour,
    marketSpeed,
    buyVolumePerDay,
    sellVolumePerDay,
    sellMovingWeek,
    buyMovingWeek,
    sellVolume,
    buyVolume,
    sellOrders,
    buyOrders,
    topBuyOrderAmount,
    topSellOfferAmount,
    buyDepthUnits,
    sellDepthUnits,
    buyDepthNotional,
    sellDepthNotional,
    minDepthNotional,
    bookLevelsBuy,
    bookLevelsSell,
    bookScore,
    depthNotionalScore,
    entryRepriceHazardPerHour,
    exitRepriceHazardPerHour,
    competitionScore,
    competitionEfficiency,
    executionEfficiency,
    fillChance,
    priceStability,
    marketReliability,
    confidence,
    manipulationScore,
    opportunityScore: 0,
    risk,
    dynamicsHours: Math.max(0, safeNumber(dynamics?.observedMs) / HOUR_MS),
    avgBuy7d: safeNumber(history?.avgBuy7d),
    avgSell7d: safeNumber(history?.avgSell7d),
    avgMid7d: hist.avgMid,
    stdMid7d: hist.stdMid,
    historySamples7d: hist.samples,
    historyCoverage7d: hist.coverage,
    vs7dAveragePercent: hist.vsAveragePercent,
    priceZScore7d: hist.zScore,
    priceTrend: 'STABLE',
    priceChangePercent: 0,
    priceChange1hPercent: 0,
    priceChange24hPercent: 0,
    marketUpdatedAt: null
  };

  return recomputeTaxDependent(base, taxRate);
}

export function withTax(flip, taxRate) {
  return recomputeTaxDependent(flip, taxRate);
}

function vwapForUnits(summary, targetUnits) {
  let remaining = Math.max(0, safeNumber(targetUnits));
  let units = 0;
  let cost = 0;
  for (const level of summary) {
    if (remaining <= 0) break;
    const amount = Math.max(0, safeNumber(level?.amount));
    const price = Math.max(0, safeNumber(level?.pricePerUnit));
    if (!(amount > 0) || !(price > 0)) continue;
    const take = Math.min(amount, remaining);
    units += take;
    cost += take * price;
    remaining -= take;
  }
  return { units, averagePrice: units > 0 ? cost / units : 0 };
}

export function analyseReverseNpc(product, itemMeta = null, history = null) {
  const npcSellPrice = safeNumber(itemMeta?.npcSellPrice, 0);
  if (!(npcSellPrice > 0)) return null;

  const buySummary = Array.isArray(product?.buy_summary) ? product.buy_summary : [];
  const sellSummary = Array.isArray(product?.sell_summary) ? product.sell_summary : [];
  const quick = product?.quick_status ?? {};
  const instantBuyPrice = buySummary.length ? safeNumber(buySummary[0]?.pricePerUnit) : safeNumber(quick.buyPrice);
  if (!(instantBuyPrice > 0) || npcSellPrice <= instantBuyPrice) return null;

  const topUnitProfit = npcSellPrice - instantBuyPrice;
  const roi = (topUnitProfit / instantBuyPrice) * 100;
  const buyMovingWeek = Math.max(0, safeNumber(quick.buyMovingWeek));
  const marketSpeed = buyMovingWeek / (7 * 24);
  const sellDepthUnits = buySummary.reduce((sum, level) => sum + Math.max(0, safeNumber(level?.amount)), 0);
  const sellDepthNotional = sumDepthNotional(buySummary);
  const buyOrders = Math.max(0, safeNumber(quick.buyOrders));
  const sellOrders = Math.max(0, safeNumber(quick.sellOrders));

  const npcDailyUnitLimit = Math.max(0, Math.floor(NPC_DAILY_SELL_LIMIT_COINS / npcSellPrice));
  const npcUnitLimitPerHour = npcDailyUnitLimit / 24;
  const targetUnitsPerHour = Math.min(marketSpeed, npcUnitLimitPerHour);
  const visibleUnitsForTarget = Math.min(targetUnitsPerHour, sellDepthUnits);
  const depthCoverage = targetUnitsPerHour > 0 ? clamp(sellDepthUnits / targetUnitsPerHour, 0, 1) : 0;
  const vwap = vwapForUnits(buySummary, Math.max(1, visibleUnitsForTarget));
  const conservativeBuyPrice = vwap.averagePrice > 0 ? vwap.averagePrice : instantBuyPrice;
  const conservativeProfitPerUnit = Math.max(0, npcSellPrice - conservativeBuyPrice);
  const effectiveUnitsPerHour = targetUnitsPerHour * depthCoverage;
  const estimatedCoinsPerHour = conservativeProfitPerUnit * effectiveUnitsPerHour;
  const maxDailyProfit = conservativeProfitPerUnit * npcDailyUnitLimit;
  const hoursToNpcLimit = marketSpeed > 0 ? npcDailyUnitLimit / marketSpeed : Infinity;

  const volumeConfidence = clamp(Math.log10(buyMovingWeek + 1) / 7, 0, 1);
  const depthConfidence = clamp(Math.log10(sellDepthNotional + 1) / 9, 0, 1);
  const confidence = Math.round(clamp(100 * (volumeConfidence * 0.55 + depthConfidence * 0.30 + depthCoverage * 0.15), 0, 100));
  const fillChance = clamp(poissonAtLeastOne(marketSpeed, FIVE_MINUTES_HOURS) * (0.65 + 0.35 * depthCoverage), 0, 0.995);
  const manipulationScore = Math.round(clamp((1 - depthConfidence) * 55 + (1 - depthCoverage) * 45, 0, 100));
  let risk = 'LOW';
  if (confidence < 40 || depthCoverage < 0.25 || manipulationScore >= 70) risk = 'HIGH';
  else if (confidence < 65 || depthCoverage < 0.75 || manipulationScore >= 45) risk = 'MEDIUM';

  const currentMid = instantBuyPrice;
  const hist = historySignals(history, currentMid);
  const priceStability = hist.samples >= 6 ? Math.round(hist.stability * 100) : Math.round(depthConfidence * 100);
  const marketReliability = clamp((confidence / 100) * (0.70 + 0.30 * priceStability / 100), 0.05, 1);
  const opportunityScore = computeOpportunityScore({
    confidence,
    roi,
    estimatedCoinsPerHour,
    marketSpeed: effectiveUnitsPerHour,
    marketReliability,
    fillChance,
    risk,
    manipulationScore,
    netProfitPerUnit: topUnitProfit
  });

  return {
    flipType: 'REVERSE_NPC',
    productId: product.product_id ?? quick.productId ?? 'UNKNOWN',
    itemName: itemMeta?.name ?? humanizeId(product.product_id ?? quick.productId ?? 'UNKNOWN'),
    category: itemMeta?.category ?? null,
    tier: itemMeta?.tier ?? null,
    npcSellPrice,
    entryPrice: instantBuyPrice,
    exitPrice: npcSellPrice,
    bestBuyOrder: null,
    bestSellOffer: instantBuyPrice,
    currentMid,
    grossSpread: topUnitProfit,
    marginPercent: roi,
    spreadPercent: roi,
    taxRate: 0,
    taxPerUnit: 0,
    netProfitPerUnit: topUnitProfit,
    conservativeProfitPerUnit,
    roi,
    weeklyTwoWayVolume: buyMovingWeek,
    weeklyCycleVolume: buyMovingWeek,
    weeklyCycleNotional: buyMovingWeek * instantBuyPrice,
    dailyCycleVolume: buyMovingWeek / 7,
    entryFlowPerHour: marketSpeed,
    exitFlowPerHour: Infinity,
    marketSpeed,
    effectiveUnitsPerHour,
    buyVolumePerDay: buyMovingWeek / 7,
    sellVolumePerDay: Math.max(0, safeNumber(quick.sellMovingWeek)) / 7,
    estimatedCoinsPerHour,
    sellMovingWeek: Math.max(0, safeNumber(quick.sellMovingWeek)),
    buyMovingWeek,
    sellVolume: Math.max(0, safeNumber(quick.sellVolume)),
    buyVolume: Math.max(0, safeNumber(quick.buyVolume)),
    sellOrders,
    buyOrders,
    topBuyOrderAmount: 0,
    topSellOfferAmount: Math.max(0, safeNumber(buySummary[0]?.amount)),
    buyDepthUnits: sellSummary.reduce((sum, level) => sum + Math.max(0, safeNumber(level?.amount)), 0),
    sellDepthUnits,
    buyDepthNotional: sumDepthNotional(sellSummary),
    sellDepthNotional,
    minDepthNotional: sellDepthNotional,
    bookLevelsBuy: sellSummary.length,
    bookLevelsSell: buySummary.length,
    entryRepriceHazardPerHour: 0,
    exitRepriceHazardPerHour: 0,
    competitionScore: 0,
    competitionEfficiency: 1,
    executionEfficiency: depthCoverage,
    fillChance,
    priceStability,
    marketReliability,
    confidence,
    manipulationScore,
    opportunityScore,
    risk,
    npcDailyLimitCoins: NPC_DAILY_SELL_LIMIT_COINS,
    npcDailyUnitLimit,
    npcUnitLimitPerHour,
    npcMaxDailyProfit: maxDailyProfit,
    npcHoursToDailyLimit: hoursToNpcLimit,
    npcDepthCoverage: depthCoverage,
    npcVwapBuyPrice: conservativeBuyPrice,
    dynamicsHours: 0,
    avgBuy7d: safeNumber(history?.avgBuy7d),
    avgSell7d: safeNumber(history?.avgSell7d),
    avgMid7d: hist.avgMid,
    stdMid7d: hist.stdMid,
    historySamples7d: hist.samples,
    historyCoverage7d: hist.coverage,
    vs7dAveragePercent: hist.vsAveragePercent,
    priceZScore7d: hist.zScore,
    priceTrend: 'STABLE',
    priceChangePercent: 0,
    priceChange1hPercent: 0,
    priceChange24hPercent: 0,
    marketUpdatedAt: null
  };
}

export function updateDynamics(previous, current, dynamics = null, elapsedMs = 0) {
  const elapsed = Math.max(0, safeNumber(elapsedMs));
  // Keep learned competition/spread behavior focused on recent conditions instead of
  // letting months-old market behavior dominate forever.
  const decay = elapsed > 0 ? Math.exp(-Math.log(2) * elapsed / DYNAMICS_HALF_LIFE_MS) : 1;
  const next = {
    observedMs: Math.max(0, safeNumber(dynamics?.observedMs)) * decay,
    entryBetterEvents: Math.max(0, safeNumber(dynamics?.entryBetterEvents)) * decay,
    exitBetterEvents: Math.max(0, safeNumber(dynamics?.exitBetterEvents)) * decay,
    marginSamples: Math.max(0, safeNumber(dynamics?.marginSamples)) * decay,
    marginMean: safeNumber(dynamics?.marginMean),
    marginM2: Math.max(0, safeNumber(dynamics?.marginM2)) * decay,
    updatedTs: Date.now()
  };

  if (previous && elapsed > 0) {
    next.observedMs += elapsed;
    const eps = 1e-9;
    if (safeNumber(current?.bestBuyOrder) > safeNumber(previous?.bestBuyOrder) + eps) next.entryBetterEvents += 1;
    if (safeNumber(current?.bestSellOffer) + eps < safeNumber(previous?.bestSellOffer)) next.exitBetterEvents += 1;
  }

  const x = Math.max(0, safeNumber(current?.marginPercent));
  const oldWeight = next.marginSamples;
  next.marginSamples = oldWeight + 1;
  const delta = x - next.marginMean;
  next.marginMean += delta / next.marginSamples;
  const delta2 = x - next.marginMean;
  next.marginM2 += delta * delta2;
  return next;
}

export function humanizeId(id) {
  return String(id || '')
    .replace(/:/g, ' ')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
