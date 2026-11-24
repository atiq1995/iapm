'use client';
import {useEffect,useState} from 'react';
import {Bot} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ReliabilityAgent as GuidedAgent} from './reliability-agent';
import {AssistantChat,type AssistantStatus,type Conversation} from './assistant-chat';
import {DEFAULT_ASSISTANT_NAME} from '@/lib/assistant/config';
import type {Dataset,Assumptions,Incident} from '@/lib/domain';

const initialStatus:AssistantStatus={name:DEFAULT_ASSISTANT_NAME,connected:false,modelLabel:null,endpointHost:null,readOnly:true,engine:'guided',message:'Checking AI model connection…'};

export function ReliabilityAgent(props:{data:Dataset,assumptions:Assumptions,openAsset:(id:string)=>void,openIncident:(r:Incident)=>void,openEconomics:(id:string)=>void}){
 const [status,setStatus]=useState<AssistantStatus>(initialStatus),[conversations,setConversations]=useState<Conversation[]>([]),[guided,setGuided]=useState(false),[loadError,setLoadError]=useState('');
 useEffect(()=>{fetch('/api/assistant').then(async r=>{const j:{assistant?:AssistantStatus,conversations?:Conversation[],error?:string}=await r.json();if(!r.ok||!j.assistant)throw Error(j.error||'Assistant unavailable');setStatus(j.assistant);setConversations(j.conversations||[]);}).catch(e=>setLoadError((e as Error).message));},[]);
 const saved=(c:Conversation,s?:AssistantStatus)=>{setConversations(list=>[c,...list.filter(x=>x.id!==c.id)]);if(s)setStatus(s);};
 const name=status.name;
 return <div className="ai-bot">
  <div className="analytics-banner"><div><span className="visual-kicker">{name.toUpperCase()} · READ-ONLY RELIABILITY AI</span><h2>Meet {name}, your reliability AI.</h2><p>Natural-language answers · read-only database tools · every figure cited to its source record</p></div><Bot size={40}/></div>
  <div className="toolbar"><Button variant={!guided?'default':'outline'} onClick={()=>setGuided(false)}>Chat with {name}</Button><Button variant={guided?'default':'outline'} onClick={()=>setGuided(true)}>Guided calculations · no AI tokens</Button></div>
  {loadError&&<p className="callout amber">{loadError}. Refresh the page to retry.</p>}
  {guided?<GuidedAgent {...props}/>:<AssistantChat data={props.data} assumptions={props.assumptions} status={status} conversations={conversations} onSaved={saved}openAsset={props.openAsset} openIncident={props.openIncident}/>}
 </div>;
}
