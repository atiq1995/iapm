import {fitCrow,sum} from './domain';
export type ValidationModel={name:string,prediction:number|null,assumption:string};
const mean=(a:number[])=>sum(a)/a.length;
const normalCDF=(x:number)=>{const t=1/(1+.2316419*Math.abs(x));const q=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?1-q:q;};
function optimize(f:(x:number,y:number)=>number,x:number,y:number){let score=f(x,y),step=1;for(let i=0;i<120;i++){let improved=false;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]){const a=x+dx*step,b=y+dy*step;if(Math.abs(a)>8||Math.abs(b)>8)continue;const s=f(a,b);if(s>score){x=a;y=b;score=s;improved=true;}}if(!improved)step*=.5;if(step<1e-5)break;}return [x,y];}
export function validationModels(times:number[],T:number,renewal=false):ValidationModel[]{
 if(T<=0)return [];
 const trainT=T*.7,train=times.filter(t=>t>0&&t<=trainT).sort((a,b)=>a-b),n=train.length,h=T-trainT,c=fitCrow(train,trainT);
 const output:ValidationModel[]=[{name:'Crow–AMSAA',prediction:c?c.lambda*(T**c.beta-trainT**c.beta):null,assumption:'NHPP power law; training-only maximum likelihood'},{name:'HPP',prediction:n? n/trainT*h:null,assumption:'Constant recurrence rate; training-only maximum likelihood'}];
 // Profile MLE solves E(t | event in observation window) = mean observed event time.
 let lo=-30/trainT,hi=30/trainT;const target=n?mean(train):0;
 const moment=(b:number)=>Math.abs(b*trainT)<1e-5?trainT/2:trainT/(1-Math.exp(-b*trainT))-1/b;
 for(let i=0;i<100;i++){const m=(lo+hi)/2;if(moment(m)<target)lo=m;else hi=m;}
 const b=(lo+hi)/2;const integral=(a:number,z:number)=>Math.abs(b)<1e-8?z-a:(Math.exp(b*z)-Math.exp(b*a))/b;
 output.push({name:'Log-linear NHPP',prediction:n>=3?n*integral(trainT,T)/integral(0,trainT):null,assumption:'Unbinned profile maximum likelihood; includes event-free exposure'});
 // Gamma prior on expected training count q; Gaussian prior on log shape.
 // Integrate shape on a fixed dense grid instead of an undiagnosed single MCMC chain.
 const logTimes=sum(train.map(t=>Math.log(t/trainT)));const grid=Array.from({length:401},(_,i)=>{const lb=-3+i*6/400,beta=Math.exp(lb);return {beta,log:n*lb+(beta-1)*logTimes-.5*(lb/.5)**2};});const max=Math.max(...grid.map(g=>g.log));let weight=0,predict=0;for(const g of grid){const w=Math.exp(g.log-max);weight+=w;predict+=w*(n+1)/1.1*((T/trainT)**g.beta-1);}
 output.push({name:'Bayesian Crow–AMSAA',prediction:n>=3?predict/weight:null,assumption:'Quadrature posterior mean; log β ~ N(0,0.5²), training count q ~ Gamma(1,0.1). No interval claim; prior differs from source.'});
 const gaps=train.map((t,i)=>t-(train[i-1]||0));const censored=trainT-(train.at(-1)||0);const valid=n>=5&&gaps.every(g=>g>0);const logs=gaps.map(Math.log);const mu=valid?mean(logs):0;const sd=valid?Math.max(.1,Math.sqrt(mean(logs.map(x=>(x-mu)**2)))):1;
 for(const type of ['Weibull','Lognormal']){
 let prediction:number|null=null;let detail='Enable renewal assumption after engineering review; requires ≥5 positive gaps.';
 if(renewal&&valid){const fit=type==='Weibull'?optimize((lk,le)=>{const k=Math.exp(lk),e=Math.exp(le);return sum(gaps.map(g=>lk-k*le+(k-1)*Math.log(g)-(g/e)**k))-(censored/e)**k;},Math.log(1.5),Math.log(mean(gaps))):optimize((m,ls)=>{const s=Math.exp(ls);return sum(logs.map(l=>-ls-l-.5*((l-m)/s)**2))+(censored>0?Math.log(Math.max(1e-300,1-normalCDF((Math.log(censored)-m)/s))):0);},mu,Math.log(sd));
 let state=91827;const rnd=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
 const cdf=(t:number)=>type==='Weibull'?1-Math.exp(-((t/Math.exp(fit[1]))**Math.exp(fit[0]))):normalCDF((Math.log(Math.max(t,1e-12))-fit[0])/Math.exp(fit[1]));
 const quantile=(u:number)=>{if(type==='Weibull')return Math.exp(fit[1])*(-Math.log1p(-u))**(1/Math.exp(fit[0]));let l=-10,r=10;for(let j=0;j<50;j++){const m=(l+r)/2;if(normalCDF(m)<u)l=m;else r=m;}return Math.exp(fit[0]+Math.exp(fit[1])*(l+r)/2);};
 let count=0;const fAge=Math.min(1-1e-12,cdf(censored));for(let j=0;j<2000;j++){let t=quantile(fAge+(1-fAge)*rnd())-censored;for(let k=0;t<=h&&k<10000;k++){count++;t+=quantile(rnd());}}
 prediction=count/2000;detail='As-good-as-new iid gaps; right-censored final gap included; 2,000 seeded renewal paths conditional on current age. Simulation mean, not exact.';
 }
 output.push({name:type+' renewal',prediction,assumption:detail});
 }
 return output;
}
