"""Somente leitura. Preserva desconhecidos e não confunde declaração ERP com banco."""
from pathlib import Path
from decimal import Decimal
from collections import Counter
import hashlib,csv,json,re,openpyxl,subprocess
ROOT=Path(__file__).resolve().parents[1];BASE=Path('/workspace/financial-source-base/Base_Conferencia_Elos_OS');E=ROOT/'evidencias'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def cents(v):
 if v is None or v=='':return None
 n=Decimal(str(v))*100
 assert n==n.to_integral_value(),v
 return int(n)
rows=list(csv.DictReader((BASE/'catalogo_fontes.csv').open(encoding='utf-8-sig'),delimiter=';'))
for row in rows:
 p=BASE/row['caminho_original'];row['accessible']=p.exists();row['observed_sha256']=sha(p) if p.exists() else None
 row['hash_matches']=row['observed_sha256']==row['sha256'];assert row['hash_matches']
books=[];records=[]
for sid in ['F011','F012','F013','F014','F015','F016']:
 r=next(r for r in rows if r['fonte_id']==sid);w=openpyxl.load_workbook(BASE/r['caminho_original'],read_only=True,data_only=True);s=w['Titulos_Koper'];rs=[(n,row) for n,row in enumerate(s.iter_rows(min_row=5,values_only=True),5) if row[0] is not None]
 values=[cents(row[4]) for _,row in rs];paid=[cents(row[8]) for _,row in rs];missing=sum(v is None for v in values)
 info={'source':sid,'company_declared':r['empresa'],'project_declared':r['obra'],'identity_evidence':r['evidencia_identidade'],'cutoff':r['data_corte'],'extracted_at_declared':r['data_extracao'],'sha256':r['observed_sha256'],'count':len(rs),'distinct_ids':len({str(row[0]) for _,row in rs}),'known_principal_subtotal_cents':sum(v for v in values if v is not None),'principal_total_cents':None if missing else sum(values),'missing_amount_count':missing,'declared_paid_known_subtotal_cents':sum(v for v in paid if v is not None),'declared_paid_missing_count':sum(v is None for v in paid),'confirmed_cash_cents':None,'legal_entity_validated':None,'common_cutoff_validated':None,'current_destination_snapshot':None,'statuses':dict(Counter(row[6] for _,row in rs)),'title_16032_count':sum(str(row[0])=='16032' for _,row in rs)}
 books.append(info)
 if sid=='F011':
  for n,row in rs:records.append({'source':sid,'sheet':'Titulos_Koper','line':n,'external_id':str(row[0]),'installment':row[3],'document':row[2],'principal_cents':cents(row[4]),'due':str(row[5]) if row[5] else None,'declared_status':row[6],'declared_paid_date':str(row[7]) if row[7] else None,'declared_paid_cents':cents(row[8]),'entity_validated':None,'work_financial_center':row[11],'eap_text':row[19],'confirmed_cash_cents':None})
 w.close()
pdf=BASE/next(r for r in rows if r['fonte_id']=='F007')['caminho_original'];text=subprocess.check_output(['pdftotext','-layout',str(pdf),'-'],text=True);match=re.search(r'Valor total:\s*R\$\s*([\d.]+,\d\d)',text);assert match
header=cents(match[1].replace('.','').replace(',','.'));total=books[0]['principal_total_cents'];difference=total-header
out={'perimeter':'Documentos históricos locais; não há corte comum nem snapshot operacional atual/extratos/contratos completos. Nenhuma identidade jurídica é presumida de filename.','sources':rows,'workbooks':books,'F011_vs_F007':{'xlsx_principal_cents':total,'pdf_header_cents':header,'unreconciled_difference_cents':difference,'source_pdf_sha256':sha(pdf),'source_pdf_header_text':match[0],'cause':'Não demonstrada. Bases bruto/líquido, descontos, registros e cortes precisam de ponte documental; não atribuir causa por coincidência.','current_financial_position_certified':False},'duplicate_versions_not_added':True,'current_bank_bridge_cents':None,'missing_access':['Snapshot atual do destino no mesmo T/K','Koper somente leitura com manifesto/corte autorizados','Extratos completos e saldos iniciais comprovados','Contratos/itens/aditivos e mapa de cobertura operacionais','Responsável pelo aceite e vigências D01–D14']}
(E/'fontes-historicas.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
# Line-level references without exporting supplier names, CNPJ or bank identifiers into the report.
(E/'linhas-historicas.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'verified_original_files':len(rows),'workbooks':len(books),'F011_vs_F007_delta_cents':difference,'current_financial_position_certified':False}))
