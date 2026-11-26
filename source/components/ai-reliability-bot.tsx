'use client';
import {useEffect,useState} from 'react';
import {Bot} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ReliabilityAgent as GuidedAgent} from './reliability-agent';
import {AssistantChat,type AssistantStatus,type Conversation,type ReportSummary} from './assistant-chat';
import {DEFAULT_ASSISTANT_NAME} from '@/lib/assistant/config';
import type {Dataset,Assumptions,Incident,Filters} from '@/lib/domain';

const initialStatus:AssistantStatus={name:DEFAULT_ASSISTANT_NAME,connected:false,modelLabel:null,endpointHost:null,readOnly:true,engine:'guided',message:'Checking AI model connection…'};

export function ReliabilityAgent(props:{data:Dataset,assumptions:Assumptions,openAsset:(id:string)=>void,openIncident:(r:Incident)=>void,openEconomics:(id:string)=>void,openOverview?:(f:Partial<Filters>)=>void}){
 const [status,setStatus]=useState<AssistantStatus>(initialStatus),[conversations,setConversations]=useState<Conversation[]>([]),[reports,setReports]=useState<ReportSummary[]>([]),[guided,setGuided]=useState(false),[loadError,setLoadError]=useState('');
 useEffect(()=>{fetch('/api/assistant').then(async r=>{const j:{assistant?:AssistantStatus,conversations?:Conversation[],reports?:ReportSummary[],error?:string}=await r.json();if(!r.ok||!j.assistant)throw Error(j.error||'Assistant unavailable');setStatus(j.assistant);setConversations(j.conversations||[]);setReports(j.reports||[]);}).catch(e=>setLoadError((e as Error).message));},[]);
 const saved=(c:Conversation,s?:AssistantStatus)=>{setConversations(list=>[c,...list.filter(x=>x.id!==c.id)]);if(s)setStatus(s);};
 const name=status.name;
 return <div className="ai-bot">
  <div className="analytics-banner"><div><span className="visual-kicker">{name.toUpperCase()} · READ-ONLY RELIABILITY AI</span><h2>Meet {name}, your reliability AI.</h2><p>Charts, reports and comparisons on request · every figure calculated from your records · read-only</p></div><Bot size={40}/></div>
  <div className="toolbar"><Button variant={!guided?'default':'outline'} onClick={()=>setGuided(false)}>Chat with {name}</Button><Button variant={guided?'default':'outline'} onClick={()=>setGuided(true)}>Guided calculations · no AI tokens</Button></div>
  {loadError&&<p className="callout amber">{loadError}. Refresh the page to retry.</p>}
  {guided?<GuidedAgent {...props}/>:<AssistantChat data={props.data} assumptions={props.assumptions} status={status} conversations={conversations} reports={reports} onReports={setReports} onSaved={saved} openAsset={props.openAsset} openIncident={props.openIncident} openOverview={props.openOverview}/>}
 </div>;
}
