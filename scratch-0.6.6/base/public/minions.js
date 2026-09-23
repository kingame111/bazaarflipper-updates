const $=(id)=>document.getElementById(id);
const fmtCoins=(n)=>Number.isFinite(Number(n))?new Intl.NumberFormat('en-US',{maximumFractionDigits:Math.abs(n)<100?2:0}).format(Number(n)):'—';
const fmtPct=(n)=>Number.isFinite(Number(n))?`${Number(n).toFixed(1)}%`:'—';
const fmtDays=(n)=>Number.isFinite(Number(n))?`${Number(n)<1?(Number(n)*24).toFixed(1)+'h':Number(n).toFixed(1)+'d'}`:'—';
const fmtSpan=(ms)=>{const x=Math.max(0,Number(ms)||0),h=x/3600000;return h<1?`${Math.round(x/60000)}m`:h<48?`${h.toFixed(h<10?1:0)}h`:`${(h/24).toFixed(1)}d`;};
const fmtAgo=(ts)=>{const age=Math.max(0,Date.now()-Number(ts||0));return !ts?'—':age<60000?`${Math.max(1,Math.round(age/1000))}s ago`:age<3600000?`${Math.round(age/60000)}m ago`:`${(age/3600000).toFixed(1)}h ago`;};
const upgradeNames=(r)=>{const names=(r.upgrades||[]).map(x=>x.name);while(names.length<2)names.push('Empty');return names.slice(0,2);};
const controls=['tier','count','fuel','sellMethod','priceMode','compareDays','collectionIntervalDays','family','search','sort','tax','beacon','crystal','otherSpeed'];
let catalog=null,lastData=null,timer=null;
const COLUMN_KEY='bazaarflipper.minions.columns.v1',VIEW_KEY='bazaarflipper.minions.views.v1',COMPARE_KEY='bazaarflipper.minions.compareDays.v1';
const columnNames=['#','Minion','Best upgrades','Tier','Net / day','LIVE comparison','Data coverage','Gross / day','Recurring / day','Setup (one-time)','Payback','30d ROI','Speed'];
let visibleColumns=JSON.parse(localStorage.getItem(COLUMN_KEY)||'null')||columnNames.map(()=>true);

function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o)}
function populateCatalog(c){
  catalog=c;
  if(!$('tier').options.length) for(let i=1;i<=12;i++) option($('tier'),i,`Tier ${i}`);
  $('tier').value=String(c.defaults?.tier||11);
  for(const f of c.fuels||[]) option($('fuel'),f.id,f.name);
  $('fuel').value=c.defaults?.fuel||'ENCHANTED_LAVA_BUCKET';
  const families=[...new Set((c.minions||[]).map(x=>x.family).filter(Boolean))].sort();
  for(const f of families) option($('family'),f,f);
}
function params(){
  const p=new URLSearchParams();
  for(const id of controls){
    const map={beacon:'beacon',crystal:'crystal',otherSpeed:'otherSpeed'};p.set(map[id]||id,$(id).value);
  }
  return p;
}
async function load(){
  $('refreshBtn').disabled=true;
  try{
    const res=await fetch('/api/minions?'+params().toString(),{cache:'no-store'});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    if(!catalog) populateCatalog(data.catalog);
    lastData=data;render(data);
  }catch(error){
    $('statusText').textContent='Error';
    $('statusMeta').textContent=error.message;
    $('statusDot').classList.remove('live');
  }finally{$('refreshBtn').disabled=false}
}
function render(data){
  const live=data.dataMode==='LIVE';
  $('statusDot').classList.toggle('live',live);
  $('statusText').textContent=live?'LIVE':data.dataMode||'Starting';
  $('statusMeta').textContent=data.status?.lastHypixelUpdate?`Market update: ${new Date(data.status.lastHypixelUpdate).toLocaleTimeString()}`:'Waiting for first Bazaar snapshot';
  const hr=data.status?.historyReliability||{};
  $('historyDepth').textContent=hr.reliableDepthMs>0?fmtSpan(hr.reliableDepthMs):'Building…';
  $('historyCoverage').textContent=hr.reliableDepthMs>0?`${(Number(hr.coverage||0)*100).toFixed(0)}% snapshot coverage`:'Not enough continuous history yet';
  $('modeMeta').textContent=`${data.priceMode} · effective tax ${Number(data.effectiveTaxPercent||0).toFixed(3)}%`;
  const compareDays=Math.max(1,Math.min(7,Number(data.options?.compareDays||$('compareDays').value||7)));
  $('compareHeader').textContent=`LIVE vs ${compareDays}d`;
  $('coverageHeader').textContent=`${compareDays}d coverage`;
  renderHistoryDetail(data); renderDataDetail(data);

  const supported=(data.rows||[]).filter(r=>r.supported);
  const topNet=[...supported].sort((a,b)=>b.netDay-a.netDay)[0];
  const topGross=[...supported].sort((a,b)=>b.grossDay-a.grossDay)[0];
  const topPay=[...supported].filter(r=>Number.isFinite(r.paybackDays)).sort((a,b)=>a.paybackDays-b.paybackDays)[0];
  $('mNet').textContent=topNet?fmtCoins(topNet.netDay):'—';$('mNetName').textContent=topNet?.name||'—';
  $('mGross').textContent=topGross?fmtCoins(topGross.grossDay):'—';$('mGrossName').textContent=topGross?.name||'—';
  $('mPayback').textContent=topPay?fmtDays(topPay.paybackDays):'—';$('mPaybackName').textContent=topPay?.name||'Exact setup cost unavailable';
  $('mRows').textContent=supported.length;$('mCoverage').textContent=`${(data.rows||[]).length-supported.length} special/unsupported`;
  $('resultCount').textContent=`${(data.rows||[]).length} minions`;
  $('updatedText').textContent=`Calculated ${new Date(data.generatedAt).toLocaleTimeString()} · collection every ${fmtDays(data.options?.collectionIntervalDays||1)}`;

  $('rows').innerHTML='';
  (data.rows||[]).forEach((r,i)=>{
    const tr=document.createElement('tr');
    if(!r.supported){
      tr.className='unsupported';
      tr.innerHTML=`<td>—</td><td><span class="name">${r.name}</span><span class="family">Special model</span></td><td>—</td><td>—</td><td colspan="9" class="na">${r.reason||'Not modeled'}</td>`;
      $('rows').appendChild(tr);return;
    }
    tr.className='dataRow';tr.dataset.index=i;
    const setup=r.setupComplete&&Number.isFinite(r.setupCost)?fmtCoins(r.setupCost):'N/A';
    const pay=Number.isFinite(r.paybackDays)?fmtDays(r.paybackDays):'N/A';
    const roi=Number.isFinite(r.roi30dPercent)?fmtPct(r.roi30dPercent):'N/A';
    const ups=upgradeNames(r);
    const coverage=Number(r.historicalCoverage||0);
    const gap=Number.isFinite(r.netGapToNextDay)&&r.nextNetName?`<span class="gapMeta">+${fmtCoins(r.netGapToNextDay)} vs ${r.nextNetName}</span>`:'';
    tr.innerHTML=`<td>${i+1}</td>
      <td><span class="name">${r.name}</span><span class="family">${r.family}</span></td>
      <td><span class="upgradePair"><span class="upgradePill">${ups[0]}</span><span class="upgradePill">${ups[1]}</span></span></td>
      <td>T${r.tier}</td>
      <td class="${r.netDay>=0?'profit':'loss'}">${fmtCoins(r.netDay)}${gap}</td>
      <td class="${Number(r.currentVsHistoryPercent)>=0?'profit':'loss'}">${Number.isFinite(r.currentVsHistoryPercent)?fmtPct(r.currentVsHistoryPercent):'N/A'}</td>
      <td class="${coverage<0.8?'historyWeak':''}" title="${coverage<0.8?'Less than 80% reliable 7-day price coverage':'Reliable 7-day price coverage'}">${coverage<0.8?'⚠ ':''}${(coverage*100).toFixed(0)}%</td>
      <td>${fmtCoins(r.grossDay)}</td><td>${fmtCoins(r.expensesDay)}</td>
      <td class="${setup==='N/A'?'na':''}">${setup}</td><td class="${pay==='N/A'?'na':''}">${pay}</td>
      <td class="${roi==='N/A'?'na':''}">${roi}</td>
      <td>+${fmtPct(r.speedBonusPercent)}</td>`;
    tr.addEventListener('click',()=>showDetail(r));
    $('rows').appendChild(tr);
  });
  applyColumnVisibility();
}
function showDetail(r){
  const alternatives=(r.upgradeAlternatives||[]).map((a,i)=>`<tr><td>${i===0?'Best':a.rank}</td><td>${(a.upgrades||[]).map(x=>x.name).join(' + ')||'No upgrades'}</td><td class="${a.netPerMinionDay>=0?'profit':'loss'}">${fmtCoins(a.netPerMinionDay)}</td><td>${fmtCoins(a.grossPerMinionDay)}</td><td>${fmtCoins(a.expensesPerMinionDay)}</td><td>${a.deltaFromBestPerMinionDay===0?'—':fmtCoins(a.deltaFromBestPerMinionDay)}</td></tr>`).join('');
  const outputs=(r.outputDetails||[]).map(o=>`<tr><td>${o.item}<span class="family">${o.source}${o.compacted?' · compacted':''}</span></td><td>${fmtCoins(o.unitsPerDay)}</td><td>${o.quote.method}</td><td>${fmtCoins(o.quote.price)}</td><td>${fmtCoins(o.revenuePerDay)}</td></tr>`).join('');
  const warnings=[...(r.warnings||[]),...(r.setupComplete?[]:[`Setup/ROI incomplete: ${(r.setupMissing||[]).join(', ')||'exact recipe unavailable'}`])];
  if(Number(r.historicalCoverage||0)<0.8) warnings.push(`Historical price coverage is only ${(Number(r.historicalCoverage||0)*100).toFixed(0)}%; treat the 7-day comparison as lower-confidence.`);
  $('detail').innerHTML=`<div class="detailTitle"><h2>${r.name} T${r.tier}</h2><p>${r.count} minion(s) · ${r.fuel.name} · ${r.upgrades.map(x=>x.name).join(' + ')||'no upgrades'}</p></div>
    <div class="detailStats">
      <div><span>Base action</span><strong>${r.baseSecondsPerAction.toFixed(2)}s</strong></div>
      <div><span>Effective action</span><strong>${r.effectiveSecondsPerAction.toFixed(2)}s</strong></div>
      <div><span>Cycles / day / minion</span><strong>${fmtCoins(r.cyclesPerDay)}</strong></div>
      <div><span>Collection interval</span><strong>${Number(r.collectionIntervalDays||1)<1?(Number(r.collectionIntervalDays||1)*24).toFixed(1)+'h':Number(r.collectionIntervalDays||1).toFixed(1)+'d'}</strong></div>
      <div><span>Net / day</span><strong class="${r.netDay>=0?'profit':'loss'}">${fmtCoins(r.netDay)}</strong></div>
      <div><span>Setup total · one-time</span><strong>${r.setupComplete?fmtCoins(r.setupCost):'N/A'}</strong></div>
      <div><span>Recurring expenses / day</span><strong>${fmtCoins(r.expensesDay)}</strong></div>
      <div><span>Payback</span><strong>${fmtDays(r.paybackDays)}</strong></div>
      <div><span>LIVE net / day</span><strong>${fmtCoins(r.liveNetDay)}</strong></div>
      <div><span>7d expected net / day</span><strong>${fmtCoins(r.expected7dNetDay)}</strong></div>
      <div><span>LIVE vs 7d</span><strong>${Number.isFinite(r.currentVsHistoryPercent)?fmtPct(r.currentVsHistoryPercent):'—'}</strong></div>
      <div><span>7d price coverage</span><strong>${fmtPct((r.historicalCoverage||0)*100)}</strong></div>
      <div><span>Price CV</span><strong>${fmtPct((r.stabilityCv||0)*100)}</strong></div>
    </div>
    <h3>Upgrade comparison</h3>
    <p class="family">Automatically tested ${r.upgradeSearchCount||0} compatible zero-, one- and two-slot setups. The highest recurring net-profit setup is selected automatically.</p>
    <table class="detailOutputs"><thead><tr><th>Rank</th><th>Upgrade setup</th><th>Net / minion / day</th><th>Gross</th><th>Recurring cost</th><th>vs best</th></tr></thead><tbody>${alternatives||'<tr><td colspan="6">No compatible upgrade setup</td></tr>'}</tbody></table>
    <h3>Output breakdown · per minion / day</h3>
    <table class="detailOutputs"><thead><tr><th>Output</th><th>Units</th><th>Sale</th><th>Net price</th><th>Revenue</th></tr></thead><tbody>${outputs||'<tr><td colspan="5">No priced outputs</td></tr>'}</tbody></table>
    ${warnings.length?`<div class="warnings"><strong>Notes</strong><ul>${warnings.map(x=>`<li>${x}</li>`).join('')}</ul></div>`:''}`;
  $('detailDialog').showModal();
}

function applyColumnVisibility(){document.querySelectorAll('table thead tr').forEach(tr=>[...tr.children].forEach((c,i)=>{if(i<visibleColumns.length)c.style.display=visibleColumns[i]?'':'none';}));document.querySelectorAll('#rows tr.dataRow').forEach(tr=>[...tr.children].forEach((c,i)=>{if(i<visibleColumns.length)c.style.display=visibleColumns[i]?'':'none';}));}
function buildColumnsMenu(){const m=$('columnsMenu');m.innerHTML='';columnNames.forEach((n,i)=>{const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.checked=visibleColumns[i];c.disabled=i===1;c.onchange=()=>{visibleColumns[i]=c.checked;visibleColumns[1]=true;localStorage.setItem(COLUMN_KEY,JSON.stringify(visibleColumns));applyColumnVisibility();};l.append(c,document.createTextNode(n));m.appendChild(l);});}
function views(){try{return JSON.parse(localStorage.getItem(VIEW_KEY)||'{}')||{};}catch{return {};}}
function refreshViews(){const s=$('viewPreset');s.innerHTML='<option value="">Saved views…</option>';for(const n of Object.keys(views()).sort())option(s,n,n);}
function renderHistoryDetail(data){const h=data.status?.historyReliability||{};$('historyDetail').innerHTML=`<h2>Reliable history</h2><div class="detailStats"><div><span>Reliable depth</span><strong>${h.reliableDepthMs?fmtSpan(h.reliableDepthMs):'Not available yet'}</strong></div><div><span>Coverage</span><strong>${fmtPct(Number(h.coverage||0)*100)}</strong></div><div><span>Threshold</span><strong>${fmtPct(Number(h.threshold||.8)*100)}</strong></div><div><span>Reliable products</span><strong>${h.reliableProducts||0} / ${h.products||0}</strong></div><div><span>Reliable since</span><strong>${h.reliableSince?new Date(h.reliableSince).toLocaleString():'—'}</strong></div><div><span>Snapshots checked</span><strong>${h.snapshotCount||0}</strong></div></div>`;}
function renderDataDetail(data){const st=data.status||{};$('dataDetail').innerHTML=`<h2>Data diagnostics</h2><div class="detailStats"><div><span>Mode</span><strong>${data.dataMode||'—'}</strong></div><div><span>Freshness</span><strong>${fmtAgo(st.lastHypixelUpdate)}</strong></div><div><span>Market products</span><strong>${st.marketProducts||0}</strong></div><div><span>History products</span><strong>${st.historyProducts||0}</strong></div><div><span>Version</span><strong>${st.version||'—'}</strong></div></div>`;}

function schedule(){clearTimeout(timer);timer=setTimeout(load,180)}
for(const id of controls){$(id).addEventListener(id==='search'?'input':'change',()=>{if(id==='compareDays')localStorage.setItem(COMPARE_KEY,$('compareDays').value);schedule();})}
$('refreshBtn').addEventListener('click',load);
$('closeDialog').addEventListener('click',()=>$('detailDialog').close());
$('detailDialog').addEventListener('click',(e)=>{if(e.target===$('detailDialog'))$('detailDialog').close()});
$('columnsBtn').onclick=()=>{$('columnsMenu').hidden=!$('columnsMenu').hidden;};
$('saveViewBtn').onclick=()=>{const n=prompt('Name this table view:');if(!n)return;const v=views();v[n]={columns:visibleColumns,sort:$('sort').value,compareDays:$('compareDays').value};localStorage.setItem(VIEW_KEY,JSON.stringify(v));refreshViews();};
$('viewPreset').onchange=()=>{const v=views()[$('viewPreset').value];if(!v)return;if(v.columns)visibleColumns=v.columns;if(v.sort)$('sort').value=v.sort;if(v.compareDays)$('compareDays').value=v.compareDays;buildColumnsMenu();applyColumnVisibility();load();};
$('historyCard').onclick=()=>$('historyDialog').showModal();$('dataDetailsBtn').onclick=()=>$('dataDialog').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
const rc=localStorage.getItem(COMPARE_KEY);if(rc)$('compareDays').value=rc;buildColumnsMenu();refreshViews();
load();