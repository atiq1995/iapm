// Run only in developer console on your signed-in iAPM /workbench page.
// Read-only: no uploads, no API keys, no modifications. Allow multiple downloads.
(async()=>{
 const download=(name,blob)=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);};
 const get=async(path)=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error(`${path}: HTTP ${r.status}`);return r.json();};
 const data=await get('/api/data');
 const history=await get('/api/historical-rir');
 const chat=await get('/api/ai-chat');
 const usage=await get('/api/ai-usage');
 const files=[];
 for(const item of history.imports){const r=await fetch('/api/historical-rir?file='+encodeURIComponent(item.id),{credentials:'same-origin'});if(!r.ok)throw Error(`Missing source PDF ${item.id}: ${r.status}`);const blob=await r.blob();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==item.sha256)throw Error('PDF hash mismatch: '+item.id);const name=item.id+'.pdf';download(name,blob);files.push({id:item.id,key:item.key,name,sha256:hash,bytes:blob.size});}
 const snapshot={format:'iapm-handover-v1',exportedAt:new Date().toISOString(),data,history,chat,usage,files,limitations:['Chat API exposes latest 20 conversations; usage exposes current-month latest 100 ledger entries. Request full database export if additional older records exist.','Does not export passwords, active sessions, browser state or provider secrets.']};
 download('iapm-snapshot.json',new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));
 console.info('Export complete. Deliver snapshot JSON and every downloaded PDF to the deployment agent.');
})().catch(e=>console.error('EXPORT INCOMPLETE:',e));
