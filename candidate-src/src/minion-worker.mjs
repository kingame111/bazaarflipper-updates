import {parentPort,workerData} from 'node:worker_threads';
import {calculateMinionRankings} from './minions.mjs';

try{
  const context=workerData.context||{};
  context.historyStats=new Map(context.historyStatsEntries||[]);
  context.itemMeta=new Map(context.itemMetaEntries||[]);
  delete context.historyStatsEntries;
  delete context.itemMetaEntries;
  parentPort.postMessage({ok:true,result:calculateMinionRankings(workerData.options||{},context)});
}catch(error){
  parentPort.postMessage({ok:false,error:error?.stack||error?.message||String(error)});
}
