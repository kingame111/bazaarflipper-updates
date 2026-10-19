import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';
import {analyseProduct,withTax,analyseReverseNpc} from '../candidate-src/src/scoring.mjs';
import {fetchBazaar,fetchItemMetadata,fetchBazaarTaxContext,deriveBazaarTaxContext} from '../candidate-src/src/hypixel.mjs';

const row={
  product_id:'COBBLESTONE',
  sell_summary:[{pricePerUnit:100,amount:1000,orders:10}],
  buy_summary:[{pricePerUnit:120,amount:1000,orders:10}],
  quick_status:{sellPrice:98,buyPrice:122,sellMovingWeek:70000,
    buyMovingWeek:70000,sellVolume:1000,buyVolume:1000,sellOrders:50,buyOrders:50}
};
const db={COBBLESTONE:row};
const ctx={market:db,historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125,
  priceMode:'LIVE',sellMethod:'INSTANT',historyDays:7};
const minion=MINION_DATA.definitions['Cobblestone Minion'];
assert.ok(minion);
const opts={tier:1,count:1,fuel:'NONE',shipping:'NONE',
  collectionIntervalDays:1,upgrade1:'NONE',upgrade2:'NONE'};
const instant=calculateMinion(minion,opts,ctx);
const quoted=instant.outputDetails.find(x=>x.item==='COBBLESTONE');
assert.equal(quoted.quote.raw,100,'Instant selling must use the best BUY order');
assert.equal(quoted.quote.method,'INSTANT');
const ingredients=instant.setupBreakdown.find(x=>x.item==='COBBLESTONE');
assert.equal(ingredients.unitPrice,120,'Buying minion ingredients must use cheapest SELL offer');
assert.equal(instant.setupComplete,true);
assert.ok(Math.abs(instant.netPerMinionDay -
  (quoted.unitsPerDay*100*(1-.0125))) <1e-6);
const sellOrder=calculateMinion(minion,opts,{...ctx,sellMethod:'ORDER'});
assert.equal(sellOrder.outputDetails[0].quote.raw,120,
  'Sell orders should use the cheapest current competing sell offer');
assert.equal(sellOrder.setupBreakdown[0].unitPrice,120);
const npc=calculateMinion(minion,opts,{...ctx,sellMethod:'NPC'});
assert.equal(npc.outputDetails[0].quote.method,'NPC');
assert.equal(npc.outputDetails[0].quote.raw,1);
const fallback=structuredClone(row);
fallback.buy_summary=[];fallback.sell_summary=[];
assert.equal(calculateMinion(minion,opts,{...ctx,market:{COBBLESTONE:fallback}}).outputDetails[0].quote.raw,98,
  'Instant sell fallback must use quick_status.sellPrice');

const calculated=analyseProduct(row,{name:'Cobblestone',npcSellPrice:1},{taxRate:0.0125});
assert.equal(calculated.bestBuyOrder,100);
assert.equal(calculated.bestSellOffer,120);
assert.equal(calculated.entryPrice,100.1);
assert.equal(calculated.exitPrice,119.9);
assert.ok(Math.abs(calculated.netProfitPerUnit-(119.9*(1-.0125)-100.1))<1e-7);
const withModifiedTax=withTax(calculated,0.05);
assert.ok(Math.abs(withModifiedTax.netProfitPerUnit-(119.9*.95-100.1))<1e-7);
assert.equal(calculated.taxRate,0.0125,'withTax cannot mutate original result');
const reverse=analyseReverseNpc(row,{npcSellPrice:150});
assert.ok(reverse,'NPC reverse flip should be available if properly priced');

const redSand=MINION_DATA.definitions['Red Sand Minion'];
const legacyMarket={'SAND:1':{buy_summary:[{pricePerUnit:21,amount:1000}],
    sell_summary:[{pricePerUnit:19,amount:1000}],quick_status:{buyPrice:21,sellPrice:19}}};
const normalizedCost=calculateMinion(redSand,{...opts,tier:1},
  {...ctx,market:legacyMarket,sellMethod:'NPC'});
assert.equal(normalizedCost.setupComplete,true,
  'Legacy NEU SAND-1 must use verified Hypixel Bazaar SAND:1 price');
assert.equal(normalizedCost.setupCost,80*21);
const birch=MINION_DATA.definitions['Birch Minion'];
const historicalAlias=calculateMinion(birch,{...opts,tier:1},{
  ...ctx,market:{},
  historyStats:new Map([['LOG:2',{samples7d:500,avgBuy7d:6,avgSell7d:7,coverage7d:0.7}]]),
  priceMode:'7D',sellMethod:'INSTANT'});
assert.equal(historicalAlias.outputDetails[0].quote.raw,6,
  'Legacy log ID must match normalized time-series data');

const fetchSaved=globalThis.fetch;
const seen=[];
let status=200,payload=null;
globalThis.fetch=async (url)=>{
  seen.push(String(url));
  if(status!==200)return new Response('temporary outage',{status});
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
};
try{
  payload={success:true,products:{COBBLESTONE:row},lastUpdated:Date.now()};
  assert.equal((await fetchBazaar()).products.COBBLESTONE.product_id,'COBBLESTONE');
  assert.match(seen.at(-1),/\/v2\/skyblock\/bazaar$/);
  payload={success:true,items:[{id:'COBBLESTONE',name:'Cobblestone',npc_sell_price:1}]};
  const metadata=await fetchItemMetadata();
  assert.equal(metadata.map.get('COBBLESTONE').npcSellPrice,1);
  assert.match(seen.at(-1),/\/v2\/resources\/skyblock\/items$/);
  payload={success:true,lastUpdated:123,mayor:{name:'Aatrox',perks:[]}};
  const mayor=await fetchBazaarTaxContext();
  assert.equal(mayor.multiplier,1);
  assert.equal(mayor.flatAddRate,0);
  assert.match(seen.at(-1),/\/v2\/resources\/skyblock\/election$/);
  assert.equal(deriveBazaarTaxContext({mayor:{name:'Derpy'}}).multiplier,4);
  status=504;
  await assert.rejects(fetchBazaar(),/HTTP 504/);
  status=200;payload={success:false,products:null};
  await assert.rejects(fetchBazaar(),/invalid Bazaar payload/);
  payload={success:true,products:{}};
  await assert.rejects(fetchBazaar(),/invalid Bazaar payload/);
  payload={success:true,products:{COBBLESTONE:null}};
  await assert.rejects(fetchBazaar(),/invalid Bazaar payload/);
  payload={success:true,products:{COBBLESTONE:{...row,
    sell_summary:[{pricePerUnit:-2,amount:1000}]}}};
  await assert.rejects(fetchBazaar(),/invalid Bazaar payload/);
  payload={success:true,products:{COBBLESTONE:{...row,buy_summary:[]}}};
  assert.equal((await fetchBazaar()).products.COBBLESTONE.product_id,'COBBLESTONE');
  payload={success:true,items:{}};
  await assert.rejects(fetchItemMetadata(),/invalid item metadata/);
  payload={success:false};
  await assert.rejects(fetchBazaarTaxContext(),/invalid mayor/);
}finally{globalThis.fetch=fetchSaved;}
console.log(JSON.stringify({PASS:true,scoringSpreadVerified:true,instantSaleCorrect:true,
  craftingBuyCorrect:true,orderSaleCorrect:true,priceFallbackCorrect:true,
  taxRecalculationCorrect:true,endpointsVerified:3,apiErrorsHandled:true}));
