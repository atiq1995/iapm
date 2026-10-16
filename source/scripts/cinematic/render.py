from PIL import Image,ImageDraw,ImageFont
import json,math,subprocess,textwrap
from pathlib import Path
import numpy as np
from scipy.io.wavfile import write
P=Path(__file__).parent;F=P;W,H=1920,1080;fps=24
scenes=json.loads((F/'scenes.json').read_text());curves=json.loads((F/'curves.json').read_text());starts=[0,8,19,31,44,55,67,79];green=(92,236,188);white=(244,248,249);cyan=(94,211,244)
imgs=[Image.open(P/f'{x}.png').convert('RGB') for x in ['archive','refinery','twin']];fonts={}
def font(size,bold=False):
 k=(size,bold)
 if k not in fonts:fonts[k]=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans'+('-Bold' if bold else '')+'.ttf',size)
 return fonts[k]
def text(d,pos,s,size=32,c=white,bold=False):d.text(pos,s,font=font(size,bold),fill=c)
def rect(d,b,fill,r=16):d.rounded_rectangle(b,radius=r,fill=fill)
def title(im,lines,sub,alpha=1,y=225):
 lay=Image.new('RGBA',(W,H));d=ImageDraw.Draw(lay)
 for j,s in enumerate(lines):text(d,(100,y+j*90),s,72,white if j==0 else green,True)
 text(d,(105,y+len(lines)*90+26),sub,25,(200,219,226))
 if alpha<1:lay.putalpha(lay.getchannel('A').point(lambda a:int(a*alpha)))
 return Image.alpha_composite(im,lay)
def backdrop(ix,local,shot):
 src=imgs[ix];sw,sh=src.size;z=1.03+.13*local;z+=.14 if shot%3==1 else 0;cw=sw/z;ch=cw*H/W
 if ch>sh:ch=sh;cw=ch*W/H
 px=[.1,.7,.35,.55][shot%4];py=[.4,.6,.25,.5][shot%4];x=(sw-cw)*(px+.12*math.sin(local*1.5));y=(sh-ch)*py
 return src.transform((W,H),Image.Transform.EXTENT,(x,y,x+cw,y+ch),Image.Resampling.BICUBIC).convert('RGBA')
# Translucent cinematic grade, preserving image highlights on the right.
a=np.zeros((H,W,4),dtype=np.uint8);a[:,:,:3]=[3,12,24]
for x in range(W):a[:,x,3]=int(155*(1-x/W)**1.7+25)
shade=Image.fromarray(a)
# Scene art montage: deliberate changes of camera scale every 4 seconds.
def makeframe(t):
 i=max(j for j,s in enumerate(starts) if t>=s);u=t-starts[i];dur=scenes[i]['dur'];shot=int(u/4);frac=(u%4)/4;ix=[0,0,1,1,2,2,2,1][i];im=backdrop(ix,frac,shot+i);im=Image.alpha_composite(im,shade)
 particles=Image.new('RGBA',(W,H));pd=ImageDraw.Draw(particles)
 for j in range(38):
  p=(t*.07+j*.037)%1;x=int(W*p);y=int(700+130*math.sin(p*5+j*.43));al=int(90+70*math.sin(p*math.pi));pd.line((x-24,y+3,x,y),fill=(82,218,229,al),width=2)
 im=Image.alpha_composite(im,particles);d=ImageDraw.Draw(im)
 text(d,(100,99),'iAPM',35,green,True);text(d,(1500,109),'RELIABILITY INTELLIGENCE',14,(206,224,231))
 alpha=min(1,u/0.6)
 if i==0:im=title(im,['Hidden history.','Extraordinary potential.'],'FROM UNTAPPED EVIDENCE TO BUSINESS VALUE',alpha)
 if i==1:
  im=title(im,['Every source.','One intelligence stream.'],'HISTORICAL KNOWLEDGE + ONGOING SIGNALS',alpha)
  tags=['SCANNED PDF','OPERATOR LOGS','MAINTENANCE','RIR / INSPECTION','DCS / HISTORIAN','SCADA / SENSORS','CMMS / SAP']
  d=ImageDraw.Draw(im)
  for j,l in enumerate(tags):
   if u>j*.35:text(d,(105+(j%3)*510,620+(j//3)*68),l,23,cyan,True)
 if i==2:
  im=title(im,['The reliability','data refinery.'],'EXTRACT   /   VALIDATE   /   STRUCTURE   /   CONNECT',alpha,y=230)
  d=ImageDraw.Draw(im);text(d,(105,610),'ISO 14224-aligned reliability fields',32,green,True);text(d,(105,668),'Asset identity. Provenance. Engineering review.',24,white)
 if i==3:
  names=[('Reliability.','Distilled.'),('Find the few.','Focus the effort.'),('See the patterns.','Act on the evidence.')];ls=names[min(2,int(u/4.4))];im=title(im,ls,'PREMIUM INTELLIGENCE FROM CRUDE DATA',alpha)
  d=ImageDraw.Draw(im)
  products=['MTBF  •  FAILURE TRENDS','BAD-ACTOR PARETO  •  CRITICALITY','FAILURE MODES  •  SITE & CATEGORY INSIGHTS']
  for j,l in enumerate(products):text(d,(105,590+j*66),l,27,green if j==int(u/4.4) else white,True)
 if i==4:
  im=title(im,['Understand the lifecycle.','Intervene with purpose.'],'ASSET-CENTRIC MEDFI RELIABILITY INCIDENT REPORTING',alpha,y=205);d=ImageDraw.Draw(im)
  for j,(a,b) in enumerate([('M Δ E','Asset + environment'),('D','Damage'),('F','Failure'),('I','Impact')]):
   x=105+j*420;act=min(3,int(u/2.5));text(d,(x,575),a,65,green if j<=act else white,True);text(d,(x,662),b,23,white)
   if j<3:d.line((x+170,619,x+352,619),fill=cyan,width=2)
  text(d,(105,755),'ROOT CAUSE   /   CORRECTIVE ACTION   /   VERIFIED INTERVENTION',22,cyan)
 if i==5:
  im=title(im,['New evidence.','A new forecast.'],'CROW–AMSAA   /   WEIBULL   /   BAYESIAN',alpha,y=205);d=ImageDraw.Draw(im)
  c=curves[min(2,int(u/4))];vals=[f['failures'] for f in c['forecasts']];mx=max(v['failures'] for c in curves for v in c['forecasts']);pts=[(105+j*80,780-v/mx*230) for j,v in enumerate(vals)];count=max(2,min(15,int(u*5)));d.line(pts[:count],fill=green,width=5)
  text(d,(105,812),'RIR  →  RELIABILITY  →  FUTURE LOSS  →  CASH FLOW',24,white,True);text(d,(1300,760),'ILLUSTRATIVE SCENARIO',16,white)
 if i==6:
  # Editorial insert: real calculated economic curves, kept legible over the conceptual scene.
  dim=Image.new('RGBA',(W,H),(0,10,22,130));im=Image.alpha_composite(im,dim);d=ImageDraw.Draw(im);text(d,(105,194),'Economic health. Continuously.',57,white,True)
  state=min(2,int(u/4));cc=curves[state]
  for j,(key,label,scale) in enumerate([('npv','NPV · USD m',1e6),('irr','IRR · %',.01),('pb','PAYBACK · years',1),('pi','PROFITABILITY INDEX',1)]):
   x=105+(j%2)*865;y=295+(j//2)*235;rect(d,(x,y,x+800,y+210),(6,26,42,210));text(d,(x+25,y+20),label,25,white,True);vals=[None if r[key] is None else r[key]/scale for r in cc['timing']];pool=[r[key]/scale for c in curves for r in c['timing'] if r[key] is not None];lo=min(0,min(pool));hi=max(pool);pts=[]
   for k,v in enumerate(vals):
    if v is not None:pts.append((x+65+k*49,y+163-(v-lo)/(hi-lo)*104))
   if len(pts)>1:d.line(pts,fill=green if j%2==0 else cyan,width=4)
   text(d,(x+26,y+160),f'{lo:.1f}',15,white);text(d,(x+26,y+62),f'{hi:.1f}',15,white);text(d,(x+65,y+185),'2026',14,white);text(d,(x+703,y+185),'2040',14,white)
  best=cc['best'];text(d,(105,817),f"REPLACEMENT REVIEW  /  {best['year'] if best else 'KEEP & MONITOR'}",31,green,True);text(d,(1060,827),'Common horizon • scenario assumptions apply',18,white)
 if i==7:
  im=title(im,['Refine your evidence.','Redefine your decisions.'],'iAPM  /  INTELLIGENT ASSET PERFORMANCE MANAGEMENT',alpha,y=230);d=ImageDraw.Draw(im)
  text(d,(105,612),'EXPERIENCE THE SIMULATION',31,green,True);text(d,(105,675),'Today: transparent reliability and economic decision support.',23,white);text(d,(105,719),'Next: governed live integration and validated AI/ML.',23,white)
 d=ImageDraw.Draw(im);d.rectangle((0,0,W,64),fill=(0,0,0));d.rectangle((0,932,W,H),fill=(0,0,0))
 # compact synchronized two-line captions in cinematic letterbox
 for j,s in enumerate(scenes):
  if j!=i:continue
  speed=s['audio']['duration']/(s['dur']-.65);words=[w for w in s['audio']['word_timestamps'] if not w['word'].startswith('<')]
  for k in range(0,len(words),7):
   g=words[k:k+7]
   if .2+g[0]['start']/speed<=u<=.2+g[-1]['end']/speed:
    cap=' '.join(w['word'] for w in g);tw=d.textlength(cap,font=font(31));text(d,((W-tw)/2,976),cap,31,white)
 fade=min(1,u/.24,(dur-u)/.24)
 if fade<1:im=Image.blend(Image.new('RGBA',(W,H),(0,0,0,255)),im,max(0,fade))
 return im.convert('RGB')
cmd=['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','24','-i','-','-an','-c:v','libx264','-preset','fast','-b:v','1650k','-maxrate','1800k','-bufsize','3600k','-pix_fmt','yuv420p',str(P/'visual.mp4')]
proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
for n in range(90*fps):
 im=makeframe(n/fps);proc.stdin.write(im.tobytes())
 if n in [96,24*23,24*58,24*72]:im.save(P/f'preview-{n}.jpg',quality=92)
 if n%240==0:print(f'Rendered {n//fps}/90 seconds',flush=True)
proc.stdin.close();assert proc.wait()==0
# Original instrumental atmosphere: evolving pads, restrained pulse and transition risers.
sr=48000;N=90*sr;t=np.arange(N)/sr;music=np.zeros(N);rng=np.random.default_rng(7)
chords=[[146.83,174.61,220],[116.54,146.83,174.61],[174.61,220,261.63],[130.81,164.81,196]]
for start in range(0,90,6):
 end=min(90,start+7);ind=(t>=start)&(t<end);tt=t[ind]-start;env=np.minimum(1,tt/1.3)*np.minimum(1,(end-start-tt)/1.5);wave=np.zeros(len(tt))
 for f in chords[(start//6)%4]:wave+=np.sin(2*np.pi*f*tt)*.35+np.sin(2*np.pi*(f*1.002)*tt)*.18+np.sin(2*np.pi*f/2*tt)*.16
 music[ind]+=wave*env*.05
for st in np.arange(0,90,.75):
 idx=(t>=st)&(t<st+.22);tt=t[idx]-st;music[idx]+=.055*np.sin(2*np.pi*(47*tt+2*(1-np.exp(-tt*20))))*np.exp(-tt*20)
for st in starts[1:]:
 idx=(t>=st-.65)&(t<st+.3);tt=t[idx]-(st-.65);music[idx]+=.018*rng.normal(size=len(tt))*np.sin(np.pi*tt/.95)**2
music*=np.minimum(1,t/3)*np.minimum(1,(90-t)/3);write(P/'score.wav',sr,np.stack([music,music*.94],axis=1).astype(np.float32))
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(P/'visual.mp4'),'-i',str(P.parents[1]/'public/iapm-data-refinery-90s.mp4'),'-i',str(P/'score.wav'),'-filter_complex','[1:a]loudnorm=I=-16:TP=-1.5:LRA=9[voice];[2:a]volume=0.65[bed];[voice][bed]amix=inputs=2:normalize=0,alimiter=limit=0.9[a]','-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','160k','-t','90','-movflags','+faststart',str(P/'iAPM_Cinematic_Promo_90s.mp4')],check=True)
print('Cinematic film complete',flush=True)
