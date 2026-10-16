import {z} from 'zod';
import {approved, dcbf, defaultAssumptions, sum, type Dataset, type Assumptions} from './domain';
import {assetMTBF} from './mtbf';

export const intents=['overview','loss','downtime','mtbf','criticality','incidents','medfi','modes','sites','categories','actions','economics','forecast','help'] as const;
export const planSchema=z.object({intent:z.enum(intents),assetId:z.string(),site:z.string(),category:z.string(),from:z.number().int().min(1900).max(2100),to:z.number().int().min(1900).max(2100),limit:z.number().int().min(1).max(20),ascending:z.boolean()}).strict();
export type QueryPlan=z.infer<typeof planSchema>;
export type AgentAnswer={title:string,answer:string,basis:string[],columns:string[],rows:{values:string[],assetId?:string,incidentId?:string}[],sources:{id:string,label:string,assetId:string,incidentId?:string}[],sourceCount:number,scope:QueryPlan,computedAt:string,mode:string,notice?:string};
export const emptyPlan:QueryPlan={intent:'help',assetId:'',site:'',category:'',from:2016,to:2025,limit:10,ascending:false};
const num=(n:number|null,d=2)=>n===null||!Number.isFinite(n)?'Not estimable':n.toLocaleString('en-US',{maximumFractionDigits:d});
const usd=(n:number)=>'$'+num(n);
export function parseQuestion(question:string,d:Dataset,context:QueryPlan):QueryPlan{
 const q=question.toLowerCase(),p={...context,intent:'help' as QueryPlan['intent']};
 const tags=d.assets.filter(a=>new RegExp('(^|[^a-z0-9])'+a.tag.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)').test(q));
 if(tags.length>1)return p;
 if(tags.length===1)p.assetId=tags[0].id;
 for(const site of new Set(d.assets.map(a=>a.site)))if(q.includes(site.toLowerCase()))p.site=site;
 for(const category of new Set(d.assets.map(a=>a.category)))if(q.includes(category.toLowerCase()))p.category=category;
 if(/all assets|portfolio|rank|top \d|bad actors|lowest|highest|worst|best mtbf/.test(q)&&tags.length===0)p.assetId='';
 if(/all sites|cross.site|compare sites/.test(q))p.site='';
 if(/all categories|category.wise|categories/.test(q))p.category='';
 if(tags.length===0&&/\b[a-z]{1,4}-(?:[a-z]{1,4}-)?\d+\b/.test(q))return p;
 const years=q.match(/\b(?:19|20)\d{2}\b/g);if(years?.length){p.from=+years[0];p.to=+(years[1]||years[0]);}
 const limit=q.match(/(?:top|first|bottom)\s+(\d+)/);if(limit)p.limit=Math.min(20,Math.max(1,+limit[1]));
 p.ascending=/lowest|ascending|least|bottom|worst mtbf|shortest/.test(q);
 if(/replace|replacement|npv|irr|payback|profitability|dcbf|economic|cash flow/.test(q))p.intent='economics';
 else if(/predict|forecast|crow|weibull|bayesian/.test(q))p.intent='forecast';
 else if(/mtbf|mean time between/.test(q)){p.intent='mtbf';if(!/highest|descending|best|longest/.test(q))p.ascending=true;}
 else if(/critical|aca/.test(q))p.intent='criticality';
 else if(/medfi|lifecycle stage|leading|lagging/.test(q))p.intent='medfi';
 else if(/action|overdue|recommendation/.test(q))p.intent='actions';
 else if(/failure mode|root cause|mechanism|why.*fail/.test(q))p.intent='modes';
 else if(/site.*compar|compar.*site|site.wise|by site|cross.site/.test(q))p.intent='sites';
 else if(/categor.*compar|compar.*categor|category.wise|by category|categories/.test(q))p.intent='categories';
 else if(/rir|incident|history|recent|latest|inspection finding/.test(q))p.intent='incidents';
 else if(/downtime/.test(q))p.intent='downtime';
 else if(/loss|bad actor|pareto/.test(q))p.intent='loss';
 else if(/overview|summari|summary|tell me|asset health|how many assets/.test(q))p.intent='overview';
 if(years&&(years.length>2||(years.length===2&&/compare|versus|vs\.?/.test(q)&&!/between|from|to|[–-]/.test(q))))p.intent='help';
 if(/\bf[12]\b|overdue|weibull|bayesian|ignore.*instructions|delete|modify|change|only.*draft|last \d+ (days|months)|yesterday|today|this year|last year/.test(q))p.intent='help';
 // Do not substitute an actual-loss answer for a potential-risk or what-if question.
 if(/potential|what if|what-if|increase|decrease|change .*capex/.test(q))p.intent='help';
 return p;
}
export function validatePlan(p:unknown,d:Dataset){const v=planSchema.parse(p);if(v.from>v.to)throw Error('The start year must not exceed the end year.');if(v.assetId&&!d.assets.some(a=>a.id===v.assetId))throw Error('Select an asset in this workspace.');if(v.site&&!d.assets.some(a=>a.site===v.site))throw Error('Unknown site.');if(v.category&&!d.assets.some(a=>a.category===v.category))throw Error('Unknown category.');return v;}

export function answerQuery(d:Dataset,p:QueryPlan,assumptions:Assumptions=defaultAssumptions):AgentAnswer{
 p=validatePlan(p,d);
 const assets=d.assets.filter(a=>(!p.assetId||a.id===p.assetId)&&(!p.site||a.site===p.site)&&(!p.category||a.category===p.category));
 const ids=new Set(assets.map(a=>a.id)),all=d.incidents.filter(e=>ids.has(e.assetId)&&+e.date.slice(0,4)>=p.from&&+e.date.slice(0,4)<=p.to),reviewed=all.filter(approved),actual=reviewed.filter(e=>e.impact==='F1');
 const a:AgentAnswer={title:'Reliability answer',answer:'',basis:[`Incident scope: ${p.from}–${p.to}; ${p.site||'all sites'}; ${p.category||'all categories'}; ${assets.length} assets.`,`Actual-loss analytics use approved/closed F1 records. Potential exposure is not added to actual loss.`,'Seed records are synthetic demonstrations; user-entered records retain their recorded provenance.'],columns:[],rows:[],sources:[],sourceCount:0,scope:p,computedAt:new Date().toISOString(),mode:'Guided data query'};
 const cite=(rows:typeof all)=>{a.sourceCount=rows.length;a.sources=rows.slice(0,100).map(e=>({id:e.id,label:`${e.id} · ${d.assets.find(x=>x.id===e.assetId)?.tag} · ${e.date.slice(0,10)} · ${e.status}`,assetId:e.assetId,incidentId:e.id}));};
 const citeAssets=()=>{a.sourceCount=assets.length;a.sources=assets.slice(0,100).map(x=>({id:x.id,label:x.tag+' · asset register',assetId:x.id}));};
 if(p.intent==='help'){a.title='Choose a grounded question';a.answer='I can retrieve asset summaries, rank actual loss or downtime, calculate MTBF, show criticality, retrieve RIRs and actions, compare sites or categories, and report the current DCBF forecast. Choose one asset for economic questions. Use the controls to set scope. Potential-loss estimates and what-if changes should be reviewed in the RIR impact monitor or DCBF workbench.';a.basis=['This guided mode supports the listed question types; it does not infer an answer to an unsupported question.'];return a;}
 if(!assets.length){a.answer='No assets match this scope. Clear the asset, site or category filter and try again.';return a;}
 if(['economics','forecast'].includes(p.intent)){
  if(assets.length!==1){a.answer='Select one asset or include its exact tag to calculate its forecast and replacement economics.';return a;}
  const asset=assets[0],r=dcbf(d,asset.id,assumptions);a.title=`${asset.tag} · ${p.intent==='economics'?'DCBF business case':'reliability forecast'}`;
  a.basis=[`Shared DCBF engine; ${assumptions.evidenceMode||'Working'} evidence through ${r.ev.through}. Incident-year controls do not truncate DCBF calibration.`,`Model: ${assumptions.model}; ${assumptions.horizon}-year common horizon from ${assumptions.year}; CAPEX ${usd(assumptions.capex)}; WACC ${num(assumptions.wacc*100)}%; inflation ${num(assumptions.inflation*100)}%; effectiveness ${num(assumptions.effectiveness*100)}%.`,`Uses the current workbench assumptions. Includes ${r.risks.length} assessed forward risks and ${r.ev.rows.length} qualifying historical failure lifecycles.`,`Forecasts and incremental benefits are scenario estimates, not achieved savings or an automatic replacement authorization.`];
  if(!r.ev.rows.length&&!r.risks.length){a.answer='No qualifying historical failures or assessed forward risks support this forecast. Add and review evidence before drawing an economic conclusion.';return a;}
  if(p.intent==='economics'){const b=r.best;a.answer=b.npv>0?`The A2 in-kind replacement scenario has its highest incremental NPV in ${b.year}: ${usd(b.npv)}. IRR: ${b.irr===null?'undefined':num(b.irr*100)+'%'}. Payback: ${b.payback===null?'not reached':num(b.payback)+' years after intervention'}. Profitability index: ${num(b.pi)}. This maximizes NPV among the tested years under the assumptions below.`:'No tested replacement year has positive incremental NPV under the current assumptions.';a.columns=['Replacement year','NPV · USD','IRR','Payback · years','PI'];a.rows=r.timing.map(t=>({values:[String(t.year),usd(t.npv),t.irr===null?'Undefined':num(t.irr*100)+'%',t.payback===null?'Not reached':num(t.payback),num(t.pi)],assetId:asset.id}));}
  else{a.answer=`The next forecast year (${r.forecasts[0].year}) has ${num(r.forecasts[0].failures)} expected events and ${usd(r.forecasts[0].loss)} expected loss, including ${usd(r.forecasts[0].potentialLoss)} from assessed forward exposure. Precursors affect forward risk without becoming historical failures.`;a.columns=['Year','Expected events','Expected loss · USD','Assessed potential · USD'];a.rows=r.forecasts.map(t=>({values:[String(t.year),num(t.failures),usd(t.loss),usd(t.potentialLoss)],assetId:asset.id}));}
  cite(d.incidents.filter(e=>e.assetId===asset.id&&e.date.slice(0,10)<=r.ev.through&&(assumptions.evidenceMode!=='Reviewed'||approved(e))));return a;
 }
 if(p.intent==='mtbf'){
  const rows=assets.map(x=>({asset:x,m:assetMTBF(x,d.incidents)})).sort((x,y)=>x.m.hours===null?1:y.m.hours===null?-1:(p.ascending?1:-1)*(x.m.hours-y.m.hours));
  a.title='MTBF ranking';a.answer=`${rows.filter(x=>x.m.hours!==null).length} of ${assets.length} assets have estimable MTBF. Ordered ${p.ascending?'lowest first (more frequent failures per operating hour)':'highest first'}. Assets with insufficient exposure or no qualifying failures are not assigned a numerical MTBF.`;a.columns=['Asset','MTBF · hours','Distinct failures','Verified period','Basis'];a.rows=rows.slice(0,p.limit).map(({asset:x,m})=>({values:[x.tag,num(m.hours),String(m.failures),x.exposure?x.exposure.start+' to '+x.exposure.end:'Unavailable',m.reason],assetId:x.id}));a.basis.push('MTBF uses each asset’s complete verified operating-hours period, not the incident-year controls. F/I progression records are deduplicated by lifecycle. No-failure samples are not reported as infinite MTBF.');citeAssets();return a;
 }
 if(p.intent==='criticality'){a.title='Asset criticality';a.answer='Ranked by the register’s criticality level. Reviewed ACA status and evidence remain available in each asset panel.';a.columns=['Asset','Site','Criticality / 5','Assessment'];a.rows=[...assets].sort((x,y)=>(p.ascending?1:-1)*(x.criticality-y.criticality)).slice(0,p.limit).map(x=>({values:[x.tag,x.site,String(x.criticality),x.aca?.current?'Reviewed ACA':'Provisional register value'],assetId:x.id}));citeAssets();return a;}
 if(p.intent==='actions'){const rows=d.actions.filter(x=>ids.has(x.assetId)).sort((x,y)=>x.due.localeCompare(y.due));a.title='Recorded actions';a.answer=`${rows.length} recorded actions for the selected assets, earliest due first. These are recorded assignments, not newly generated recommendations.`;a.columns=['Asset','Action','Owner','Due','Status'];a.rows=rows.slice(0,p.limit).map(x=>({values:[assets.find(a=>a.id===x.assetId)!.tag,x.title,x.owner,x.due,x.status],assetId:x.assetId}));a.basis.push('Actions use the asset scope; incident-year controls do not filter due dates.');a.sourceCount=rows.length;a.sources=rows.slice(0,100).map(x=>({id:x.id,label:x.id+' · '+x.evidence,assetId:x.assetId}));return a;}
 if(p.intent==='incidents'||p.intent==='modes'){const rows=[...all].sort((x,y)=>y.date.localeCompare(x.date));a.title=p.intent==='modes'?'Recorded failure modes and causes':'Reliability incident evidence';a.answer=`${rows.length} RIR records match the scope. Showing the latest ${Math.min(p.limit,rows.length)}. Recorded mechanisms and causes are evidence statements; this answer does not establish causation.`;a.columns=['RIR / date','Asset','Stage / impact / status','Mode / mechanism','Recorded cause'];a.rows=rows.slice(0,p.limit).map(e=>({values:[e.id+' / '+e.date.slice(0,10),assets.find(x=>x.id===e.assetId)!.tag,`${e.stage} / ${e.impact} / ${e.status}`,`${e.mode} / ${e.mechanism}`,e.rootCause||e.cause||'Not recorded'],assetId:e.assetId,incidentId:e.id}));cite(rows);return a;}
 if(p.intent==='medfi'){a.title='MEDFI evidence distribution';a.answer=`${all.length} RIR records across the failure lifecycle. These are record counts, not distinct failures; linked progression can create multiple stage records.`;a.columns=['Stage','Records','Approved / closed','F1 records','F2 records'];a.rows=['M Delta E','D','F','I'].map(s=>{const r=all.filter(e=>e.stage===s);return {values:[s,String(r.length),String(r.filter(approved).length),String(r.filter(e=>e.impact==='F1').length),String(r.filter(e=>e.impact==='F2').length)]};});cite(all);return a;}
 const total=sum(actual.map(e=>e.loss)),days=sum(actual.map(e=>e.downtime));
 if(p.intent==='overview'){a.title='Asset reliability overview';a.answer=`${assets.length} assets and ${all.length} RIR records match this scope. Approved/closed F1 records account for ${usd(total)} actual loss and ${num(days)} asset-event downtime days. ${all.length-reviewed.length} records are not approved/closed.`;a.columns=['Asset','Site','Category','Actual loss · USD','F1 records'];a.rows=assets.map(x=>{const r=actual.filter(e=>e.assetId===x.id);return {values:[x.tag,x.site,x.category,usd(sum(r.map(e=>e.loss))),String(r.length)],assetId:x.id};}).slice(0,p.limit);cite(actual);}
 else{const group=p.intent==='sites'?'site':p.intent==='categories'?'category':'id';const records=[...new Set(assets.map(x=>x[group]))].map(key=>{const aa=assets.filter(x=>x[group]===key),set=new Set(aa.map(x=>x.id)),rr=actual.filter(e=>set.has(e.assetId));return {key,label:group==='id'?aa[0].tag:key,assetId:group==='id'?key:undefined,loss:sum(rr.map(e=>e.loss)),days:sum(rr.map(e=>e.downtime)),count:rr.length};}).sort((x,y)=>(p.ascending?1:-1)*(p.intent==='downtime'?x.days-y.days:x.loss-y.loss));a.title=p.intent==='downtime'?'Downtime ranking':p.intent==='sites'?'Site comparison':p.intent==='categories'?'Category comparison':'Actual-loss bad actors';a.answer=`Approved/closed F1 actual loss totals ${usd(total)}. The leading ${Math.min(p.limit,records.length)} displayed groups account for ${num(total?sum(records.slice(0,p.limit).map(x=>x.loss))/total*100:0)}% of that loss. Potential exposure is excluded.`;a.columns=['Asset / group','Actual loss · USD','Loss share','Downtime · days','F1 records'];a.rows=records.slice(0,p.limit).map(x=>({values:[x.label,usd(x.loss),num(total?x.loss/total*100:0)+'%',num(x.days),String(x.count)],assetId:x.assetId}));cite(actual);}
 a.basis.push('Downtime is the sum of recorded asset-event downtime. Concurrent events can overlap; it is not unique plant outage duration. F1 record counts are not deduplicated failure counts.');return a;
}
