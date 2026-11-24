'use client';
// Charts shown under a Relia answer: trends (per year/month) and rankings (bar chart + table).
// Data comes from the read-only tools, never from the model.
import {ResponsiveContainer,BarChart,Bar,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,Cell} from 'recharts';
import {ChartNoAxesCombined,ArrowUpRight,Table2} from 'lucide-react';
import type {AssistantVisual,RankingChart,TrendChart} from '@/lib/assistant/tools';

const compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
const full=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:1});
// Executive figures: $271.1M, 3,846 hours, 590.7 days.
export const show=(n:number,unit:string)=>unit==='USD'?(Math.abs(n)>=1e6?`$${compact.format(n)}`:`$${Math.round(n).toLocaleString('en-US')}`):`${full(n)} ${unit}`;
const axisTick={fontSize:11,fill:'#637c8a'};
const tooltipStyle={fontSize:12,borderRadius:6,border:'1px solid #dce5ea'};

type Actions={onOpenOverview?:()=>void,onOpenAsset?:(id:string)=>void};

export function AssistantChart({chart,...actions}:{chart:AssistantVisual}&Actions){
 return <figure className="asst-chart" aria-label={chart.title}>
  <figcaption><ChartNoAxesCombined size={15}/><span>{chart.title}</span></figcaption>
  {chart.kind==='trend'?<Trend chart={chart}/>:<Ranking chart={chart} onOpenAsset={actions.onOpenAsset}/>}
  {(actions.onOpenOverview||(chart.kind==='trend'&&chart.filters.asset&&actions.onOpenAsset))&&<div className="asst-chart-actions">
   {actions.onOpenOverview&&<button type="button" onClick={actions.onOpenOverview}>Open in Executive overview <ArrowUpRight size={13}/></button>}
   {chart.kind==='trend'&&chart.filters.asset&&actions.onOpenAsset&&<button type="button" onClick={()=>actions.onOpenAsset!(chart.filters.asset)}>Open asset <ArrowUpRight size={13}/></button>}
  </div>}
 </figure>;
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
