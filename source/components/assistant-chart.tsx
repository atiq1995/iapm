'use client';
// Charts shown under a Relia answer: trends (per year/month) and rankings (bar chart + table).
// Data comes from the read-only tools, never from the model.
import React,{useState} from 'react';
import {ResponsiveContainer,BarChart,Bar,LineChart,Line,AreaChart,Area,PieChart,Pie,ScatterChart,Scatter,ZAxis,Legend,XAxis,YAxis,Tooltip,CartesianGrid,Cell} from 'recharts';
import {ChartNoAxesCombined,ArrowUpRight,Table2,Bookmark,BookmarkCheck} from 'lucide-react';
import type {AssistantVisual,RankingChart,TrendChart} from '@/lib/assistant/tools';
import type {BuiltChart} from '@/lib/assistant/charts';

// Categorical palette from the app's colours; "Other" is always grey.
const PALETTE=['#0c3449','#007a53','#2f8fb3','#b8902f','#6b8e23','#8a5a9e','#c0563f','#5d7a8c'];
const colour=(name:string,i:number)=>name.startsWith('Other')?'#a3b1ba':PALETTE[i%PALETTE.length];

const compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
const full=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:1});
// Executive figures: $271.1M, 3,846 hours, 590.7 days.
export const show=(n:number,unit:string)=>unit==='USD'?(Math.abs(n)>=1e6?`$${compact.format(n)}`:`$${Math.round(n).toLocaleString('en-US')}`):`${full(n)} ${unit}`;
const axisTick={fontSize:11,fill:'#637c8a'};
const tooltipStyle={fontSize:12,borderRadius:6,border:'1px solid #dce5ea'};

type Actions={onOpenOverview?:()=>void,onOpenAsset?:(id:string)=>void,onSave?:(name:string)=>Promise<string>,savedName?:string};

export function AssistantChart({chart,...actions}:{chart:AssistantVisual}&Actions){
 const asset=chart.filters.asset;
 return <figure className="asst-chart" aria-label={chart.title}>
  <figcaption><ChartNoAxesCombined size={15}/><span>{chart.title}</span></figcaption>
  {chart.kind==='trend'?<Trend chart={chart}/>:chart.kind==='ranking'?<Ranking chart={chart} onOpenAsset={actions.onOpenAsset}/>:<Built chart={chart}/>}
  <div className="asst-chart-actions">
   {(actions.savedName||actions.onSave)&&<SaveReport title={chart.title} savedName={actions.savedName} onSave={actions.onSave}/>}
   {actions.onOpenOverview&&<button type="button" onClick={actions.onOpenOverview}>Open in Executive overview <ArrowUpRight size={13}/></button>}
   {asset&&actions.onOpenAsset&&chart.kind!=='ranking'&&<button type="button" onClick={()=>actions.onOpenAsset!(asset)}>Open asset <ArrowUpRight size={13}/></button>}
  </div>
 </figure>;
}

// Save the chart's recipe as a report (numbers are recalculated every time it runs).
function SaveReport({title,savedName,onSave}:{title:string,savedName?:string,onSave?:(name:string)=>Promise<string>}){
 const [state,setState]=useState<'idle'|'naming'|'saving'|'error'>('idle'),[name,setName]=useState(title.slice(0,80)),[saved,setSaved]=useState(savedName||''),[error,setError]=useState('');
 if(saved)return <span className="asst-saved"><BookmarkCheck size={13}/> Saved report · {saved}</span>;
 if(!onSave)return null;
 if(state==='idle')return <button type="button" onClick={()=>setState('naming')}><Bookmark size={13}/> Save report</button>;
 const submit=async()=>{if(!name.trim())return;setState('saving');setError('');try{setSaved(await onSave(name.trim()));}catch(e){setError((e as Error).message);setState('error');}};
 return <form className="asst-save" onSubmit={e=>{e.preventDefault();submit();}}>
  <label htmlFor={`save-${title}`} className="sr-only">Report name</label>
  <input id={`save-${title}`} value={name} maxLength={80} onChange={e=>setName(e.target.value)} disabled={state==='saving'} autoFocus/>
  <button type="submit" disabled={state==='saving'||!name.trim()}>{state==='saving'?'Saving…':'Save'}</button>
  <button type="button" onClick={()=>{setState('idle');setError('');}}>Cancel</button>
  {error&&<span className="error" role="alert">{error}</span>}
 </form>;
}

function Trend({chart}:{chart:TrendChart}){
 const total=chart.points.reduce((s,p)=>s+p.value,0);
 const peak=chart.points.reduce((a,b)=>(b.value>a.value?b:a),chart.points[0]);
 const bars=(chart.unit==='events'||chart.unit==='RIRs')&&chart.points.length<=60;
 const tip={formatter:(v:unknown)=>[show(Number(v),chart.unit),chart.metric] as [string,string],contentStyle:tooltipStyle};
 return <>
  <div className="asst-chart-stats">
   <span><small>Total</small><b>{show(total,chart.unit)}</b></span>
   {peak&&<span><small>Peak</small><b>{show(peak.value,chart.unit)} · {peak.period}</b></span>}
   <span><small>Periods</small><b>{chart.points.length} {chart.interval}s</b></span>
  </div>
  <div className="asst-chart-plot">
   <ResponsiveContainer width="100%" height={220}>
    {bars
     ?<BarChart data={chart.points} margin={{top:8,right:8,bottom:0,left:0}}><CartesianGrid stroke="#edf2f5" vertical={false}/><XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={{stroke:'#dce5ea'}} minTickGap={12}/><YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={(v:number)=>compact.format(v)}/><Tooltip {...tip} cursor={{fill:'#e7f4ed'}}/><Bar dataKey="value" fill="#007a53" radius={[3,3,0,0]} maxBarSize={28}/></BarChart>
     :<LineChart data={chart.points} margin={{top:8,right:8,bottom:0,left:0}}><CartesianGrid stroke="#edf2f5" vertical={false}/><XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={{stroke:'#dce5ea'}} minTickGap={16}/><YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(v:number)=>compact.format(v)}/><Tooltip {...tip}/><Line type="monotone" dataKey="value" stroke="#007a53" strokeWidth={2} dot={chart.points.length<=40?{r:2.5,fill:'#007a53'}:false} activeDot={{r:4}}/></LineChart>}
   </ResponsiveContainer>
  </div>
  <details className="asst-chart-data"><summary><Table2 size={13}/> Data table ({chart.points.length} {chart.interval}s)</summary>
   <div className="asst-table"><table><thead><tr><th>{chart.interval==='year'?'Year':'Month'}</th><th className="num">{chart.metric}</th></tr></thead>
    <tbody>{chart.points.map(p=><tr key={p.period}><td>{p.period}</td><td className="num">{show(p.value,chart.unit)}</td></tr>)}</tbody></table></div>
  </details>
 </>;
}

function Ranking({chart,onOpenAsset}:{chart:RankingChart,onOpenAsset?:(id:string)=>void}){
 const leader=chart.rows[0];
 const height=Math.max(120,chart.rows.length*30+36);
 const open=(id?:string)=>{if(id&&onOpenAsset)onOpenAsset(id);};
 return <>
  <div className="asst-chart-stats">
   {chart.showShare&&<span><small>Total</small><b>{show(chart.total,chart.unit)}</b></span>}
   {leader&&<span><small>Leader</small><b>{leader.label} · {show(leader.value,chart.unit)}{chart.showShare?` · ${leader.share}%`:''}</b></span>}
   <span><small>Shown</small><b>{chart.rows.length} {chart.groupBy==='asset'?'assets':chart.groupBy==='site'?'sites':'categories'}</b></span>
  </div>
  <div className="asst-chart-plot">
   <ResponsiveContainer width="100%" height={height}>
    <BarChart data={chart.rows} layout="vertical" margin={{top:4,right:12,bottom:0,left:0}}>
     <CartesianGrid stroke="#edf2f5" horizontal={false}/>
     <XAxis type="number" tick={axisTick} tickLine={false} axisLine={{stroke:'#dce5ea'}} tickFormatter={(v:number)=>compact.format(v)}/>
     <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={96} interval={0}/>
     <Tooltip formatter={(v:unknown)=>[show(Number(v),chart.unit),chart.metric] as [string,string]} contentStyle={tooltipStyle} cursor={{fill:'#e7f4ed'}}/>
     <Bar dataKey="value" radius={[0,3,3,0]} maxBarSize={20} onClick={(d:unknown)=>open((d as {id?:string})?.id)} style={{cursor:onOpenAsset&&chart.groupBy==='asset'?'pointer':'default'}}>
      {chart.rows.map((r,i)=><Cell key={r.label} fill={i===0?'#0c3449':'#007a53'}/>)}
     </Bar>
    </BarChart>
   </ResponsiveContainer>
  </div>
  <div className="asst-table"><table>
   <thead><tr><th>#</th><th>{chart.groupBy==='asset'?'Asset':chart.groupBy==='site'?'Site':'Category'}</th><th className="num">{chart.metric}</th>{chart.showShare&&<th className="num">Share</th>}</tr></thead>
   <tbody>{chart.rows.map((r,i)=><tr key={r.label}>
    <td>{i+1}</td>
    <td>{r.id&&onOpenAsset?<button type="button" className="asst-cite" onClick={()=>open(r.id)}>{r.label}</button>:<b>{r.label}</b>}{r.sub&&<div className="fine">{r.sub}</div>}</td>
    <td className="num">{show(r.value,chart.unit)}</td>
    {chart.showShare&&<td className="num">{r.share}%</td>}
   </tr>)}</tbody>
  </table></div>
 </>;
}

// Any chart from the on-demand builder. Values come pre-calculated from the server.
function Built({chart}:{chart:BuiltChart}){
 const {type,unit}=chart;
 const fmt=(n:number)=>show(n,unit);
 const tip={formatter:(v:unknown,n:unknown)=>[fmt(Number(v)),String(n)] as [string,string],contentStyle:tooltipStyle};
 const rows=chart.categories.map((c,i)=>Object.fromEntries([['name',c],...chart.series.map(s=>[s.name,s.values[i]])]));
 const empty=!chart.categories.length&&!chart.points.length;
 const yAxis=<YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(v:number)=>compact.format(v)}/>;
 const xAxis=<XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{stroke:'#dce5ea'}} minTickGap={10} interval="preserveStartEnd"/>;
 const grid=<CartesianGrid stroke="#edf2f5" vertical={false}/>;
 const legend=chart.series.length>1?<Legend wrapperStyle={{fontSize:11}} iconSize={9}/>:null;
 let plot:React.ReactElement|null=null;
 if(empty||type==='table')plot=null;
 else if(type==='pie'||type==='donut'){
  const slices=chart.categories.map((c,i)=>({name:c,value:chart.series[0].values[i]}));
  plot=<PieChart><Pie data={slices} dataKey="value" nameKey="name" innerRadius={type==='donut'?'52%':0} outerRadius="80%" paddingAngle={type==='donut'?1:0} stroke="#fff">{slices.map((s,i)=><Cell key={s.name} fill={colour(s.name,i)}/>)}</Pie><Tooltip {...tip}/><Legend wrapperStyle={{fontSize:11}} iconSize={9}/></PieChart>;
 }
 else if(type==='bubble'){
  const pts=chart.points.map(p=>({...p,z:p.size}));
  plot=<ScatterChart margin={{top:10,right:16,bottom:10,left:0}}><CartesianGrid stroke="#edf2f5"/><XAxis type="number" dataKey="x" name={chart.axes?.x} tick={axisTick} tickFormatter={(v:number)=>compact.format(v)} label={{value:chart.axes?.x,position:'insideBottom',offset:-4,fontSize:11,fill:'#637c8a'}}/><YAxis type="number" dataKey="y" name={chart.axes?.y} tick={axisTick} width={52} tickFormatter={(v:number)=>compact.format(v)}/><ZAxis type="number" dataKey="z" range={[90,1400]} name={chart.axes?.size}/><Tooltip cursor={{strokeDasharray:'3 3'}} contentStyle={tooltipStyle} formatter={(v:unknown,n:unknown)=>[compact.format(Number(v)),String(n)] as [string,string]} labelFormatter={()=>''}/><Scatter data={pts} fillOpacity={0.75}>{pts.map((p,i)=><Cell key={p.label} fill={colour(p.label,i)}/>)}</Scatter></ScatterChart>;
 }
 else if(type==='line')plot=<LineChart data={rows} margin={{top:8,right:8,bottom:0,left:0}}>{grid}{xAxis}{yAxis}<Tooltip {...tip}/>{legend}{chart.series.map((s,i)=><Line key={s.name} type="monotone" dataKey={s.name} stroke={colour(s.name,i)} strokeWidth={2} dot={rows.length<=24?{r:2}:false}/>)}</LineChart>;
 else if(type==='area')plot=<AreaChart data={rows} margin={{top:8,right:8,bottom:0,left:0}}>{grid}{xAxis}{yAxis}<Tooltip {...tip}/>{legend}{chart.series.map((s,i)=><Area key={s.name} type="monotone" dataKey={s.name} stackId={chart.series.length>1?'a':undefined} stroke={colour(s.name,i)} fill={colour(s.name,i)} fillOpacity={0.25}/>)}</AreaChart>;
 else if(type==='hbar')plot=<BarChart data={rows} layout="vertical" margin={{top:4,right:12,bottom:0,left:0}}><CartesianGrid stroke="#edf2f5" horizontal={false}/><XAxis type="number" tick={axisTick} tickLine={false} tickFormatter={(v:number)=>compact.format(v)}/><YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={104} interval={0}/><Tooltip {...tip} cursor={{fill:'#e7f4ed'}}/>{chart.series.map((s,i)=><Bar key={s.name} dataKey={s.name} fill={colour(s.name,i)} radius={[0,3,3,0]} maxBarSize={20}/>)}</BarChart>;
 else plot=<BarChart data={rows} margin={{top:8,right:8,bottom:0,left:0}}>{grid}{xAxis}{yAxis}<Tooltip {...tip} cursor={{fill:'#e7f4ed'}}/>{legend}{chart.series.map((s,i)=><Bar key={s.name} dataKey={s.name} stackId={type==='stacked'?'a':undefined} fill={chart.series.length===1&&type!=='stacked'?'#007a53':colour(s.name,i)} radius={type==='stacked'?undefined:[3,3,0,0]} maxBarSize={type==='clustered'?18:32}/>)}</BarChart>;
 const height=type==='hbar'?Math.max(140,chart.categories.length*28+40):type==='pie'||type==='donut'?260:type==='bubble'?280:230;
 const longTable=chart.table.rows.length>12;
 const table=<div className="asst-table"><table><thead><tr>{chart.table.columns.map((c,i)=><th key={c+i} className={i?'num':''}>{c}</th>)}</tr></thead><tbody>{chart.table.rows.map((r,ri)=><tr key={ri}>{r.map((c,ci)=><td key={ci} className={ci?'num':''}>{ci?c:<b>{c}</b>}</td>)}</tr>)}</tbody></table></div>;
 return <>
  {plot&&<div className="asst-chart-plot"><ResponsiveContainer width="100%" height={height}>{plot}</ResponsiveContainer></div>}
  {type==='bubble'&&chart.points.length>0&&<ul className="asst-legend">{chart.points.map((p,i)=><li key={p.label}><i style={{background:colour(p.label,i)}}/>{p.label}</li>)}</ul>}
  {chart.table.rows.length>0&&(longTable&&plot?<details className="asst-chart-data"><summary><Table2 size={13}/> Data table ({chart.table.rows.length} rows)</summary>{table}</details>:table)}
 </>;
}
