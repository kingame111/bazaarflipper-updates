const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const ITEMS_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';
const ELECTION_URL = 'https://api.hypixel.net/v2/resources/skyblock/election';

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'BazaarFlipper-Local/0.5' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from Hypixel`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBazaar(timeoutMs = 12_000) {
  const data = await fetchJson(BAZAAR_URL, timeoutMs);
  if (!data?.success || !data?.products) throw new Error('Hypixel returned an invalid Bazaar payload');
  return data;
}

export async function fetchItemMetadata(timeoutMs = 12_000) {
  const data = await fetchJson(ITEMS_URL, timeoutMs);
  if (!data?.success || !Array.isArray(data?.items)) throw new Error('Hypixel returned invalid item metadata');
  const map = new Map();
  for (const item of data.items) {
    if (item?.id) {
      map.set(item.id, {
        name: item.name ?? item.id,
        category: item.category ?? null,
        tier: item.tier ?? null,
        npcSellPrice: Number.isFinite(Number(item.npc_sell_price)) ? Number(item.npc_sell_price) : 0
      });
    }
  }
  return { map, lastUpdated: data.lastUpdated ?? null };
}

function stripFormatting(value) {
  return String(value ?? '').replace(/§[0-9A-FK-OR]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function collectPerkText(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const value of node) collectPerkText(value, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (typeof node.name === 'string' || typeof node.description === 'string') {
    out.push(`${stripFormatting(node.name)} ${stripFormatting(node.description)}`.trim());
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectPerkText(value, out);
  }
  return out;
}

export function deriveBazaarTaxContext(data) {
  const mayorName = stripFormatting(data?.mayor?.name || data?.mayor?.key || 'Unknown');
  const perkTexts = collectPerkText(data?.mayor?.perks ?? data?.mayor ?? []);
  const allText = perkTexts.join(' | ');
  let multiplier = 1;
  let flatAddRate = 0;
  const reasons = [];

  // Current special-mayor behavior: Derpy's QUAD TAXES multiplies Bazaar tax.
  if (/quad\s+tax|4\s*x[^|]{0,80}tax|pay\s+4\s*x[^|]{0,80}tax/i.test(allText) || /^derpy$/i.test(mayorName)) {
    multiplier = Math.max(multiplier, 4);
    reasons.push('Derpy: 4× taxes');
  }

  // Aura raises Bazaar tax by one percentage point. Keep this named fallback because
  // the public election payload may phrase the perk differently between releases.
  if (/^aura$/i.test(mayorName)) {
    flatAddRate = Math.max(flatAddRate, 0.01);
    reasons.push('Aura: +1.00 percentage point Bazaar tax');
  }

  // Generic parser for future mayor/perk descriptions such as
  // "Bazaar tax is increased by 1%" or "+0.5% Bazaar tax".
  for (const text of perkTexts) {
    if (!/bazaar/i.test(text) || !/tax/i.test(text)) continue;
    const byMatch = text.match(/(?:increase(?:d)?\s+by|\+)\s*(\d+(?:\.\d+)?)\s*%/i);
    if (byMatch) {
      const rate = Number(byMatch[1]) / 100;
      if (Number.isFinite(rate) && rate > flatAddRate) {
        flatAddRate = rate;
        reasons.push(`Mayor perk: +${byMatch[1]} percentage point(s) Bazaar tax`);
      }
    }
    const multiMatch = text.match(/(\d+(?:\.\d+)?)\s*x[^|]{0,80}tax/i);
    if (multiMatch) {
      const factor = Number(multiMatch[1]);
      if (Number.isFinite(factor) && factor > multiplier) {
        multiplier = factor;
        reasons.push(`Mayor perk: ${factor}× tax`);
      }
    }
  }

  return {
    mayorName,
    multiplier,
    flatAddRate,
    reason: reasons.length ? [...new Set(reasons)].join(' · ') : 'No Bazaar tax modifier detected',
    sourceLastUpdated: Number(data?.lastUpdated) || null
  };
}

export async function fetchBazaarTaxContext(timeoutMs = 12_000) {
  const data = await fetchJson(ELECTION_URL, timeoutMs);
  if (!data?.success) throw new Error('Hypixel returned invalid mayor/election data');
  return deriveBazaarTaxContext(data);
}
