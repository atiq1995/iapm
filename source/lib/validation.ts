import {exposureError} from './mtbf';
import {z} from 'zod';
import {CATEGORIES, STAGES, MODES, type Dataset} from './domain';
const text=z.string().trim().min(1).max(5000), amount=z.number().finite().nonnegative();
const date=z.string().refine(v=>Number.isFinite(Date.parse(v)),'Invalid date');
const prospective=z.object({enabled:z.boolean(),method:z.enum(['Manual','Historical']),manualLoss:amount,uncertainty:z.number().finite().min(0).max(10),probability:z.number().finite().min(0).max(1),horizonYears:z.number().finite().positive().max(50),basisYear:z.number().int().min(1900).max(2100),incremental:z.boolean(),rationale:z.string().max(5000),resolved:z.boolean()});
const base=z.object({id:text.max(100)});
export const assetSchema=base.extend({tag:text.max(100),description:text,site:text,unit:text,system:text,category:z.enum(CATEGORIES),service:text,commissioned:z.number().int().min(1900).max(2026),status:text,criticality:z.number().int().min(1).max(5),condition:z.number().int().min(1).max(5),owner:text,designLife:z.number().positive(),obsolescence:z.boolean(),efficiency:z.number().min(0).max(100)}).passthrough();
export const incidentSchema=base.extend({prospective:prospective.optional(),assetId:text,date,stage:z.string().refine(v=>STAGES.includes(v)),impact:z.enum(['F1','F2']),status:z.enum(['Draft','Submitted','Reviewed','Approved','Closed']),mode:z.string().refine(v=>MODES.includes(v)),mechanism:text,narrative:text,downtime:amount,repairHours:amount,loss:amount,maintenance:amount,activity:z.enum(['Corrective','Preventive']),nature:z.enum(['Forced','Low load','Opportunity']),owner:text,due:date,reference:z.string().max(200),cause:text,secondaryIds:z.array(text).max(128),quantity:z.array(amount).length(3),productDays:z.array(amount).length(3),history:z.array(z.string()),parentId:text.optional()}).passthrough();
export const actionSchema=base.extend({assetId:text,title:text,owner:text,due:date,status:z.enum(['Open','In progress','Pending approval','Approved','Verified complete']),horizon:z.enum(['Immediate','Short term','Long term','Strategic']),category:z.enum(['Replacement','Inspection','Maintenance','Reliability engineering','Business continuity']),evidence:text,benefit:amount,verification:z.string().max(5000)}).passthrough().refine(v=>v.status!=='Verified complete'||v.verification.trim().length>0,'Completion evidence required');
export const assumptionsSchema=z.object({evidenceMode:z.enum(["Working","Reviewed"]).optional(),evidenceThrough:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),year:z.number().int().min(2026).max(2100),horizon:z.number().int().min(1).max(50),wacc:z.number().min(0).max(1),inflation:z.number().min(0).max(1),capex:amount,effectiveness:z.number().min(0).max(1),maintenance:amount,inspection:amount,energy:amount,risk:amount,salvage:amount,disposal:amount,terminal:amount,designLife:z.number().positive().max(100),maturity:z.number().min(0).max(1),ramp:z.number().positive().max(50),fef:z.number().min(0).max(1),window:z.number().int().min(0).max(100),model:z.enum(['Crow–AMSAA','HPP','Manual']),beta:z.number().positive().max(5),rate:amount});
const scenarioSchema=base.extend({assetId:text,name:text,assumptions:assumptionsSchema}).passthrough();
export function validateRecord(kind:string,record:any,data:Dataset){
 const schema=kind==='assets'?assetSchema:kind==='incidents'?incidentSchema:kind==='actions'?actionSchema:kind==='scenarios'?scenarioSchema:base.passthrough();
 const parsed=schema.safeParse(record);if(!parsed.success)return parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ');
 if(kind==='assets'&&record.exposure){const error=exposureError(record.exposure,record.commissioned);if(error)return error;if(typeof record.exposure.verified!=='boolean')return 'Invalid exposure verification.';}
 if(kind==='assets'&&data.assets.some(a=>a.id!==record.id&&a.tag.toLowerCase()===record.tag.toLowerCase()))return 'Asset tag already exists.';
 if(['incidents','actions','scenarios'].includes(kind)&&!data.assets.some(a=>a.id===record.assetId))return 'Select an existing asset.';
 if(kind==='incidents'){
 if(record.prospective?.enabled&&(!record.prospective.incremental||!record.prospective.rationale.trim()))return 'Confirm incremental forward risk and document likelihood / consequence rationale.';
 const old=data.incidents.find(e=>e.id===record.id),states=['Draft','Submitted','Reviewed','Approved','Closed'];
 if(!old&&record.status!=='Draft')return 'New incidents must begin as Draft.';
 if(old&&record.status!==old.status&&states.indexOf(record.status)!==states.indexOf(old.status)+1)return 'Invalid workflow transition.';
 if(old&&['Approved','Closed'].includes(old.status)&&Object.keys(old).some(k=>!['history','status'].includes(k)&&JSON.stringify((old as any)[k])!==JSON.stringify(record[k])))return 'Approved evidence is immutable. Create a linked progression or correction.';
 if(record.impact==='F1'&&['M Delta E','D'].includes(record.stage))return 'Actual failure impact requires stage F or I.';
 if(record.impact==='F2'&&(record.loss!==0||record.downtime!==0||record.productDays.some((x:number)=>x!==0)||record.quantity.some((x:number)=>x!==0)))return 'F2 records cannot carry actual production loss or downtime.';
 if(Math.abs(Math.max(...record.productDays)-record.downtime)>1e-6)return 'Virtual downtime must equal the largest product-channel downtime.';
 if(Number(record.date.slice(0,4))<data.assets.find(a=>a.id===record.assetId)!.commissioned)return 'Incident predates asset commissioning.';
 if(record.secondaryIds.some((id:string)=>id===record.assetId||!data.assets.some(a=>a.id===id)))return 'Invalid secondary asset association.';
 if(record.parentId===record.id)return 'An incident cannot link to itself.';
 if(record.failureEvent!==undefined&&typeof record.failureEvent!=='boolean')return 'Invalid failure classification.';
 if(record.failureEvent&&!['F','I'].includes(record.stage))return 'Only F/I may count as functional failures.';
 if(record.parentId&&!data.incidents.some(e=>e.id===record.parentId&&e.assetId===record.assetId))return 'Linked predecessor must exist and belong to this asset.';
 if(record.parentId){const parent=data.incidents.find(e=>e.id===record.parentId)!;if(record.date<parent.date)return 'Progression cannot predate its predecessor.';if(STAGES.indexOf(record.stage)<=STAGES.indexOf(parent.stage))return 'Progression must advance to a later MEDFI stage.';}
 if(!old&&data.incidents.some(e=>e.assetId===record.assetId&&e.date===record.date&&e.mode===record.mode&&e.stage===record.stage))return 'Possible duplicate: asset, date and failure mode already exist.';
 }
 return null;
}
