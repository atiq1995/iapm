'use client';
// Trend chart shown under a Relia answer. Data comes from the trend tool, never from the model.
import {ResponsiveContainer,BarChart,Bar,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid} from 'recharts';
import {ChartNoAxesCombined,ArrowUpRight} from 'lucide-react';
import type {TrendChart} from '@/lib/assistant/tools';

const compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
const full=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:1});

export function AssistantChart({chart,onOpenOverview,onOpenAsset}:{chart:TrendChart,onOpenOverview?:()=>void,onOpenAsset?:()=>void}){
 const total=chart.points.reduce((s,p)=>s+p.value,0);
 const peak=chart.points.reduce((a,b)=>(b.value>a.value?b:a),chart.points[0]);
 const unit=chart.unit==='USD'?'USD':chart.unit;
 const bars=(chart.unit==='events'||chart.unit==='RIRs')&&chart.points.length<=60;
 const axis={tick:{fontSize:11,fill:'#637c8a'},tickLine:false,axisLine:{stroke:'#dce5ea'}};
 const tip={formatter:(v:unknown)=>[`${full(Number(v))} ${unit}`,chart.metric] as [string,string],contentStyle:{fontSize:12,borderRadius:6,border:'1px solid #dce5ea'}};
 return <figure className="asst-chart" aria-label={chart.title}>
  <figcaption><ChartNoAxesCombined size={15}/><span>{chart.title}</span></figcaption>
  <div className="asst-chart-stats">
   <span><small>Total</small><b>{full(total)} {unit}</b></span>
   {peak&&<span><small>Peak</small><b>{full(peak.value)} · {peak.period}</b></span>}
   <span><small>Periods</small><b>{chart.points.length} {chart.interval}s</b></span>
  </div>
  <div className="asst-chart-plot">
   <ResponsiveContainer width="100%" height={220}>
    {bars
     ?<BarChart data={chart.points} margin={{top:8,right:8,bottom:0,left:0}}><CartesianGrid stroke="#edf2f5" vertical={false}/><XAxis dataKey="period" {...axis} minTickGap={12}/><YAxis {...axis} width={44} allowDecimals={false} tickFormatter={(v:number)=>compact.format(v)}/><Tooltip {...tip} cursor={{fill:'#e7f4ed'}}/><Bar dataKey="value" fill="#007a53" radius={[3,3,0,0]} maxBarSize={28}/></BarChart>
     :<LineChart data={chart.points} margin={{top:8,right:8,bottom:0,left:0}}><CartesianGrid stroke="#edf2f5" vertical={false}/><XAxis dataKey="period" {...axis} minTickGap={16}/><YAxis {...axis} width={48} tickFormatter={(v:number)=>compact.format(v)}/><Tooltip {...tip}/><Line type="monotone" dataKey="value" stroke="#007a53" strokeWidth={2} dot={chart.points.length<=40?{r:2.5,fill:'#007a53'}:false} activeDot={{r:4}}/></LineChart>}
   </ResponsiveContainer>
  </div>
  {(onOpenOverview||onOpenAsset)&&<div className="asst-chart-actions">
   {onOpenOverview&&<button type="button" onClick={onOpenOverview}>Open in Executive overview <ArrowUpRight size={13}/></button>}
   {onOpenAsset&&<button type="button" onClick={onOpenAsset}>Open asset <ArrowUpRight size={13}/></button>}
  </div>}
 </figure>;
}
