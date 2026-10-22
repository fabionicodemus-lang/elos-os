"""Cópia derivada; preserva esperados, fórmulas, dependências e aceites originais."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib,json,openpyxl
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'etapa7-calculos/Elos_OS_Quadro_Etapa7_Calculos.xlsx'
OUT=ROOT/'Elos_OS_Quadro_Etapa8_Fluxo.xlsx'
w=openpyxl.load_workbook(SOURCE); old=openpyxl.load_workbook(SOURCE); allowed=set()
notes={
'T15':('Em validação','CT12 corrigido na fixture: validar obrigação por entidade antes de pagar, sem atribuir obra. Aberto8.000; sem obra2.000 após pagamento2.000. Custo não é presumido do título: exige valor/competência explícitos ou fica pendente. D01 legado e aceite nominal pendentes.'),
'T16':('Em andamento','Cobertura rastreável por cenário/entidade/obra, título e ocorrência. Vínculo nativo de nota/medição/contrato compartilhado com Etapa7. Rateio documental amplo e retenções ainda pendentes.'),
'T17':('Em andamento','Pagamento sem obra preservado e mensurado por entidade; nenhum saldo bancário criado por obra. Rateio multiobra integral e critérios reais D05 pendentes.'),
'T18':('Em validação','CT07 e 16 controles da Etapa7 repetidos. Liquidação parcial preservada; nenhum aceite nominal emitido.'),
'T19':('Em andamento','Reutiliza extrato/links sem novo caixa; movimento registrado e confirmado distintos. Conciliação independente/documentação real e CT03 integral pendentes.'),
'T23':('Em validação','Estornos/devoluções Etapa7 preservados; evento inverso de transferência protege original. Estorno de trânsito sem crédito permanece em apuração.'),
'T26':('Em andamento','Cobertura nativa e por ocorrência evita R/C/P duplicados; contrato dividido exige alocação explícita. Mapas universais e aceite real ainda pendentes.'),
'T28':('Em andamento','P pode migrar para C em nova versão, e para R por vínculo sem recriar ocorrência. Previsão descoberta não é residual de orçamento. Reestimativa econômica integral pendente.'),
'T29':('Em validação','CT17 persiste original/reprogramado e fontes; saldo novembro80.000→−10.000, necessidade0→30.000. Cronograma físico altera C/P futuros em nova versão; vencimentos e realizado não são arrastados. Aceite financeiro nominal pendente.'),
'T30':('Em andamento','Fluxo separa R/C/P/recebíveis/receita estimada/AF; horizontes30/90 cumulativos e sem data. Total até conclusão permanece parcial se faltar cobertura/datas/política.'),
'T34':('Em andamento','Atraso usa vencimento legal; recebimento previsto em dezembro não elimina atraso de outubro. CT17 passa; CT13/22 integrais e D09 operacional pendentes.'),
'T35':('Em validação','CT15 com abertura/extrato/links fictícios:39.985+20.000 trânsito no dia20;59.985 no dia21, tarifa15 única saída externa. Aceite de contas/extratos reais pendente.'),
'T36':('Em validação','CT16: mútuo20.000, A/B30.000, consolidado60.000. Eliminação só explícita e com ambas as pontas autorizadas; nenhuma compensação automática de insuficiência entre titulares. D13 real/reapropriação integral pendentes.'),
'T37':('Em andamento','Movimentos canônicos não podem ser apagados/cancelados pelo caminho legado; inversos e snapshots preservam histórico. CT20/retificação econômica e legado cancelado ainda pendentes.'),
'T38':('Em andamento','Quarentena sem obra continua na entidade, fonte declarada separada do saldo validado, abertura/restrições/datas desconhecidas não viram zero. Conciliação documental integral pendente.'),
'T39':('Em andamento','Saldo por conta e continuidade passam; necessidade por entidade sem caixa compartilhado fictício. CT29 completo em componente; financiamento/escopos/restrições reais, mínimos e alçadas nominais pendentes.'),
'T40':('Em andamento','Tela e carregador real usam núcleo comum; filtros/versões e exemplo SSR exercitados. Relatórios fiscais mantêm fonte própria; Auth/browser e exportações financeiras integrais pendentes.'),
'T41':('Em andamento','Consultas de fluxo e diagnóstico da IA usam o mesmo carregador da tela. Sem integração remota ou homologação documental; demais indicadores mantêm limitações anteriores.'),
'T42':('Em andamento','RLS entre entidades/organizações, cenários, créditos, abertura e transferências verificados no isolamento. Nova cashflow.manage sem concessão automática; aprovação da matriz real pendente.'),
'T44':('Em andamento','11 integrais isolados,18 parciais,1 não executado; CT12 passa condicional à validação explícita. Conjunto não homologado e nenhum aceite financeiro preenchido.'),
}

def put(sheet,cell,val):w[sheet][cell]=val;allowed.add((sheet,cell))
for row in w['Acompanhamento']:
 if row[0].value in notes:
  state,note=notes[row[0].value];n=row[0].row
  for col,val in [('F',state),('I','etapa8-fluxo/README.md; CENARIOS-30.md; evidencias/execucoes.json; evidencias/liquidacoes.json'),('S',note)]:put('Acompanhamento',f'{col}{n}',val)
model=json.loads((ROOT/'evidencias/casos-obtidos.json').read_text())
actual={c['id']:c['actual'] for c in model['cases'] if c['status']=='executado'}
assert set(actual)=={'CT01','CT07','CT08','CT12','CT15','CT16','CT17','CT23','CT25','CT26','CT30'}
when=datetime.fromisoformat(model['execution_context']['executed_at'].replace('Z','+00:00')).astimezone(ZoneInfo('America/Sao_Paulo')).replace(tzinfo=None)
checked=0
for row in w['Testes']:
 if row[0].value not in actual:continue
 value=actual[row[0].value]
 for part in row[1].value.split('.'):value=value[part]
 if value is None:value='null'
 elif row[1].value.endswith('_percent'):value=float(value)
 for col,val in [('G',value),('J','etapa8-fluxo/evidencias/comparacao-integrais.json; banco.json; anteriores/liquidacoes.json; anteriores/integracao/integracao.json — isolamento, sem aceite financeiro'),('K','Codex — execução automatizada isolada'),('L',when)]:put('Testes',f'{col}{row[0].row}',val)
 checked+=1
sheet=w.create_sheet('Etapa8_Cobertura');sheet.append(['Caso','Título','Situação','Observado / pendência','Evidência','Aceite financeiro'])
for r in json.loads((ROOT/'evidencias/matriz-30.json').read_text()):sheet.append([r['id'],r['title'],r['status'],r['observed'],r['evidence'],'Pendente — não preenchido pelo executor'])
sheet.freeze_panes='A2';sheet.auto_filter.ref=sheet.dimensions
for col,width in [('A',10),('B',65),('C',40),('D',110),('E',65),('F',45)]:sheet.column_dimensions[col].width=width
w.calculation.fullCalcOnLoad=True;w.calculation.forceFullCalc=True;w.save(OUT)
after=openpyxl.load_workbook(OUT);changes=[];same=0
for sheet in old:
 for row in sheet:
  for c in row:
   if c.value!=after[sheet.title][c.coordinate].value:
    assert (sheet.title,c.coordinate) in allowed;changes.append(f'{sheet.title}!{c.coordinate}')
   else:same+=1
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(ROOT/'evidencias/verificacao-quadro.json').write_text(json.dumps(dict(source_sha256=sha(SOURCE),derived_sha256=sha(OUT),modified_existing_cells=changes,unchanged_existing_cells_checked=same,executed_test_rows=checked,expected_formulas_dependencies_acceptances_unchanged=True,added_sheet='Etapa8_Cobertura',formula_values_recomputed=False,execution_timezone='America/Sao_Paulo'),ensure_ascii=False,indent=2)+'\n')
print(f'{checked} linhas de resultado; {len(changes)} células originais alteradas; aceites e esperados preservados.')
