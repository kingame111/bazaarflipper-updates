import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync('./server.mjs','utf8');
const start=source.indexOf('function historyRowsFromProducts(products)');
const end=source.indexOf('function effectiveTaxRate(baseRate)',start);
assert(start>=0 && end>start,'historyRowsFromProducts not found');
const fnSource=source.slice(start,end);
const historyRowsFromProducts=Function(`${fnSource}; return historyRowsFromProducts;`)();

const products={
  A:{
    product_id:'A',
    buy_summary:[
      {pricePerUnit:100,amount:10},
      {pricePerUnit:99.5,amount:20},
      {pricePerUnit:94,amount:30}
    ],
    sell_summary:[
      {pricePerUnit:110,amount:15},
      {pricePerUnit:110.5,amount:25},
      {pricePerUnit:116,amount:30}
    ],
    quick_status:{
      productId:'A',buyPrice:101,sellPrice:109,
      sellMovingWeek:1000,buyMovingWeek:900,
      sellVolume:500,buyVolume:450,sellOrders:20,buyOrders:19
    }
  },
  B:{
    product_id:'B',
    buy_summary:[],
    sell_summary:[],
    quick_status:{
      productId:'B',buyPrice:50,sellPrice:60,
      sellMovingWeek:20,buyMovingWeek:21,
      sellVolume:22,buyVolume:23,sellOrders:2,buyOrders:3
    }
  }
};
const rows=historyRowsFromProducts(products);
assert.equal(rows.length,2,'every Bazaar product must be retained');
const a=rows.find(x=>x.productId==='A');
assert.equal(a.bestBuyOrder,100);
assert.equal(a.bestSellOffer,110);
assert.equal(a.weightedBuyPrice,101);
assert.equal(a.weightedSellPrice,109);
assert.equal(a.bestBuyAmount,10);
assert.equal(a.bestSellAmount,15);
assert.equal(a.buyDepth1Pct,30);
assert.equal(a.sellDepth1Pct,40);
assert.equal(a.buyDepth5Pct,30);
assert.equal(a.sellDepth5Pct,40);
const b=rows.find(x=>x.productId==='B');
assert.equal(b.bestBuyOrder,50,'quick_status fallback must work');
assert.equal(b.bestSellOffer,60,'quick_status fallback must work');
assert.equal(b.buyDepth1Pct,0);
assert.equal(b.sellDepth5Pct,0);


const resilientStart=source.indexOf('function isTransientBazaarFetchError(error)');
const resilientEnd=source.indexOf('async function pollBazaar()',resilientStart);
assert(resilientStart>=0 && resilientEnd>resilientStart,'Bazaar retry helper not found');
const retrySource=source.slice(resilientStart,resilientEnd);
const retryApi=Function(`${retrySource}; return {isTransientBazaarFetchError,fetchBazaarResilient};`)();
assert.equal(retryApi.isTransientBazaarFetchError(Object.assign(new Error('This operation was aborted'),{name:'AbortError'})),true);
assert.equal(retryApi.isTransientBazaarFetchError(new Error('HTTP 403')),false);
let attempts=0, seenTimeout=0;
const retryResult=await retryApi.fetchBazaarResilient(12000,async(timeout)=>{
  attempts+=1; seenTimeout=timeout;
  if(attempts<3){const e=new Error('This operation was aborted');e.name='AbortError';throw e;}
  return {ok:true};
},async()=>{});
assert.deepEqual(retryResult,{ok:true});
assert.equal(attempts,3);
assert.equal(seenTimeout,20000);
let hardAttempts=0;
await assert.rejects(
  retryApi.fetchBazaarResilient(12000,async()=>{hardAttempts+=1;throw new Error('HTTP 403');},async()=>{}),
  /HTTP 403/
);
assert.equal(hardAttempts,1);

assert(!source.includes('insertHistorySnapshot(db, ts, flips'),'history must not depend on filtered flips');
assert(source.includes('historyRowsFromProducts(data.products)'));
assert(source.includes('sourceTs = Number(data.lastUpdated) || now'));
assert(source.includes('syncBatchSnapshots)||12'));
assert(source.includes('const maxBatches=manual?500:8'));
assert(source.includes('/handoff/sync/push?wait='));
assert(source.includes('readJsonBody(req,64*1024*1024)'));
assert(source.includes("const instanceLockPath=path.join(dataDir,'server-instance.lock')"));
assert(source.includes('collectorActive=false'));
assert(source.includes("['SIGINT','SIGTERM','SIGBREAK','SIGHUP']"));
assert(source.includes('clearTimeout(timer);clearInterval(timer)'));
assert(source.includes('server.closeAllConnections?.()'));
assert(source.includes('handoffServer.closeAllConnections?.()'));
assert(source.includes('checkpointDatabase(db)'));
assert(source.includes('db.close()'));
assert(source.includes('releaseInstanceLock()'));
assert(source.includes('BazaarFlipper stopped safely'));

console.log('v0.5.9 server behavior tests: PASS');
