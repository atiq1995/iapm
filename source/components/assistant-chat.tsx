'use client';
import {useEffect,useRef,useState} from 'react';
import {Bot,Send,Plus,MessageSquare,FileText,ArrowUpRight,Lock,Wrench,CircleCheck,CircleX,TriangleAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AssistantMarkdown} from './assistant-markdown';
import type {Dataset,Assumptions,Incident} from '@/lib/domain';

export type AssistantStatus={name:string,connected:boolean,modelLabel:string|null,endpointHost:string|null,readOnly:true,engine:'model'|'guided',message:string};
type Source={id:string,label:string,assetId:string,incidentId?:string};
type Message={role:'user'|'assistant',content:string,at?:string,sources?:Source[],steps?:{tool:string,summary:string,ok:boolean}[],warnings?:string[],engine?:'model'|'guided',model?:string,notice?:string};
export type Conversation={id:string,title:string,updatedAt:string,messages:Message[]};

const PROMPTS=['Which assets are driving our actual production losses?','Give me a full profile of SC-E-101.','Why does SC-E-101 keep failing? Show the recorded causes.','Which assets have the lowest MTBF?','Compare actual loss across sites from 2016 to 2025.','What is the replacement business case for SC-E-101?'];

type Reply={conversation?:Conversation,assistant?:AssistantStatus,error?:string};

export function AssistantChat(props:{data:Dataset,assumptions:Assumptions,status:AssistantStatus,conversations:Conversation[],onSaved:(c:Conversation,s?:AssistantStatus)=>void,openAsset:(id:string)=>void,openIncident:(r:Incident)=>void}){
 const {data,status,conversations}=props,name=status.name;
 const [current,setCurrent]=useState<Conversation|null>(null),[question,setQuestion]=useState(''),[pending,setPending]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),end=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[current?.messages.length,pending]);

 const findIncident=(id:string)=>data.incidents.find(e=>e.id===id)||data.incidents.find(e=>e.reference===id);
 const isKnown=(id:string)=>!!(findIncident(id)||data.assets.some(a=>a.id===id)||data.actions.some(a=>a.id===id));
 function openRecord(id:string,assetId?:string){const e=findIncident(id);if(e)return props.openIncident(e);const action=data.actions.find(a=>a.id===id);const asset=data.assets.find(a=>a.id===id)?.id||action?.assetId||assetId;if(asset)props.openAsset(asset);}

 async function ask(q:string){
  const text=q.trim();if(lock.current||text.length<2)return;lock.current=true;setBusy(true);setError('');setPending(text);setQuestion('');
  try{
   const r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:text,conversationId:current?.id,assumptions:props.assumptions})});
   const j:Reply=await r.json().catch(()=>({}));if(!r.ok||!j.conversation)throw Error(j.error||'The assistant could not answer. Please retry.');
   setCurrent(j.conversation);props.onSaved(j.conversation,j.assistant);
  }catch(e){setError((e as Error).message);setQuestion(text);}
  finally{setPending('');setBusy(false);lock.current=false;input.current?.focus();}
 }
 const fresh=()=>{setCurrent(null);setError('');setQuestion('');input.current?.focus();};

 return <div className="ai-chat-layout">
  <aside className="visual-card import-padding">
   <Button variant="outline" className="import-wide" disabled={busy} onClick={fresh}><Plus size={16}/> New conversation</Button>
   <div className="asst-status">
    <span className={'badge '+(status.connected?'green':'amber')}>{status.connected?'AI model attached':'Guided engine'}</span>
    <span className="badge"><Lock size={12}/>&nbsp;Read-only</span>
   </div>
   {status.connected&&<div className="asst-model">{status.modelLabel}</div>}
   <p className="fine">{status.message}</p>
   <div className="conversation-list">{conversations.map(c=><button type="button" disabled={busy} key={c.id} className={current?.id===c.id?'active':''} onClick={()=>{setCurrent(c);setError('');}}><MessageSquare size={15}/><span>{c.title}</span></button>)}</div>
   <small className="fine">{status.connected?`Your question and the records ${name} retrieves are sent to the attached model${status.endpointHost?' at '+status.endpointHost:''}. Conversations are saved to your account only.`:`No data leaves iAPM in guided mode. Conversations are saved to your account only.`}</small>
  </aside>

  <div className="visual-card ai-dialogue">
   {!current&&!pending&&<div className="ai-chat-empty">
    <div className="agent-icon"><Bot size={34}/></div>
    <h2>Ask {name} about your reliability evidence.</h2>
    <p>{name} reads your asset register, incident reports, actions and economics through read-only tools. Every figure comes from the iAPM calculation engine and links back to its source record.</p>
    <div className="agent-prompts">{PROMPTS.map(q=><button type="button" key={q} disabled={busy} onClick={()=>ask(q)}>{q}<ArrowUpRight size={13}/></button>)}</div>
   </div>}

   <div className="ai-messages" aria-live="polite">
    {current?.messages.map((m,i)=><article className={'ai-message '+m.role} key={i}>
     <div className="asst-head">{m.role==='user'?<b>You</b>:<><b>{name}</b><span className={'badge '+(m.engine==='model'?'green':'')}>{m.engine==='model'?'AI model'+(m.model?' · '+m.model:''):'Guided engine'}</span></>}{m.at&&<span>{new Date(m.at).toLocaleString()}</span>}</div>
     {m.role==='user'?<div className="ai-answer-text">{m.content}</div>:<AssistantMarkdown text={m.content} isKnown={isKnown} onCite={id=>openRecord(id,m.sources?.find(s=>s.id===id)?.assetId)}/>}
     {m.notice&&<p className="callout amber asst-note">{m.notice}</p>}
     {!!m.warnings?.length&&<div className="callout amber asst-note"><TriangleAlert size={14}/> {m.warnings.join(' ')}</div>}
     {!!m.steps?.length&&<details><summary><Wrench size={14}/> How {name} answered ({m.steps.length} read-only {m.steps.length===1?'query':'queries'})</summary><ul className="asst-steps">{m.steps.map((s,j)=><li key={j}>{s.ok?<CircleCheck size={13} className="asst-ok"/>:<CircleX size={13} className="asst-bad"/>}<code>{s.tool}</code><span>{s.summary}</span></li>)}</ul></details>}
     {!!m.sources?.length&&<details><summary><FileText size={14}/> Supporting records ({m.sources.length})</summary><div className="agent-source-list">{m.sources.map(s=><button type="button" key={s.id} onClick={()=>openRecord(s.incidentId||s.id,s.assetId)}>{s.label}</button>)}</div></details>}
    </article>)}
    {pending&&<article className="ai-message user pending"><div className="asst-head"><b>You</b></div><div className="ai-answer-text">{pending}</div></article>}
    {busy&&<div role="status" className="agent-loading">{name} is querying the reliability database…</div>}
    <div ref={end}/>
   </div>

   <form className="agent-composer" onSubmit={e=>{e.preventDefault();ask(question);}}>
    <label htmlFor="assistant-question">Ask {name}</label>
    <div>
     <textarea id="assistant-question" ref={input} rows={3} maxLength={2000} value={question} disabled={busy} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask(question);}}} placeholder={current?'Ask a follow-up question…':'Ask about losses, failures, MTBF, criticality, actions or replacement economics…'}/>
     <Button disabled={busy||question.trim().length<2} type="submit"><Send size={17}/> Send</Button>
    </div>
    <p className="fine">{name} is read-only: it cannot create, edit, approve or delete records. Enter sends, Shift+Enter adds a line. Check cited records before making engineering or capital decisions.</p>
    {error&&<p className="error" role="alert">{error}</p>}
   </form>
  </div>
 </div>;
}
