'use client';
import {useEffect,useRef,useState} from 'react';
import {Bot,Send,Plus,MessageSquare,FileText,ArrowUpRight,Lock,Wrench,CircleCheck,CircleX,TriangleAlert,ChartNoAxesCombined,Pencil,Trash} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AssistantMarkdown} from './assistant-markdown';
import {AssistantChart} from './assistant-chart';
import type {AssistantVisual} from '@/lib/assistant/tools';
import type {Filters} from '@/lib/domain';
import type {Dataset,Assumptions,Incident} from '@/lib/domain';

export type AssistantStatus={name:string,connected:boolean,modelLabel:string|null,endpointHost:string|null,readOnly:true,engine:'model'|'guided',message:string};
export type ReportSummary={id:string,name:string,type:string,updatedAt:string};
type Source={id:string,label:string,assetId:string,incidentId?:string};
type Message={role:'user'|'assistant',content:string,at?:string,sources?:Source[],steps?:{tool:string,summary:string,ok:boolean}[],warnings?:string[],engine?:'model'|'guided'|'calculated',designedBy?:'rules'|'model'|'saved',report?:{id:string,name:string},model?:string,notice?:string,charts?:AssistantVisual[]};
export type Conversation={id:string,title:string,updatedAt:string,messages:Message[]};

const PROMPTS=['Donut chart of actual loss by site','Stacked bar of failures per year by site','Compare Safa Coast vs Wadi North','Bubble chart of downtime vs loss by site','Line chart of loss per year by site','Why does SC-E-101 keep failing?'];

type Reply={conversation?:Conversation,assistant?:AssistantStatus,error?:string};

// Where an answer came from, in plain words.
function sourceBadge(m:Message){
 if(m.engine==='calculated')return {cls:'green',text:m.designedBy==='saved'?'Saved report · calculated from data':m.designedBy==='model'?'Calculated from data · chart chosen by AI':'Calculated from data'};
 if(m.engine==='model')return {cls:'green',text:'AI model'+(m.model?' · '+m.model:'')+' · verified'};
 return {cls:'',text:'Guided engine'};
}

export function AssistantChat(props:{data:Dataset,assumptions:Assumptions,status:AssistantStatus,conversations:Conversation[],reports:ReportSummary[],onReports:(r:ReportSummary[])=>void,onSaved:(c:Conversation,s?:AssistantStatus)=>void,openAsset:(id:string)=>void,openIncident:(r:Incident)=>void,openOverview?:(f:Partial<Filters>)=>void}){
 const {data,status,conversations,reports}=props,name=status.name;
 const [current,setCurrent]=useState<Conversation|null>(null),[question,setQuestion]=useState(''),[pending,setPending]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [renaming,setRenaming]=useState<string|null>(null),[newName,setNewName]=useState(''),[confirmDelete,setConfirmDelete]=useState<string|null>(null),[reportError,setReportError]=useState('');
 const lock=useRef(false),end=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[current?.messages.length,pending]);

 const findIncident=(id:string)=>data.incidents.find(e=>e.id===id)||data.incidents.find(e=>e.reference===id);
 const isKnown=(id:string)=>!!(findIncident(id)||data.assets.some(a=>a.id===id)||data.actions.some(a=>a.id===id));
 function openRecord(id:string,assetId?:string){const e=findIncident(id);if(e)return props.openIncident(e);const action=data.actions.find(a=>a.id===id);const asset=data.assets.find(a=>a.id===id)?.id||action?.assetId||assetId;if(asset)props.openAsset(asset);}

 async function ask(q:string,reportId?:string,label?:string){
  const text=q.trim();if(lock.current||(!reportId&&text.length<2))return;lock.current=true;setBusy(true);setError('');setPending(label||text);if(!reportId)setQuestion('');
  try{
   const r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(reportId?{reportId}:{question:text}),conversationId:current?.id,assumptions:props.assumptions})});
   const j:Reply=await r.json().catch(()=>({}));if(!r.ok||!j.conversation)throw Error(j.error||'The assistant could not answer. Please retry.');
   setCurrent(j.conversation);props.onSaved(j.conversation,j.assistant);
  }catch(e){setError((e as Error).message);if(!reportId)setQuestion(text);}
  finally{setPending('');setBusy(false);lock.current=false;input.current?.focus();}
 }
 const fresh=()=>{setCurrent(null);setError('');setQuestion('');input.current?.focus();};

 async function reportAction(payload:Record<string,unknown>){
  const r=await fetch('/api/assistant/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Unable to update saved reports.');
  const list=await fetch('/api/assistant/reports').then(x=>x.json()).catch(()=>null);
  if(list?.reports)props.onReports(list.reports);
  return j as {report?:ReportSummary,existing?:boolean};
 }
 async function saveChart(spec:unknown,reportName:string,q:string){const j=await reportAction({action:'save',name:reportName,spec,question:q});return j.report?.name||reportName;}
 async function rename(id:string){setReportError('');try{await reportAction({action:'rename',id,name:newName});setRenaming(null);}catch(e){setReportError((e as Error).message);}}
 async function remove(id:string){setReportError('');try{await reportAction({action:'delete',id});setConfirmDelete(null);}catch(e){setReportError((e as Error).message);}}

 return <div className="ai-chat-layout">
  <aside className="visual-card import-padding">
   <Button variant="outline" className="import-wide" disabled={busy} onClick={fresh}><Plus size={16}/> New conversation</Button>
   <div className="asst-status">
    <span className={'badge '+(status.connected?'green':'amber')}>{status.connected?'AI model attached':'Guided engine'}</span>
    <span className="badge"><Lock size={12}/>&nbsp;Read-only</span>
   </div>
   {status.connected&&<div className="asst-model">{status.modelLabel}</div>}
   <p className="fine">{status.message}</p>
   {reports.length>0&&<div className="asst-reports">
    <h3>Saved reports</h3>
    {reports.map(r=><div className="asst-report" key={r.id}>
     {renaming===r.id
      ?<form className="asst-report" style={{flex:1}} onSubmit={e=>{e.preventDefault();rename(r.id);}}><label htmlFor={`rename-${r.id}`} className="sr-only">New name</label><input id={`rename-${r.id}`} value={newName} maxLength={80} onChange={e=>setNewName(e.target.value)} autoFocus/><button type="submit" className="asst-icon" title="Save name"><CircleCheck size={14}/></button><button type="button" className="asst-icon" title="Cancel" onClick={()=>setRenaming(null)}><CircleX size={14}/></button></form>
      :confirmDelete===r.id
       ?<div className="asst-report-confirm">Delete “{r.name}”? <button type="button" onClick={()=>remove(r.id)}>Delete</button><button type="button" onClick={()=>setConfirmDelete(null)}>Keep</button></div>
       :<><button type="button" disabled={busy} onClick={()=>ask(r.name,r.id,r.name)} title={`Run ${r.name}`}><ChartNoAxesCombined size={14}/><span>{r.name}</span></button>
         <button type="button" className="asst-icon" title="Rename" onClick={()=>{setRenaming(r.id);setNewName(r.name);setConfirmDelete(null);}}><Pencil size={13}/></button>
         <button type="button" className="asst-icon" title="Delete" onClick={()=>{setConfirmDelete(r.id);setRenaming(null);}}><Trash size={13}/></button></>}
    </div>)}
    {reportError&&<p className="error" role="alert">{reportError}</p>}
   </div>}
   <div className="conversation-list">{conversations.map(c=><button type="button" disabled={busy} key={c.id} className={current?.id===c.id?'active':''} onClick={()=>{setCurrent(c);setError('');}}><MessageSquare size={15}/><span>{c.title}</span></button>)}</div>
   <small className="fine">{status.connected?`Your question and the records ${name} retrieves are sent to the attached model${status.endpointHost?' at '+status.endpointHost:''}. Charts are calculated in iAPM. Conversations and saved reports stay in your account.`:`No data leaves iAPM in guided mode. Conversations and saved reports stay in your account.`}</small>
  </aside>

  <div className="visual-card ai-dialogue">
   {!current&&!pending&&<div className="ai-chat-empty">
    <div className="agent-icon"><Bot size={34}/></div>
    <h2>Ask {name} about your reliability evidence.</h2>
    <p>Ask in plain English for any chart or report (pie, donut, bar, line, stacked, bubble or a side-by-side comparison) or for an explanation. Every figure is calculated from your records, and any chart can be saved as a report.</p>
    <div className="agent-prompts">{PROMPTS.map(q=><button type="button" key={q} disabled={busy} onClick={()=>ask(q)}>{q}<ArrowUpRight size={13}/></button>)}</div>
   </div>}

   <div className="ai-messages" aria-live="polite">
    {current?.messages.map((m,i)=>{
     const badge=sourceBadge(m);
     const asked=current.messages[i-1]?.content||'';
     return <article className={'ai-message '+m.role} key={i}>
      <div className="asst-head">{m.role==='user'?<b>You</b>:<><b>{name}</b><span className={'badge '+badge.cls}>{badge.text}</span></>}{m.at&&<span>{new Date(m.at).toLocaleString()}</span>}</div>
      {m.role==='user'?<div className="ai-answer-text">{m.content}</div>:<AssistantMarkdown text={m.content} isKnown={isKnown} onCite={id=>openRecord(id,m.sources?.find(s=>s.id===id)?.assetId)}/>}
      {m.charts?.map((c,j)=>{
       const spec=c.spec;
       const savedName=c.kind==='chart'&&m.report?m.report.name:undefined;
       return <AssistantChart key={j} chart={c}
        savedName={savedName}
        onSave={spec?(reportName=>saveChart(spec,reportName,asked)):undefined}
        onOpenOverview={props.openOverview?()=>props.openOverview!({site:c.filters.site||'All sites',category:c.filters.category||'All categories',asset:c.filters.asset||'All',mode:c.filters.mode||'All',from:c.filters.from,to:c.filters.to}):undefined}
        onOpenAsset={props.openAsset}/>;
      })}
      {m.notice&&<p className="callout amber asst-note">{m.notice}</p>}
      {!!m.warnings?.length&&<div className="callout amber asst-note"><TriangleAlert size={14}/> {m.warnings.join(' ')}</div>}
      {!!m.steps?.length&&<details><summary><Wrench size={14}/> How {name} answered ({m.steps.length} read-only {m.steps.length===1?'query':'queries'})</summary><ul className="asst-steps">{m.steps.map((s,j)=><li key={j}>{s.ok?<CircleCheck size={13} className="asst-ok"/>:<CircleX size={13} className="asst-bad"/>}<code>{s.tool}</code><span>{s.summary}</span></li>)}</ul></details>}
      {!!m.sources?.length&&<details><summary><FileText size={14}/> Supporting records ({m.sources.length})</summary><div className="agent-source-list">{m.sources.map(s=><button type="button" key={s.id} onClick={()=>openRecord(s.incidentId||s.id,s.assetId)}>{s.label}</button>)}</div></details>}
     </article>;
    })}
    {pending&&<article className="ai-message user pending"><div className="asst-head"><b>You</b></div><div className="ai-answer-text">{pending}</div></article>}
    {busy&&<div role="status" className="agent-loading">{name} is querying the reliability database…</div>}
    <div ref={end}/>
   </div>

   <form className="agent-composer" onSubmit={e=>{e.preventDefault();ask(question);}}>
    <label htmlFor="assistant-question">Ask {name}</label>
    <div>
     <textarea id="assistant-question" ref={input} rows={3} maxLength={2000} value={question} disabled={busy} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask(question);}}} placeholder={current?'Ask a follow-up, e.g. “make it a donut” or “show it as a table”…':'Ask for a chart, a comparison or an explanation…'}/>
     <Button disabled={busy||question.trim().length<2} type="submit"><Send size={17}/> Send</Button>
    </div>
    <p className="fine">{name} is read-only: it cannot create, edit, approve or delete records. Enter sends, Shift+Enter adds a line. Check cited records before making engineering or capital decisions.</p>
    {error&&<p className="error" role="alert">{error}</p>}
   </form>
  </div>
 </div>;
}
