const els = Object.fromEntries([...document.querySelectorAll('[id]')].map((el) => [el.id, el]));
let flips = [];
let status = null;
let strategy = localStorage.getItem('bz.strategy') || 'BALANCED';

const compact = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 1 });
};

const pct = (n, digits = 1) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(digits)}%` : '—';
const val = (id) => els[id]?.value ?? '';
const num = (id) => Number(String(val(id)).replace(/,/g, '')) || 0;
const escapeHtml = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

const persistedIds = ['search', 'tax', 'minMargin', 'minRoi', 'minVolume', 'minCoinsHour', 'minFillChance', 'risk', 'sort'];
if (localStorage.getItem('bz.minMargin') == null && localStorage.getItem('bz.minProfit') != null) {
  localStorage.setItem('bz.minMargin', localStorage.getItem('bz.minProfit'));
}
for (const id of persistedIds) {
  const saved = localStorage.getItem(`bz.${id}`);
  if (saved != null && els[id]) els[id].value = saved;
}

const columnDefinitions = [
  {
    id: 'item', label: 'Item', default: true,
    help: 'The Bazaar product name. Product ID can be enabled separately.',
    render: (f) => {
      const meta = [f.tier, f.category, f.flipType === 'REVERSE_NPC' ? 'Reverse NPC' : null].filter(Boolean).join(' · ');
      return `<div class="itemCell"><span class="itemName">${escapeHtml(f.itemName)}</span>${meta ? `<span class="itemMeta">${escapeHtml(meta)}</span>` : ''}</div>`;
    }
  },
  {
    id: 'buy', label: 'Buy', default: true,
    help: 'Entry price. Normal flips place a buy order one configured price step above the current top buy order. Reverse NPC uses the current instant-buy top price.',
    render: (f) => f.flipType === 'REVERSE_NPC' ? `<span>${money(f.entryPrice)}</span><span class="itemMeta">instant buy</span>` : money(f.entryPrice)
  },
  {
    id: 'sell', label: 'Sell', default: true,
    help: 'Exit price. Normal flips place a sell offer one configured step below the current top sell offer. Reverse NPC exits at the official NPC sell price.',
    render: (f) => f.flipType === 'REVERSE_NPC' ? `<span>${money(f.exitPrice)}</span><span class="itemMeta">NPC</span>` : money(f.exitPrice)
  },
  {
    id: 'margin', label: 'Margin', default: true,
    help: 'Net coins earned on one unit after the effective Bazaar tax: Sell − Buy − tax. Reverse NPC margin is NPC sell price − current instant-buy top price.',
    render: (f) => `<span class="${f.netProfitPerUnit > 0 ? 'positive' : ''}">${f.netProfitPerUnit > 0 ? '+' : ''}${money(f.netProfitPerUnit)}</span>`
  },
  {
    id: 'vs7d', label: 'Vs 7d Avg', default: true,
    help: 'Current market midpoint compared with the average midpoint recorded locally over the last 7 days. This starts as “warming up” until local history exists.',
    render: (f) => {
      if (!(f.historySamples7d > 0) || !(f.avgMid7d > 0)) return '<span class="muted">warming up</span>';
      const v = Number(f.vs7dAveragePercent) || 0;
      const cls = v < -0.5 ? 'positive' : v > 0.5 ? 'negative' : 'muted';
      return `<span class="${cls}">${v > 0 ? '+' : ''}${pct(v, 2)}</span><span class="itemMeta">${Math.round((f.historyCoverage7d || 0) * 100)}% coverage</span>`;
    }
  },
  {
    id: 'coinsHour', label: 'Estimated Coins / Hour', default: true,
    help: 'Net margin × slower-side market throughput × execution efficiency. Reliability, current book depth and competition reduce usable throughput. Reverse NPC also respects the daily NPC coin limit and visible-book slippage.',
    render: (f) => `<span class="positive">+${compact(f.estimatedCoinsPerHour)}</span>`
  },
  {
    id: 'marketSpeed', label: 'Market Speed', default: true,
    help: 'Units/hour from the slower side of Hypixel’s seven-day transacted volume. It is a market-capacity estimate, not a guarantee that a large personal order fills at that rate.',
    render: (f) => `${compact(f.flipType === 'REVERSE_NPC' ? (f.effectiveUnitsPerHour ?? f.marketSpeed) : f.marketSpeed)}<span class="itemMeta">units / h</span>`
  },
  {
    id: 'score', label: 'Score', default: true,
    help: '0–100 ranking score. High-risk and manipulation-like markets are now hard-capped, so a HIGH RISK row cannot receive an excellent score.',
    render: (f) => `<strong>${Math.round(f.opportunityScore ?? 0)}</strong>`
  },
  {
    id: 'risk', label: 'Risk', default: true,
    help: 'Low / Medium / High warning using liquidity, notional order-book depth, historical stability, spread abnormality and manipulation signals.',
    render: (f) => `<span class="pill ${(f.risk || '').toLowerCase()}">${escapeHtml(f.risk || '—')}</span>`
  },
  {
    id: 'roi', label: 'ROI', default: false,
    help: 'Net margin divided by entry price. ROI measures return on coins committed, not market speed.',
    render: (f) => pct(f.roi, 2)
  },
  {
    id: 'fillChance', label: '1-unit Fill (5m)', default: false,
    help: 'Estimated chance that one unit can complete both sides within five minutes while you keep top priority. It is intentionally not a promise that a large batch will fill.',
    render: (f) => `<span class="pill">${pct((f.fillChance ?? 0) * 100, 0)}</span>`
  },
  {
    id: 'confidence', label: 'Confidence', default: false,
    help: '0–100 evidence-quality score using seven-day turnover, coin-denominated book depth, active orders, side balance, spread behavior and local historical coverage.',
    render: (f) => `<span class="pill">${Math.round(f.confidence ?? 0)}</span>`
  },
  {
    id: 'manipulation', label: 'Manipulation', default: false,
    help: '0–100 warning score for thin books, abnormal spreads, side imbalance, low notional depth and unusual deviation from the local seven-day price distribution.',
    render: (f) => `<span class="pill">${Math.round(f.manipulationScore ?? 0)}</span>`
  },
  {
    id: 'competition', label: 'Competition', default: false,
    help: '0–100 reposting pressure based on order counts and recent observed outbid/undercut events. Learned events decay over time so old market conditions do not dominate forever.',
    render: (f) => `<span class="pill">${Math.round(f.competitionScore ?? 0)}</span>`
  },
  {
    id: 'avg7d', label: '7d Avg Price', default: false,
    help: 'Average local market midpoint over the last seven days. It is computed from the snapshots stored on your computers.',
    render: (f) => f.avgMid7d > 0 ? `${money(f.avgMid7d)}<span class="itemMeta">${f.historySamples7d || 0} samples</span>` : '—'
  },
  {
    id: 'priceStability', label: 'Price Stability', default: false,
    help: '0–100 stability. Once history exists, this is driven mainly by seven-day midpoint volatility, blended with live spread and repricing behavior.',
    render: (f) => `<span class="pill">${Math.round(f.priceStability ?? 0)}</span>`
  },
  {
    id: 'trend', label: '1h Trend', default: false,
    help: 'Current market midpoint versus the closest locally recorded midpoint around one hour ago. Falls back to the previous live snapshot before enough history exists.',
    render: (f) => {
      const trend = f.priceTrend || 'STABLE';
      const cls = trend === 'UP' ? 'trendUp' : trend === 'DOWN' ? 'trendDown' : 'trendFlat';
      const arrow = trend === 'UP' ? '↑' : trend === 'DOWN' ? '↓' : '→';
      return `<span class="${cls}">${arrow} ${trend}</span><span class="itemMeta">${pct(f.priceChangePercent || 0, 2)}</span>`;
    }
  },
  {
    id: 'trend24h', label: '24h Change', default: false,
    help: 'Current market midpoint compared with the closest locally recorded midpoint around 24 hours ago.',
    render: (f) => f.historySamples7d > 0 ? `${Number(f.priceChange24hPercent || 0) > 0 ? '+' : ''}${pct(f.priceChange24hPercent || 0, 2)}` : '—'
  },
  {
    id: 'buyVolumeDay', label: 'Instant-buy Volume / Day', default: false,
    help: 'Average units bought instantly per day from Hypixel’s last-seven-day buy moving volume.',
    render: (f) => compact(f.buyVolumePerDay)
  },
  {
    id: 'sellVolumeDay', label: 'Instant-sell Volume / Day', default: false,
    help: 'Average units sold instantly per day from Hypixel’s last-seven-day sell moving volume.',
    render: (f) => compact(f.sellVolumePerDay)
  },
  {
    id: 'orders', label: 'Orders', default: false,
    help: 'Hypixel-reported active order counts. The API names these from the instant-transaction perspective, so the labels below are translated to the in-game order types.',
    render: (f) => `${compact((f.buyOrders || 0) + (f.sellOrders || 0))}<span class="itemMeta">buy orders ${compact(f.sellOrders)} · sell offers ${compact(f.buyOrders)}</span>`
  },
  {
    id: 'buyDepth', label: 'Buy Depth', default: false,
    help: 'Units visible in the top buy-order levels returned by Hypixel. Risk/Confidence also use the coin value of this depth, not just level count.',
    render: (f) => `${compact(f.buyDepthUnits)}<span class="itemMeta">${compact(f.buyDepthNotional)} coins</span>`
  },
  {
    id: 'sellDepth', label: 'Sell Depth', default: false,
    help: 'Units visible in the top sell-offer levels returned by Hypixel, plus their approximate coin notional.',
    render: (f) => `${compact(f.sellDepthUnits)}<span class="itemMeta">${compact(f.sellDepthNotional)} coins</span>`
  },
  {
    id: 'spread', label: 'Competitive Spread', default: false,
    help: 'Sell − Buy after applying our configured +step/−step competitive prices, but before Bazaar tax. Margin is the after-tax profit.',
    render: (f) => `${money(f.grossSpread)}<span class="itemMeta">${pct(f.spreadPercent, 2)}</span>`
  },
  {
    id: 'tax', label: 'Effective Tax', default: false,
    help: 'Tax removed from the sell proceeds after combining your personal Bazaar Flipper tax setting with any detected current mayor modifier.',
    render: (f) => `${money(f.taxPerUnit)}<span class="itemMeta">${pct((f.taxRate || 0) * 100, 3)}</span>`
  },
  {
    id: 'npcLimit', label: 'NPC Daily Limit', default: false,
    help: 'Reverse NPC only: maximum units/day implied by the official 500M coins/day NPC-selling cap, plus estimated hours to reach it at current Bazaar flow.',
    render: (f) => f.flipType === 'REVERSE_NPC'
      ? `${compact(f.npcDailyUnitLimit)}<span class="itemMeta">${Number.isFinite(f.npcHoursToDailyLimit) ? `${f.npcHoursToDailyLimit.toFixed(1)}h to cap` : '—'}</span>`
      : '—'
  },
  {
    id: 'npcVwap', label: 'NPC Buy VWAP', default: false,
    help: 'Reverse NPC only: conservative average instant-buy price across the visible sell-offer levels needed for the estimated hourly volume. This captures current slippage.',
    render: (f) => f.flipType === 'REVERSE_NPC' ? money(f.npcVwapBuyPrice) : '—'
  },
  {
    id: 'lastUpdated', label: 'Last Updated', default: false,
    help: 'Timestamp of the Hypixel Bazaar snapshot used for this row.',
    render: (f) => f.marketUpdatedAt ? new Date(f.marketUpdatedAt).toLocaleTimeString() : '—'
  },
  {
    id: 'productId', label: 'Product ID', default: false,
    help: 'Hypixel’s internal Bazaar product identifier.',
    render: (f) => `<span class="muted">${escapeHtml(f.productId)}</span>`
  }
];

const defaultColumnIds = columnDefinitions.filter((c) => c.default).map((c) => c.id);
let visibleColumns = new Set(defaultColumnIds);
try {
  const stored = JSON.parse(localStorage.getItem('bz.columns') || 'null');
  if (Array.isArray(stored)) {
    const valid = stored.filter((id) => columnDefinitions.some((c) => c.id === id));
    if (valid.length) visibleColumns = new Set(valid);
  }
} catch {}
const uiSchemaVersion = '0.5';
if (localStorage.getItem('bz.uiSchemaVersion') !== uiSchemaVersion) {
  visibleColumns.add('vs7d');
  visibleColumns.add('risk');
  localStorage.setItem('bz.uiSchemaVersion', uiSchemaVersion);
  localStorage.setItem('bz.columns', JSON.stringify([...visibleColumns]));
}

function persistColumns() {
  localStorage.setItem('bz.columns', JSON.stringify([...visibleColumns]));
}

function updateMetrics() {
  if (!status) return;
  els.mProducts.textContent = status.productCount?.toLocaleString('en-US') ?? '—';
  els.mRam.textContent = `${status.processRamMB ?? '—'} MB`;
  els.mFreeRam.textContent = `${status.systemFreeRamMB ?? '—'} MB`;
  els.mFetch.textContent = status.lastFetchDurationMs == null ? '—' : `${status.lastFetchDurationMs} ms`;

  const healthy = Boolean(status.ok) && !status.lastError;
  const active = status.collectorActive !== false;
  els.statusDot.className = `dot ${active ? (healthy ? 'ok' : status.ok ? 'warn' : 'bad') : 'passive'}`;
  els.statusText.textContent = active ? (healthy ? 'Live' : status.ok ? 'Using last good snapshot' : 'Starting') : 'Passive collector';
  const updated = status.lastHypixelUpdate ? new Date(status.lastHypixelUpdate).toLocaleTimeString() : 'waiting';
  const role = status.handoff?.role || 'UNCONFIGURED';
  const mayor = status.taxContext?.mayorName && status.taxContext.mayorName !== 'Unknown' ? ` · Mayor ${status.taxContext.mayorName}` : '';
  els.statusMeta.textContent = `${role} · v${status.version || '?'} · Hypixel ${updated}${mayor}`;

  if (els.taxMeta) {
    const effective = Number(status.currentEffectiveTaxPercent);
    const reason = status.taxContext?.reason || 'No mayor modifier detected';
    els.taxMeta.textContent = Number.isFinite(effective) ? `Effective now: ${effective.toFixed(3)}% · ${reason}` : reason;
  }

  const update = status.update || {};
  if (els.updateBar && els.updateBtn && els.updateText) {
    if (update.updateAvailable) {
      els.updateBar.hidden = false;
      els.updateText.textContent = `BazaarFlipper v${update.latestVersion} is available${update.notes?.length ? ` · ${update.notes[0]}` : ''}`;
      els.updateBtn.hidden = false;
      els.updateBtn.disabled = false;
      els.updateBtn.textContent = 'Update now';
    } else if (update.error) {
      els.updateBar.hidden = false;
      els.updateText.textContent = `Update check unavailable: ${update.error}`;
      els.updateBtn.hidden = true;
    } else {
      els.updateBar.hidden = true;
    }
  }

  if (status.handoff?.configured) {
    els.handoffBtn.hidden = false;
    const pending = status.pendingSync?.snapshots || 0;
    els.handoffBtn.textContent = role === 'LAPTOP' ? `Sync now${pending ? ` (${pending})` : ''}` : 'Sync now';
    els.handoffBtn.disabled = Boolean(status.handoff?.syncRunning);
  } else {
    els.handoffBtn.hidden = true;
  }
  const root = status.projectRoot ? ` · ${status.projectRoot}` : '';
  els.updatedText.textContent = status.lastSuccessfulFetchAt
    ? `Checked ${new Date(status.lastSuccessfulFetchAt).toLocaleTimeString()}${root}`
    : 'Waiting for first fetch';
}
function specialStrategyFilter(f) {
  if (strategy === 'SAFE') return f.risk === 'LOW' && (f.fillChance ?? 0) >= 0.55 && f.confidence >= 65;
  if (strategy === 'MANIPULATION') return f.manipulationScore >= 45 || f.risk === 'HIGH' || f.spreadPercent >= 25;
  return true;
}

function activeColumns() {
  return columnDefinitions.filter((column) => visibleColumns.has(column.id));
}

function renderHeader() {
  els.headerRow.innerHTML = activeColumns().map((column) =>
    `<th data-help="${escapeHtml(column.help)}" data-column="${escapeHtml(column.id)}">${escapeHtml(column.label)}</th>`
  ).join('');
}

function render() {
  const q = val('search').trim().toLowerCase();
  const minMargin = num('minMargin');
  const minRoi = num('minRoi');
  const minVolume = num('minVolume');
  const minCoinsHour = num('minCoinsHour');
  const minFillChance = num('minFillChance') / 100;
  const riskFilter = val('risk');
  const sort = val('sort');

  let result = flips.filter((f) => {
    if (q && !`${f.itemName} ${f.productId}`.toLowerCase().includes(q)) return false;
    if (strategy !== 'ALL') {
      if (f.netProfitPerUnit < minMargin || f.roi < minRoi || f.dailyCycleVolume < minVolume) return false;
      if (Number.isFinite(f.estimatedCoinsPerHour) && f.estimatedCoinsPerHour < minCoinsHour) return false;
      if ((f.fillChance ?? 0) < minFillChance) return false;
    }
    if (riskFilter === 'LOW' && f.risk !== 'LOW') return false;
    if (riskFilter === 'MEDIUM' && f.risk === 'HIGH') return false;
    return specialStrategyFilter(f);
  });

  const sorters = {
    score: (a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0),
    coinsHour: (a, b) => (b.estimatedCoinsPerHour || 0) - (a.estimatedCoinsPerHour || 0),
    margin: (a, b) => (b.netProfitPerUnit || 0) - (a.netProfitPerUnit || 0),
    marketSpeed: (a, b) => (b.marketSpeed || 0) - (a.marketSpeed || 0),
    roi: (a, b) => (b.roi || 0) - (a.roi || 0),
    volume: (a, b) => (b.dailyCycleVolume || 0) - (a.dailyCycleVolume || 0),
    fillChance: (a, b) => (b.fillChance || 0) - (a.fillChance || 0),
    confidence: (a, b) => (b.confidence || 0) - (a.confidence || 0),
    competition: (a, b) => (b.competitionScore || 0) - (a.competitionScore || 0),
    manipulation: (a, b) => (b.manipulationScore || 0) - (a.manipulationScore || 0),
    vs7d: (a, b) => (a.vs7dAveragePercent || 0) - (b.vs7dAveragePercent || 0),
    stability: (a, b) => (b.priceStability || 0) - (a.priceStability || 0)
  };
  result.sort(sorters[sort] || sorters.score);
  result = result.slice(0, 600);

  const columns = activeColumns();
  els.resultCount.textContent = `${result.length.toLocaleString('en-US')} opportunities`;
  renderHeader();

  if (!result.length) {
    els.rows.innerHTML = `<tr><td colspan="${Math.max(1, columns.length)}" class="muted" style="text-align:center;padding:32px">No opportunities match the current filters.</td></tr>`;
    return;
  }

  els.rows.innerHTML = result.map((f) =>
    `<tr>${columns.map((column) => `<td>${column.render(f)}</td>`).join('')}</tr>`
  ).join('');
}

function applyStrategy(next, { loadAfter = true } = {}) {
  strategy = next;
  localStorage.setItem('bz.strategy', strategy);
  document.querySelectorAll('.strategy').forEach((button) => button.classList.toggle('active', button.dataset.strategy === strategy));

  if (strategy === 'FAST') {
    els.sort.value = 'coinsHour';
    els.risk.value = 'ALL';
  } else if (strategy === 'MARGIN') {
    els.sort.value = 'margin';
    els.risk.value = 'ALL';
  } else if (strategy === 'VOLUME') {
    els.sort.value = 'marketSpeed';
    els.risk.value = 'ALL';
  } else if (strategy === 'SAFE') {
    els.sort.value = 'coinsHour';
    els.risk.value = 'LOW';
  } else if (strategy === 'MANIPULATION') {
    els.sort.value = 'manipulation';
    els.risk.value = 'ALL';
  } else if (strategy === 'REVERSE_NPC') {
    els.sort.value = 'coinsHour';
    els.risk.value = 'ALL';
  } else {
    els.sort.value = 'score';
    if (strategy === 'BALANCED') els.risk.value = 'MEDIUM';
    else if (strategy !== 'ALL') els.risk.value = 'ALL';
  }

  for (const id of persistedIds) if (els[id]) localStorage.setItem(`bz.${id}`, els[id].value);
  if (loadAfter) load();
}

let lastFlipsRequest = 0;
async function load() {
  const requestNumber = ++lastFlipsRequest;
  try {
    const mode = strategy === 'REVERSE_NPC' ? 'REVERSE_NPC' : 'ORDER';
    const params = new URLSearchParams({ tax: val('tax'), mode });
    const res = await fetch(`/api/flips?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Late responses from old tax/mode selections must not replace the newer view.
    if(requestNumber !== lastFlipsRequest)return;
    flips = data.flips || [];
    status = data.status || null;
    if (status) status.currentEffectiveTaxPercent = data.effectiveTaxPercent;
    updateMetrics();
    render();
  } catch (error) {
    if(requestNumber !== lastFlipsRequest)return;
    els.statusDot.className = 'dot bad';
    els.statusText.textContent = 'Connection error';
    els.statusMeta.textContent = error.message;
  }
}

function renderColumnPicker() {
  els.columnChecks.innerHTML = columnDefinitions.map((column) => `
    <label class="columnCheck">
      <input type="checkbox" data-column-toggle="${escapeHtml(column.id)}" ${visibleColumns.has(column.id) ? 'checked' : ''} />
      <span>${escapeHtml(column.label)}</span>
    </label>
  `).join('');
}

function setColumns(ids) {
  visibleColumns = new Set(ids);
  persistColumns();
  renderColumnPicker();
  render();
}

function toggleAdvanced(force) {
  const shouldOpen = typeof force === 'boolean' ? force : els.advancedFilters.hidden;
  els.advancedFilters.hidden = !shouldOpen;
  els.advancedBtn.setAttribute('aria-expanded', String(shouldOpen));
  els.advancedBtn.textContent = shouldOpen ? 'Hide advanced' : 'Advanced filters';
  localStorage.setItem('bz.advancedOpen', shouldOpen ? '1' : '0');
}

function toggleColumnMenu(force) {
  const shouldOpen = typeof force === 'boolean' ? force : els.columnMenu.hidden;
  els.columnMenu.hidden = !shouldOpen;
  els.columnsBtn.setAttribute('aria-expanded', String(shouldOpen));
}

for (const id of ['search', 'minMargin', 'minRoi', 'minVolume', 'minCoinsHour', 'minFillChance', 'risk', 'sort']) {
  els[id].addEventListener('input', () => { localStorage.setItem(`bz.${id}`, els[id].value); render(); });
  els[id].addEventListener('change', () => { localStorage.setItem(`bz.${id}`, els[id].value); render(); });
}
els.tax.addEventListener('change', () => { localStorage.setItem('bz.tax', els.tax.value); load(); });

els.strategyButtons.addEventListener('click', (event) => {
  const button = event.target.closest('[data-strategy]');
  if (button) applyStrategy(button.dataset.strategy);
});
els.refreshBtn.addEventListener('click', load);
els.handoffBtn.addEventListener('click', syncNow);
if (els.checkUpdateBtn) els.checkUpdateBtn.addEventListener('click', checkUpdatesNow);
async function syncNow() {
  const previousText = els.handoffBtn.textContent;
  els.handoffBtn.disabled = true;
  els.handoffBtn.textContent = 'Syncing…';
  try {
    const res = await fetch('/api/handoff/sync', { method: 'POST', cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    await load();
    const ack = body.acknowledgedSnapshots ?? body.sentSnapshots ?? 0;
    window.alert(`Sync complete. ${ack} snapshot${ack === 1 ? '' : 's'} acknowledged. Synced laptop data was deleted locally after desktop confirmation.`);
  } catch (error) {
    window.alert(`Sync failed: ${error.message}\n\nUnacknowledged laptop data was kept.`);
    await load();
  } finally {
    els.handoffBtn.disabled = false;
    if (els.handoffBtn.textContent === 'Syncing…') els.handoffBtn.textContent = previousText;
  }
}

async function checkUpdatesNow() {
  if (!els.checkUpdateBtn) return;
  const old = els.checkUpdateBtn.textContent;
  els.checkUpdateBtn.disabled = true;
  els.checkUpdateBtn.textContent = 'Checking…';
  try {
    const res = await fetch('/api/update/check', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    await load();
    els.checkUpdateBtn.textContent = body.updateAvailable ? 'Update available' : 'Up to date ✓';
    setTimeout(() => { if (els.checkUpdateBtn) els.checkUpdateBtn.textContent = 'Check for updates'; }, 2500);
  } catch (error) {
    window.alert(`Update check failed: ${error.message}`);
    els.checkUpdateBtn.textContent = old;
  } finally { els.checkUpdateBtn.disabled = false; }
}

async function applyUpdate() {
  if (!window.confirm('Install the available BazaarFlipper update now? The local server will restart automatically. Your database, handoff pairing and logs are preserved.')) return;
  els.updateBtn.disabled = true;
  els.updateBtn.textContent = 'Preparing update…';
  try {
    const res = await fetch('/api/update/apply', { method: 'POST', cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    els.updateText.textContent = `Installing v${body.version}… the local server is restarting.`;
    els.updateBtn.hidden = true;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const health = await fetch('/api/status', { cache: 'no-store' });
        if (health.ok) {
          const next = await health.json();
          if (next.version === body.version) {
            window.location.reload();
            return;
          }
        }
      } catch {}
    }
    throw new Error('The server did not return within 60 seconds. The updater will roll back automatically if the new version cannot start.');
  } catch (error) {
    window.alert(`Update failed: ${error.message}`);
    els.updateBtn.disabled = false;
    els.updateBtn.hidden = false;
    els.updateBtn.textContent = 'Update now';
  }
}

if (els.updateBtn) els.updateBtn.addEventListener('click', applyUpdate);

els.advancedBtn.addEventListener('click', () => toggleAdvanced());
els.columnsBtn.addEventListener('click', (event) => { event.stopPropagation(); toggleColumnMenu(); });
els.columnMenu.addEventListener('click', (event) => event.stopPropagation());
els.columnChecks.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-column-toggle]');
  if (!checkbox) return;
  if (checkbox.checked) visibleColumns.add(checkbox.dataset.columnToggle);
  else visibleColumns.delete(checkbox.dataset.columnToggle);
  if (!visibleColumns.size) visibleColumns.add('item');
  persistColumns();
  renderColumnPicker();
  render();
});
els.defaultColumnsBtn.addEventListener('click', () => setColumns(defaultColumnIds));
els.allColumnsBtn.addEventListener('click', () => setColumns(columnDefinitions.map((c) => c.id)));
document.addEventListener('click', () => toggleColumnMenu(false));

function showHeaderTooltip(target) {
  const text = target?.dataset?.help;
  if (!text) return;
  els.hoverTooltip.textContent = text;
  els.hoverTooltip.hidden = false;
  const rect = target.getBoundingClientRect();
  const tipRect = els.hoverTooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(10, Math.min(window.innerWidth - tipRect.width - 10, left));
  let top = rect.bottom + 8;
  if (top + tipRect.height > window.innerHeight - 10) top = Math.max(10, rect.top - tipRect.height - 8);
  els.hoverTooltip.style.left = `${left}px`;
  els.hoverTooltip.style.top = `${top}px`;
}

document.addEventListener('mouseover', (event) => {
  const target = event.target.closest('th[data-help]');
  if (target) showHeaderTooltip(target);
});
document.addEventListener('mouseout', (event) => {
  const target = event.target.closest('th[data-help]');
  if (target) els.hoverTooltip.hidden = true;
});
window.addEventListener('scroll', () => { els.hoverTooltip.hidden = true; }, true);

renderColumnPicker();
toggleAdvanced(localStorage.getItem('bz.advancedOpen') === '1');
applyStrategy(strategy, { loadAfter: false });
load();
setInterval(load, 15_000);
