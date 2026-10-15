import {analyseProduct,analyseReverseNpc} from '../candidate-src/src/scoring.mjs';
import {calculateMinionRankings} from '../candidate-src/src/minions.mjs';
import {fetchBazaar,fetchItemMetadata,fetchBazaarTaxContext} from '../candidate-src/src/hypixel.mjs';

const results={},started=Date.now();
let marketPayload=null,itemMetadata=null;
for(const [name,fn] of [['bazaar',fetchBazaar],['items',fetchItemMetadata],['election',fetchBazaarTaxContext]]){
  const t=Date.now();
  try{
    const output=await fn(18000);
    const outcome={status:'PASS',elapsedMs:Date.now()-t};
    if(name==='bazaar'){
      marketPayload=output;
      outcome.productCount=Object.keys(output.products||{}).length;
      outcome.dataTimestamp=Number(output.lastUpdated)||null;
      const rows=Object.values(output.products||{});
      outcome.twoSided=rows.filter(x=>x?.buy_summary?.length&&x?.sell_summary?.length).length;
      outcome.badTopPrices=rows.filter(x=>{
        if(!x?.buy_summary?.length||!x?.sell_summary?.length)return false;
        const ask=Number(x.buy_summary[0].pricePerUnit);
        const bid=Number(x.sell_summary[0].pricePerUnit);
        return !Number.isFinite(ask)||!Number.isFinite(bid)||ask<=0||bid<=0;
      }).length;
      if(outcome.productCount<100||outcome.twoSided<100||outcome.badTopPrices>0)
        throw Error('Market contract problem: '+JSON.stringify(outcome));
      const age=Date.now()-outcome.dataTimestamp;
      if(outcome.dataTimestamp&&age>20*60*1000)throw Error('Bazaar timestamp >20 minutes old');
    }
    if(name==='items'){
      itemMetadata=output.map;
      outcome.itemCount=output.map.size;
      if(outcome.itemCount<100)throw Error('Unusually small items list');
    }
    if(name==='election')outcome.mayor=output.mayorName;
    results[name]=outcome;
  }catch(error){
    results[name]={status:'FAIL',elapsedMs:Date.now()-t,error:error instanceof Error?error.message:String(error)};
  }
}
if(marketPayload?.products&&itemMetadata){
  const market=marketPayload.products;
  const ignored={invalidBook:0,noMargin:0,scored:0,reversedNpc:0};
  const weird=[];
  for(const [id,p] of Object.entries(market)){
    const itemMeta=itemMetadata.get(id)||{};
    const candidate=analyseProduct(p,itemMeta,{taxRate:0.0125});
    if(!candidate){ignored.noMargin++;continue;}
    ignored.scored++;
    for(const key of ['bestBuyOrder','bestSellOffer','netProfitPerUnit','roi',
      'estimatedCoinsPerHour','opportunityScore','confidence','manipulationScore','marketSpeed']){
      if(!Number.isFinite(candidate[key]))weird.push(id+':'+key);
    }
    if(candidate.bestBuyOrder>candidate.bestSellOffer)ignored.invalidBook++;
    if(candidate.opportunityScore<0||candidate.opportunityScore>100||
       candidate.confidence<0||candidate.confidence>100)
      weird.push(id+':bounded-metric');
    const rev=analyseReverseNpc(p,itemMeta);
    if(rev)ignored.reversedNpc++;
  }
  const ranking=calculateMinionRankings(
    {tier:11,count:1,fuel:'NONE',shipping:'NONE',sellMethod:'BEST',optimizeFor:'NET'},
    {market,historyStats:new Map(),itemMeta:itemMetadata,taxRate:0.0125,
      marketUpdatedAt:marketPayload.lastUpdated});
  const supported=ranking.rows.filter(x=>x.supported);
  const missingIds=new Set(supported.filter(x=>!x.setupComplete).flatMap(x=>x.setupMissing||[]));
  results.neuIdProbe=[...missingIds].filter(x=>/-\\d+$/.test(x)).map(id=>{
    const hyPixelId=id.replace(/-(\\d+)$/,':$1');
    return {neuId:id,hypixelId:hyPixelId,available:!!market[hyPixelId]};
  });
  results.economicAudit={status:weird.length||ignored.scored<100?'FAIL':'PASS',
    ...ignored,nonFiniteOrInvalid:weird.slice(0,15),
    minionsTotal:ranking.rows.length,minionsSupported:supported.length,
    incompleteSetup:supported.filter(x=>!x.setupComplete).length,
    incompleteSetupDetails:supported.filter(x=>!x.setupComplete).map(x=>({minion:x.name,source:x.recipeSource,missing:x.setupMissing})),
    incompleteRecurringEconomics:supported.filter(x=>x.economicsComplete===false).length,
    ranked:supported.filter(x=>Number.isInteger(x.sortRank)).length};
}
console.log(JSON.stringify({at:new Date().toISOString(),source:'GitHub hosted runner, not the user LAN',
  elapsedMs:Date.now()-started,results},null,2));
if(Object.values(results).some(x=>x.status==='FAIL'))process.exitCode=1;
