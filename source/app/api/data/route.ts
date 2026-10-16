import {identity,db,sameOrigin} from '@/lib/auth';
import {ownerData} from '@/lib/owner-data';
import {applyAssessment,criticalityLevel,validateACA} from '@/lib/criticality';
import {validateRecord} from '@/lib/validation';
const headers={'Cache-Control':'no-store'};

export async function GET(){try{const u=await identity();if(!u)return Response.json({error:'Session expired'},{status:401,headers});return Response.json(await ownerData(u.userId),{headers});}catch{return Response.json({error:'Data service unavailable'},{status:503,headers});}}
export async function POST(req:Request){try{const u=await identity();if(!u)return Response.json({error:'Session expired'},{status:401,headers});if(!sameOrigin(req))return Response.json({error:'Request rejected'},{status:403,headers});const raw=await req.text();if(raw.length>200000)return Response.json({error:'Payload too large'},{status:413,headers});let payload;try{payload=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400,headers});}let {kind,record}=payload;let assessmentExpectedRevision:number|undefined;if(!['assets','incidents','actions','scenarios','settings','criticality'].includes(kind)||!record)return Response.json({error:'Invalid record'},{status:400,headers});const data=await ownerData(u.userId);
 if(kind==='criticality'){
 const asset=data.assets.find(a=>a.id===record.id);if(!asset)return Response.json({error:'Asset not found'},{status:404,headers});
 if(!['draft','publish'].includes(record.intent))return Response.json({error:'Invalid assessment action'},{status:400,headers});
 if(record.expectedRevision!==(asset.aca?.revision||0))return Response.json({error:'Assessment changed in another session. Refresh before saving.'},{status:409,headers});
 const error=validateACA(record.assessment,record.intent==='publish');if(error)return Response.json({error},{status:400,headers});
 assessmentExpectedRevision=record.expectedRevision;const aca=applyAssessment(asset.aca,record.assessment,record.intent==='publish',u.email,new Date().toISOString());record={...asset,aca,criticality:criticalityLevel(aca,asset.criticality)};kind='assets';
 }else if(kind==='assets'){
 const old=data.assets.find(a=>a.id===record.id);record.aca=old?.aca;
 if(record.acaInput!==undefined){const error=validateACA(record.acaInput);if(error)return Response.json({error},{status:400,headers});record.aca=applyAssessment(old?.aca,record.acaInput,false,u.email,new Date().toISOString());delete record.acaInput;}
 record.criticality=criticalityLevel(record.aca,record.criticality);
 }
 const error=validateRecord(kind,record,data);if(error)return Response.json({error},{status:400,headers});
 if(kind==='incidents'){const old=data.incidents.find(e=>e.id===record.id);record.history=[...(old?.history||[]),`${new Date().toISOString()} ${u.email}: ${record.status}; stage ${record.stage}; impact ${record.impact}${record.parentId?'; progression from '+record.parentId:''}`];}
 const params=[u.userId+':'+kind+':'+record.id,u.userId,kind,JSON.stringify(record),Date.now()];
 const query='INSERT INTO records(id,owner,kind,body,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated=excluded.updated'+(assessmentExpectedRevision!==undefined?" WHERE COALESCE(json_extract(records.body,'$.aca.revision'),0)=?":'');
 if(assessmentExpectedRevision!==undefined)params.push(assessmentExpectedRevision);
 const written:any=await db().prepare(query).bind(...params).run();if(assessmentExpectedRevision!==undefined&&(written.meta?.changes??written.changes)===0)return Response.json({error:'Assessment changed in another session. Refresh before saving.'},{status:409,headers});return Response.json({ok:true,record},{headers});}catch{return Response.json({error:'Unable to save. Your input has been retained.'},{status:503,headers});}}
