import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {calculateMinionRankings} from '../candidate-src/src/minions.mjs';

const options={tier:12,count:1,priceMode:'LIVE',fuel:'NONE',shipping:'NONE',optimizeFor:'NET'};
const context={market:{},historyStats:new Map(),itemMeta:new Map(),taxRate:0.0125,marketUpdatedAt:Date.now()};
const direct=calculateMinionRankings(options,context);
assert.ok(direct.rows.length>=60);
for(const row of direct.rows){
  if(!row.supported)continue;
  if(!row.setupComplete){
    assert.equal(row.setupPerMinion,null,row.name+' should not show partial setup costs');
    assert.equal(row.paybackDays,null,row.name+' payback must be unavailable');
    assert.equal(row.confidence,'LOW',row.name+' setup incomplete must be LOW confidence');
  }
  if(!row.economicsComplete){
    assert.equal(row.sortRank,undefined,row.name+' must not have a verified profit rank');
    assert.equal(row.confidence,'LOW',row.name+' incomplete economics must be LOW confidence');
  }
}
const workerOutput=await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('../candidate-src/src/minion-worker.mjs',import.meta.url),{
    workerData:{options,context:{
      market:context.market,
      historyStatsEntries:[],itemMetaEntries:[],
      taxRate:context.taxRate,marketUpdatedAt:context.marketUpdatedAt
    }}
  });
  worker.once('message',m=>m?.ok?resolve(m.result):reject(Error(m?.error||'Invalid worker result')));
  worker.once('error',reject);
  worker.once('exit',code=>{if(code!==0)reject(Error('Worker exit: '+code));});
});
assert.equal(workerOutput.rows.length,direct.rows.length);
const fields=x=>x.rows.map(r=>({name:r.name,setupComplete:r.setupComplete,economicsComplete:r.economicsComplete,
  setupPerMinion:r.setupPerMinion,netDay:r.netDay,sortRank:r.sortRank,confidence:r.confidence}));
assert.deepEqual(fields(workerOutput),fields(direct));
const exactMarket={
  COBBLESTONE:{sell_summary:[{pricePerUnit:100,amount:1000}],
    buy_summary:[{pricePerUnit:120,amount:1000}],
    quick_status:{sellPrice:100,buyPrice:120}}
};
const stableContext={...context,market:exactMarket};
const allRows=calculateMinionRankings({...options,search:''},stableContext);
const filteredRows=calculateMinionRankings({...options,search:'Ghast'},stableContext);
const expected=allRows.rows.filter(x=>x.name.toLowerCase().includes('ghast'));
assert.ok(expected.length>=1,'Need a filtered Ghast minion case');
assert.deepEqual(filteredRows.rows.map(x=>({name:x.name,rank:x.sortRank})),
  expected.map(x=>({name:x.name,rank:x.sortRank})),
  'Searching with unchanged prices must preserve the original global rank');
console.log(JSON.stringify({pass:true,rows:direct.rows.length,workerMatchesDirect:true,
  incompleteSetupHandled:true,unpricedRanksWithheld:true}));
