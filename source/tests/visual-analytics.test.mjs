import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const dir=path.resolve('.sites-runtime/visual-tests');await fs.mkdir(dir,{recursive:true});
for(const [src,name] of [['lib/domain.ts','domain'],['lib/risk-feedback.ts','risk-feedback'],['lib/criticality.ts','criticality'],['lib/visual-analytics.ts','visual-analytics'],['lib/utils.ts','utils'],['components/ui/button.tsx','button'],['components/executive-analytics.tsx','executive-analytics']]){let s=await fs.readFile(src,'utf8');s=s.replace(/(['"])@\/lib\/([^'"]+)\1/g,"'./$2.mjs'").replace(/(['"])\.\/([^'".]+)\1/g,"'./$2.mjs'").replace("'@/components/ui/button'","'./button.mjs'");await fs.writeFile(`${dir}/${name}.mjs`,ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
const {seed,filtered,defaultFilters}=await import(`${dir}/domain.mjs`),{factsFor,groupFacts,trendData,bucketYear,intervalSize,VISUALS,METRICS}=await import(`${dir}/visual-analytics.mjs`),{VisualCanvas,ExecutiveAnalytics}=await import(`${dir}/executive-analytics.mjs`);
const data=seed(),facts=factsFor(data,filtered(data,defaultFilters));
assert.equal(VISUALS.length,32);assert.equal(new Set(VISUALS.map(x=>x[0])).size,32);
for(let y=1990;y<=2026;y++){const records=data.incidents.filter(e=>+e.date.slice(0,4)===y);assert.equal(new Set(records.map(e=>data.assets.find(a=>a.id===e.assetId).site)).size,4);assert.equal(new Set(records.map(e=>data.assets.find(a=>a.id===e.assetId).category)).size,4);}
assert.ok(data.incidents.every(e=>+e.date.slice(0,4)>=data.assets.find(a=>a.id===e.assetId).commissioned));
assert.ok(data.incidents.every(e=>e.date<'2026-10-01'));
assert.equal(bucketYear(2026,1990,2026,5),'2025–2026');assert.equal(bucketYear(1998,1991,2026,7),'1998–2004');assert.equal(intervalSize(NaN),1);assert.equal(intervalSize(0),1);assert.equal(intervalSize(100),37);
for(const metric of Object.keys(METRICS)){const total=facts.reduce((s,f)=>s+f[metric],0);for(const dim of ['site','category','year','asset'])assert.ok(Math.abs(groupFacts(facts,dim).reduce((s,g)=>s+g[metric],0)-total)<.1);for(const n of [1,5,7,37]){const t=trendData(facts,1990,2026,n,'year','category','site',metric);assert.equal(t.rows.length,Math.ceil(37/n));assert.ok(Math.abs(t.rows.reduce((s,r)=>s+t.series.reduce((v,k)=>v+r[k.key],0),0)-total)<.1);}}
assert.equal(factsFor(data,[data.incidents[0],data.incidents[0]]).length,1);assert.equal(factsFor(data,[{...data.incidents[0],status:'Draft'}]).length,0);
const f2=facts.filter(f=>f.impact==='F2');assert.ok(f2.every(f=>f.loss===0&&f.production===0&&f.days===0&&f.events===0));assert.ok(f2.some(f=>!f.exposureKnown));
assert.equal(trendData([],1990,2026,5,'year','category','site','loss').rows.length,8);
for(const [type] of VISUALS){const html=renderToStaticMarkup(React.createElement(VisualCanvas,{type,facts,dimension:'category',metric:'loss',xMetric:'events',split:'site',legend:'category',interval:5,filters:defaultFilters,openAsset:()=>{}}));assert.ok(html.length>20,`${type} renders`);assert.ok(!html.includes('NaN'),`${type} has finite geometry`);const empty=renderToStaticMarkup(React.createElement(VisualCanvas,{type,facts:[],dimension:'year',metric:'loss',xMetric:'events',split:'site',legend:'category',interval:5,filters:defaultFilters,openAsset:()=>{}}));assert.ok(empty.includes('No approved evidence'));}
const page=renderToStaticMarkup(React.createElement(ExecutiveAnalytics,{data,rows:[],filters:defaultFilters,uncertainty:1.3,openAsset:()=>{}}));assert.ok(page.includes('Visual analysis workbench'));
console.log('PASS: 37 years × 4 sites/categories; all metric totals; custom/5/1-year buckets; approval/deduplication; F1/F2 separation; 32 visual render paths and empty states.');
