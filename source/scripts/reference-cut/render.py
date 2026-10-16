from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import subprocess, json, math, sys
import numpy as np

P=Path(__file__).parent
R=Path('/workspace/sites/reliability-intelligence')
A=R/'scripts/cinematic'
SOURCE=P.parent/'upload/Asset Performance Management Software from GE Vernova.mp4'
W,H,FPS=1280,720,24
WHITE=(240,248,250,255); GREEN=(83,236,178,255); CYAN=(90,213,244,255); MUTED=(177,200,211,255)
scenes=json.loads((A/'scenes.json').read_text()); curves=json.loads((A/'curves.json').read_text())
starts=[0,8,19,31,44,55,67,79]
# Original edit: time, duration, reference-source in point or original scene art.
shots=[(0,2,0),(2,2,4),(4,2,6),(6,2,'archive'),
 (8,3,19),(11,4,'archive'),(15,4,25),
 (19,6,'refinery'),(25,6,34),
 (31,4,41),(35,4,'twin'),(39,5,52),
 (44,5,103),(49,6,113),
 (55,5,120),(60,7,'twin'),
 (67,12,'twin'),(79,4,160),(83,3,178),(86,4,'refinery')]
fonts={}
def f(n,b=False):
 k=(n,b)
 if k not in fonts:fonts[k]=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans'+('-Bold' if b else '')+'.ttf',n)
 return fonts[k]
def txt(d,x,y,s,n=24,c=WHITE,b=False):d.text((int(x),int(y)),s,font=f(n,b),fill=c)
def center(d,x,y,s,n=24,c=WHITE,b=False):txt(d,x-d.textlength(s,font=f(n,b))/2,y,s,n,c,b)
def panel(d,box,fill=(5,23,36,225),outline=(89,182,192,90),r=10):d.rounded_rectangle(box,r,fill=fill,outline=outline,width=1)
def line(d,pts,c=CYAN,w=2):
 if len(pts)>1:d.line(pts,fill=c,width=w,joint='curve')
def ease(x):x=max(0,min(1,x));return x*x*(3-2*x)
def header(d,k,title,sub=None):
 txt(d,52,120,k.upper(),13,GREEN,True)
 txt(d,52,146,title,39,WHITE,True)
 if sub:txt(d,54,200,sub,18,MUTED)
def ring(d,x,y,r,t,color=CYAN):
 for j in range(3):
  rr=r+j*7;d.arc((x-rr,y-rr,x+rr,y+rr),t*35+j*100,t*35+j*100+225,fill=(*color[:3],180-j*40),width=2)
 for j in range(36):
  a=j*math.pi/18;rr=r+22
  line(d,[(x+rr*math.cos(a),y+rr*math.sin(a)),(x+(rr+5)*math.cos(a),y+(rr+5)*math.sin(a))],(*color[:3],100),1)
def plot(d,box,values,color=GREEN,progress=1,lo=None,hi=None):
 x,y,w,h=box;vs=[v for v in values if v is not None]
 if not vs:return
 lo=min(0,min(vs)) if lo is None else lo;hi=max(vs) if hi is None else hi
 for j in range(4):line(d,[(x,y+j*h/3),(x+w,y+j*h/3)],(114,160,180,35),1)
 pts=[]
 for j,v in enumerate(values):
  if v is not None and j/(len(values)-1)<=progress:pts.append((x+j*w/(len(values)-1),y+h-(v-lo)/max(.0001,hi-lo)*h))
 line(d,pts,(*color[:3],45),10);line(d,pts,color,3)
 if pts:d.ellipse((pts[-1][0]-4,pts[-1][1]-4,pts[-1][0]+4,pts[-1][1]+4),fill=WHITE)
 return lo,hi

arts={x:Image.open(A/f'{x}.png').convert('RGB') for x in ['archive','refinery','twin']}
shade=np.zeros((H,W,4),dtype=np.uint8);shade[:,:,:3]=[1,10,20]
for y in range(H):
 for x in range(W):shade[y,x,3]=int(max(130*(1-x/W)**2,120*max(0,1-y/180),220*max(0,(y-460)/260)))
shade=Image.fromarray(shade)

def overlay(im,t):
 i=max(j for j,v in enumerate(starts) if t>=v);u=t-starts[i]
 im=Image.alpha_composite(im.convert('RGBA'),shade)
 lay=Image.new('RGBA',(W,H));d=ImageDraw.Draw(lay)
 txt(d,52,31,'iAPM',29,GREEN,True)
 txt(d,157,39,'RELIABILITY INTELLIGENCE',11,WHITE,True)
 txt(d,1027,40,'CONCEPT FILM / 90s',11,MUTED)
 line(d,[(52,80),(1228,80)],(134,183,198,65),1)
 if i==0:
  if u<6:
   s=['Industrial scale.','Decades of experience.','Untapped intelligence.'][min(2,int(u/2))]
   txt(d,52,485,s,43,WHITE,True)
  else:
   txt(d,52,190,'Your next decision',42,WHITE,True);txt(d,52,244,'is buried in your history.',42,GREEN,True)
 if i==1:
  header(d,'01 / Discover','Connect every source.','Historical evidence meets ongoing asset signals.')
  labs=['Scanned PDF / PLR','Logs / shift notes','CMMS / SAP','Inspection / RIR','DCS / historian','SCADA / sensors']
  for j,l in enumerate(labs):
   if u>j*.35:
    x=54+(j%3)*390;y=443+(j//3)*53
    panel(d,(x,y,x+370,y+41));d.ellipse((x+15,y+17,x+21,y+23),fill=GREEN);txt(d,x+32,y+9,l,18)
 if i==2:
  header(d,'02 / Refine','The reliability data refinery.','Extract. Validate. Structure. Connect.')
  if u<6:
   for j,label in enumerate(['RAW EVIDENCE','ENGINEERING REVIEW','UNIFIED ASSET RECORD']):
    x=54+j*398;panel(d,(x,452,x+375,524));txt(d,x+18,463,f'0{j+1}',13,GREEN,True);txt(d,x+18,484,label,17,WHITE,True)
   for j in range(24):
    p=(u*.2+j*.043)%1;x=65+1150*p;y=377+25*math.sin(p*8)
    d.ellipse((x,y,x+4,y+4),fill=GREEN)
  else:
   panel(d,(53,422,730,535));txt(d,75,441,'ISO 14224-aligned reliability fields',25,GREEN,True)
   txt(d,75,483,'Asset identity  /  failure mode  /  exposure  /  consequence',17)
 if i==3:
  if u<4:
   header(d,'03 / Understand','Turn evidence into priorities.','Which assets matter most—and why?')
   ring(d,895,355,103,t)
   center(d,895,329,'ASSET',23);center(d,895,359,'CRITICALITY',22,GREEN,True)
  elif u<8:
   d.rectangle((0,90,W,586),fill=(3,16,28,225));header(d,'03 / Understand','Find the few. Focus the effort.','Bad-actor Pareto  /  MTBF  /  failure patterns')
   vals=[36,22,14,8,7,5,4,4];cum=0;pts=[]
   for j,v in enumerate(vals):
    x=87+j*94;hh=v*5*ease((u-4)*1.4)
    d.rounded_rectangle((x,494-hh,x+58,494),4,fill=GREEN if j<4 else (41,99,114,255))
    cum+=v;pts.append((x+29,494-cum*2.3*ease((u-4)*1.4)));txt(d,x+8,507,f'A{j+1}',13,MUTED)
   line(d,pts,CYAN,3);txt(d,881,297,'Prioritize losses.',26,WHITE,True);txt(d,881,344,'Verify exposure.',26,WHITE,True);txt(d,881,391,'Trace the causes.',26,WHITE,True)
   txt(d,881,464,'ILLUSTRATIVE DISTRIBUTION',11,MUTED)
  else:
   header(d,'03 / Understand','See the whole enterprise.','Asset categories. Site comparisons. Failure-mode trends.')
   for j,label in enumerate(['Equipment','Machinery','Instrumentation','Electrical']):
    x=54+j*297;panel(d,(x,455,x+276,526));txt(d,x+16,481,label,20,WHITE,True)
 if i==4:
  header(d,'03 / Understand','Manage the failure lifecycle.','Asset-centric MEDFI reliability incident reporting')
  panel(d,(742,244,1225,551),fill=(4,20,33,235))
  labels=[('M Δ E','Asset + environment'),('D','Damage'),('F','Functional failure'),('I','Business impact')]
  active=min(3,int(u/2.5))
  for j,(a,b) in enumerate(labels):
   y=266+j*65;width=155+j*48;x=1010-width/2
   d.polygon([(x+18,y),(x+width-18,y),(x+width,y+50),(x,y+50)],fill=(20,95,105,230) if j<=active else (21,42,56,235))
   center(d,1010,y+12,a,23,GREEN if j<=active else MUTED,True)
   txt(d,763,y+18,b,12,MUTED)
  txt(d,54,447,'Detect earlier.',30,GREEN,True);txt(d,54,487,'Intervene with purpose.',30,WHITE,True)
 if i==5:
  header(d,'04 / Predict & decide','Every RIR changes the outlook.','Crow–AMSAA  /  Weibull  /  Bayesian models')
  panel(d,(54,258,724,543),fill=(4,20,33,235));txt(d,75,274,'FORECAST FAILURE RECURRENCE',13,GREEN,True)
  state=min(2,int(u/4));v=[a['failures'] for a in curves[state]['forecasts']];mx=max(a['failures'] for c in curves for a in c['forecasts'])
  plot(d,(90,328,590,159),v,progress=ease((u%4)/1.3),hi=mx)
  txt(d,90,506,'2026',12,MUTED);txt(d,642,506,'2040',12,MUTED)
  txt(d,788,297,['BASELINE EVIDENCE','NEW FAILURE EVIDENCE','HIGHER CONSEQUENCE'][state],19,GREEN,True)
  for j,label in enumerate(['Updated reliability','Future production loss','Revised cash flows']):txt(d,788,349+j*55,label,23,WHITE,True)
  txt(d,790,521,'ILLUSTRATIVE MODEL SCENARIOS',11,MUTED)
 if i==6:
  d.rectangle((0,90,W,586),fill=(3,16,28,230));header(d,'04 / Predict & decide','DCBF: economic health, continuously.')
  state=min(2,int(u/4));cc=curves[state]
  for j,(key,label,scale) in enumerate([('npv','NPV / USD million',1e6),('irr','IRR / %',.01),('pb','PAYBACK / years',1),('pi','PROFITABILITY INDEX',1)]):
   x=54+(j%2)*603;y=221+(j//2)*164;panel(d,(x,y,x+571,y+153))
   txt(d,x+19,y+13,label,16,WHITE,True)
   vs=[None if a[key] is None else a[key]/scale for a in cc['timing']]
   pool=[a[key]/scale for c in curves for a in c['timing'] if a[key] is not None];lo=min(0,min(pool));hi=max(pool)
   plot(d,(x+57,y+50,476,67),vs,GREEN if j%2==0 else CYAN,ease((u%4+.3)/1),lo,hi)
   txt(d,x+10,y+96,f'{lo:.1f}',10,MUTED);txt(d,x+10,y+46,f'{hi:.1f}',10,MUTED)
   txt(d,x+57,y+128,'2026',10,MUTED);txt(d,x+499,y+128,'2040',10,MUTED)
  txt(d,55,556,'Compare replacement years. Identify the strongest business case.',18,GREEN,True)
  txt(d,931,562,'ILLUSTRATIVE / ASSUMPTIONS APPLY',10,MUTED)
 if i==7:
  if u<7:
   header(d,'04 / Predict & decide','From one asset to enterprise value.')
   txt(d,54,449,'Move the sliders.',33,WHITE,True);txt(d,54,491,'Watch the decision evolve.',33,GREEN,True)
  else:
   d.rectangle((0,90,W,586),fill=(3,16,28,145));center(d,640,194,'iAPM',70,GREEN,True)
   center(d,640,288,'Refine evidence. Redefine decisions.',33,WHITE,True)
   center(d,640,364,'EXPERIENCE THE SIMULATION',20,GREEN,True)
   center(d,640,430,'Today: transparent reliability and economic decision support.',16)
   center(d,640,460,'Roadmap: governed live integrations and validated AI/ML.',16,MUTED)
   center(d,640,526,'Concept visuals include supplied GE Vernova reference footage. No affiliation implied.',11,MUTED)
 # A restrained four-phase journey and speech captions, separate from key message.
 phase=0 if t<19 else 1 if t<31 else 2 if t<55 else 3
 for j,label in enumerate(['DISCOVER','REFINE','UNDERSTAND','PREDICT & DECIDE']):
  x=54+j*302;line(d,[(x,609),(x+280,609)],GREEN if j<=phase else (50,69,80,255),2)
  txt(d,x,620,f'0{j+1}  {label}',11,GREEN if j==phase else MUTED,True)
 s=scenes[i];speed=s['audio']['duration']/(s['dur']-.65);words=[w for w in s['audio']['word_timestamps'] if not w['word'].startswith('<')]
 for k in range(0,len(words),7):
  g=words[k:k+7]
  if .2+g[0]['start']/speed<=u<=.2+g[-1]['end']/speed:
   center(d,640,675,' '.join(w['word'] for w in g),21,WHITE)
 return Image.alpha_composite(im,lay).convert('RGB')

out=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r',str(FPS),'-i','-','-vf','scale=1920:1080:flags=lanczos','-an','-c:v','libx264','-preset','fast','-b:v','2000k','-maxrate','2150k','-bufsize','4300k','-pix_fmt','yuv420p',str(P/'visual.mp4')],stdin=subprocess.PIPE)
for shotnum,(start,dur,src) in enumerate(shots):
 decoder=None
 if isinstance(src,(int,float)):
  decoder=subprocess.Popen(['ffmpeg','-v','error','-ss',str(src),'-i',str(SOURCE),'-t',str(dur),'-vf','fps=24,scale=1280:720,eq=saturation=0.88:contrast=1.06:brightness=-0.02','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
 for n in range(dur*FPS):
  u=n/FPS;t=start+u
  if decoder:
   data=decoder.stdout.read(W*H*3)
   if len(data)!=W*H*3:raise RuntimeError(f'Incomplete source shot {shotnum}')
   im=Image.frombytes('RGB',(W,H),data)
  else:
   art=arts[src];sw,sh=art.size;z=1.02+.08*u/dur;cw=sw/z;ch=cw*H/W;x=(sw-cw)*(.35+.25*u/dur);y=(sh-ch)*.5
   im=art.transform((W,H),Image.Transform.EXTENT,(x,y,x+cw,y+ch),Image.Resampling.BICUBIC)
  im=overlay(im,t)
  if start in starts:
   fade=min(1,u/.25)
   if fade<1:im=Image.blend(Image.new('RGB',(W,H)),im,fade)
  if t>89.6:im=Image.blend(Image.new('RGB',(W,H)),im,(90-t)/.4)
  if abs(u-1)<.001:im.save(P/f'frame-{start:02}.jpg',quality=94)
  out.stdin.write(im.tobytes())
 if decoder:decoder.stdout.close();decoder.wait()
 print(f'Rendered {start+dur}/90 seconds',flush=True)
out.stdin.close();assert out.wait()==0
subprocess.run(['ffmpeg','-y','-v','error','-i',str(P/'visual.mp4'),'-i',str(R/'public/iapm-cinematic-promo-90s.mp4'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-ar','48000','-b:a','160k','-t','90','-movflags','+faststart',str(P/'iAPM_Enterprise_Promo_90s.mp4')],check=True)
print('COMPLETE',flush=True)
