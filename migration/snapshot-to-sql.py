import json,sys,pathlib
if len(sys.argv)!=4: raise SystemExit('Usage: python3 snapshot-to-sql.py iapm-snapshot.json NEW_OWNER_ID restore.sql')
s=json.loads(pathlib.Path(sys.argv[1]).read_text());owner=sys.argv[2];rows=[]
if s.get('format')!='iapm-handover-v1': raise SystemExit('Unsupported snapshot')
def add(kind,record):
 if not record.get('id'): raise ValueError('Missing ID in '+kind)
 rows.append((owner+':'+kind+':'+record['id'],owner,kind,json.dumps(record,ensure_ascii=False),0))
for kind in ['assets','incidents','actions','scenarios','settings']:
 for record in s['data'].get(kind,[]):add(kind,record)
for record in s['history']['imports']:add('rir_import',record)
for record in s['chat']['conversations']:add('ai_chat',record)
for record in s['usage']['entries']:add('ai_usage',record)
add('ai_preferences',dict(s['usage']['preferences'],id='budget'))
def q(v):return str(v) if isinstance(v,int) else "'"+str(v).replace("'","''")+"'"
pathlib.Path(sys.argv[3]).write_text('-- Import only into an empty destination records table.\nBEGIN TRANSACTION;\n'+''.join('INSERT INTO records(id,owner,kind,body,updated) VALUES('+','.join(map(q,r))+');\n' for r in rows)+'COMMIT;\n')
print('Wrote',len(rows),'records. Restore each PDF under the ORIGINAL key listed in snapshot.files. No credentials or sessions restored.')
