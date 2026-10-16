from PIL import Image,ImageDraw,ImageFont,ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import random, json, hashlib, os
random.seed(1990)
W,H=1654,2339
im=Image.new('RGB',(W,H));px=im.load()
for y in range(H):
 for x in range(W):
  edge=max(0,1-min(x,W-x,y,H-y)/100)*15;n=random.gauss(0,1.6)
  px[x,y]=(int(max(0,min(255,242-edge+n))),int(max(0,min(255,232-edge+n))),int(max(0,min(255,204-edge+n))))
d=ImageDraw.Draw(im)
mono='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';bold='/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf';italic='/usr/share/fonts/opentype/urw-base35/URWBookman-LightItalic.otf'
def text(x,y,t,size=24,b=False):d.text((x,y),t,font=ImageFont.truetype(bold if b else mono,size),fill=(57,54,47))
def line(y):d.line((95,y,1560,y),fill=(118,110,87),width=2)
def note(x,y,t):
 font=ImageFont.truetype(italic,29)
 for ch in t:
  d.text((x,y+random.randint(-2,2)),ch,font=font,fill=(41,67,111));x+=d.textlength(ch,font=font)
text(110,85,'SAFA COAST REFINERY',36,True);text(110,145,'MAINTENANCE & OPERATIONS DEPARTMENT',24)
text(110,195,'RELIABILITY INCIDENT REPORT / ARCHIVE COPY',27,True)
text(110,247,'RIR-SC-1990-017        ISSUE DATE: 18 SEPTEMBER 1990',24);line(300)
sections=[(325,'01  EQUIPMENT IDENTIFICATION',[
'Site: Safa Coast | Unit: Crude distillation | System: Feed train',
'Equipment tag: SC-E-101 | Category: Equipment | Class: Heat exchanger',
'Asset description: Process heat exchanger | Service: Hydrocarbon',
'Commissioned: 1982 | Boundary: Equipment unit + dedicated auxiliaries',
'Subunit: Tube bundle | Failed item: Carbon-steel process tube']),
(555,'02  FAILURE EVENT & OPERATING CONTEXT',[
'Detected: 14-Sep-1990 06:00 | Restored: 16-Sep-1990 06:00 (local)',
'Operating state before trip: Running, normal load | Event: Forced',
'Detection: Operator round; visible leak confirmed by pressure test',
'Failure mode: Tube wall loss | Mechanism: Corrosion',
'Functional failure: YES | Failure lifecycle stage: I (realized impact)',
'Impact attribution: F1 - primary actual production-loss event']),
(824,'03  DOWNTIME, PRODUCTION & FINANCIAL IMPACT',[
'Channel      Downtime (days)    Production loss (tonnes)    USD/t',
'P1                    2.00                     13,000       44',
'P2                    1.00                      4,300       59',
'P3                    0.50                      1,050       68',
'Virtual downtime: MAX(channel days) = 2.00 asset-days',
'Actual contribution loss: USD 897,100 (1990 money basis)',
'Maintenance cost: USD 18,500 | Active repair effort: 31.2 hours',
'Potential loss: NOT ASSESSED | No forecast probability recorded']),
(1168,'04  FAILURE INVESTIGATION & RESTORATION',[
'Tube leak caused unit turndown. Inspection found local wall thinning.',
'Cause: Suspected under-deposit corrosion; laboratory review pending.',
'Maintenance activity: Corrective. Isolated, opened and plugged tube.',
'Leak test passed; unit restored at 06:00 on 16 September 1990.',
'Action: Map remaining tube-wall thickness at next planned shutdown.',
'Action owner: R. Ahmed | Follow-up due: 30-Sep-1990',
'No injuries or off-site release reported. Environmental loss: not assessed.']),
(1470,'05  RELIABILITY EXPOSURE & DOCUMENT CONTROL',[
'Operating exposure: NOT AVAILABLE - do not calculate MTBF from dates.',
'Operating temperature: 180 deg C | Pressure: 12 bar(g)',
'Prepared by: R. Ahmed | Reviewed by: Operations / Inspection',
'Source: Shift log SC-09/1990, pages 14-16; workshop job SC-0719',
'Report status in archive: Reviewed | Historical date basis: local time',
'Laboratory confirmation and cost-invoice references: not available'])]
for y,title,rows in sections:
 text(110,y,title,25,True)
 for j,row in enumerate(rows):text(110,y+44+j*32,row,22)
 line(y+48+len(rows)*32)
note(155,1764,'Check deposit sample before confirming root cause.');note(940,1840,'R. Ahmed / 18-9-90')
d.line((140,1815,855,1808),fill=(48,70,112),width=2)
text(110,1950,'ARCHIVE DEMONSTRATION - SYNTHETIC RECORD',25,True)
text(110,1990,'Created for iAPM ingestion demonstration in 2026; not a plant record.',20)
text(110,2028,'MEDFI labels are modern demo annotations for historical migration.',20)
text(110,2140,'CONTROLLED COPY                 MAINT / SC / 1990                 1 / 1',20)
# Scanner shadows, fold and mild rotation; the delivered PDF contains only this raster.
d.line((W//2,80,W//2+8,H-70),fill=(205,196,173),width=2)
im=im.rotate(.25,resample=Image.Resampling.BICUBIC,fillcolor=(212,202,178)).filter(ImageFilter.GaussianBlur(.25))
im.save('public/demo/rir-1990-scan.jpg',quality=89)
c=canvas.Canvas('public/demo/iAPM_Historical_RIR_1990.pdf',pagesize=(595.28,841.89));c.setTitle('Synthetic 1990 historical RIR - iAPM demonstration');c.drawImage(ImageReader(im),0,0,595.28,841.89);c.showPage();c.save()
b=open('public/demo/iAPM_Historical_RIR_1990.pdf','rb').read();open('lib/demo-rir-hash.json','w').write(json.dumps({'sha256':hashlib.sha256(b).hexdigest()}))
print('Created image-only scanned PDF',len(b),'bytes')
