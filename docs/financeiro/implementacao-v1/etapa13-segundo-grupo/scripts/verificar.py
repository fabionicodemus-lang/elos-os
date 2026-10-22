"""Verifica preservação, comparações, execuções e referências antes da entrega."""
from pathlib import Path
import json,hashlib,subprocess,collections
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias'
REPO=ROOT.parents[3]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
base=json.loads((E/'base.json').read_text())
for p,h in base['protected_sha256'].items():assert sha(REPO/p)==h,('Fonte anterior alterada',p)
fixture=json.loads((REPO/'tests/financeiro/fixtures/casos_financeiros.json').read_text())
expected={c['id']:c['expected'] for c in fixture['cases']}
matrix=json.loads((E/'matriz-30.json').read_text());assert len(matrix)==30
for row in matrix:
 assert row['expected']==expected[row['id']],row['id']
 assert row['financial_acceptance'].startswith('Pendente'),row['id']
 for p in row['evidence']:assert (ROOT/p).is_file(),(row['id'],p)
assert {r['id'] for r in matrix if r['executed_as_main_case_stage13']}=={'CT21','CT24'}
counts=dict(collections.Counter(r['classification'] for r in matrix))
assert counts=={'Parcial':13,'Conforme por teste independente':7,'Conforme apenas por evidência técnica herdada':10},counts
comparison=json.loads((E/'comparacao-2.json').read_text());assert comparison['passed_count']==2 and comparison['complete']
assert json.loads((E/'banco.json').read_text())['failed']==0
execution_files=['execucoes.json','reverificacao.json','verificacao-final-codigo.json','regressao-final-banco.json','regressao-etapa12/execucoes.json']
for f in execution_files:
 rows=json.loads((E/f).read_text());assert rows and all(r['exit_code']==0 for r in rows),f
metrics=[('Etapa5, incluindo backup/restauração','regressao-etapa12/reexecucao/anteriores/fundacao/banco-final.json',25),
 ('Etapa6 — integração','regressao-etapa12/reexecucao/anteriores/integracao/integracao.json',24),
 ('Etapa7 — liquidações','regressao-etapa12/reexecucao/anteriores/liquidacoes.json',16),
 ('Etapa8 — caixa','regressao-etapa12/reexecucao/etapa8/banco.json',8),
 ('Etapa9 — observações, não novas homologações','regressao-etapa12/reexecucao/etapa9/banco.json',7),
 ('Etapa10 — restituições','regressao-etapa12/reexecucao/etapa10/banco.json',9),
 ('Etapa12 — cadeias persistidas','regressao-etapa12/banco.json',4),
 ('Após guard de obra: Etapa12 persistida','pos-revisao-obra/banco.json',4),
 ('Após guard de obra: Etapa8 persistida','pos-revisao-obra/reexecucao/etapa8/banco.json',8)]
lines=['# Testes executados — Etapa13','','Não somar as suítes como testes únicos: há sobreposição de componentes e reexecuções. Todos os dados são fictícios.','',
 '| Verificação | Resultado | Evidência |','|---|---|---|']
for name,p,count in metrics:
 data=json.loads((E/p).read_text());assert data['passed']==count and data['failed']==0,(name,data.get('passed'),data.get('failed'))
 lines.append(f'|{name}|{count}/{count}|`evidencias/{p}`|')
for name,p,count in [('Novos testes de núcleo e canais','testes-etapa13.log',8),('Regressões solicitadas','regressao-etapa12/regressao-81.log',81),('Testes gerais','regressao-etapa12/npm-test.log',142),('Componentes anteriores','regressao-etapa12/componentes-anteriores.log',29),('Etapa12 — SSR/IA/ações','regressao-etapa12/servidor-tela-acoes.log',10),('Após guard de obra: componentes/SSR/IA/ações','regressao-apos-guard-obra.log',39)]:
 text=(E/p).read_text();assert f'ℹ tests {count}' in text and f'ℹ pass {count}' in text and 'ℹ fail 0' in text,p
 lines.append(f'|{name}|{count}/{count}|`evidencias/{p}`|')
ct10=json.loads((E/'regressao-etapa12/reexecucao/etapa10/comparacao-ct10.json').read_text());assert ct10['passed_count']==1 and ct10['complete']
lines += ['|Etapa13 — SQL/RLS e carregadores|2/2 cadeias observadas|`evidencias/banco.json`|',
 '|Comparação com esperados originais CT21/CT24|2/2, sem divergência numérica|`evidencias/comparacao-2.json`|',
 '|Comparação CT10 com esperado original|1/1, conforme|`evidencias/regressao-etapa12/reexecucao/etapa10/comparacao-ct10.json`|',
 '|TypeScript e ESLint|saída0|`evidencias/verificacao-final-codigo.json`|','',
 'Backup/restauração: arquivo criptografado, snapshot61 tabelas, restauração local verificada, recusa de arquivo corrompido/destino existente e erro de pg_restore cobertos. Não é teste de restauração de produção.',
 'Etapa9 possui7 observações executadas; não significa sete novos cenários aprovados. CT10 usa o adaptador preservado da Etapa10.',
 'O harness foi reforçado após a primeira execução: contagem canônica consultada, auditoria antes/depois das negações e leituraUR. Após o ajuste final de cobertura entre obras, foram repetidos8 testes novos,39 componentes/ações e as cadeias persistidas deEtapas12 e8, com esperados intactos.',
 'Não houve teste remoto Koper, login/Auth/PostgREST real, browser ou storage ponta a ponta. As lacunas continuam explícitas nos dois cenários parciais.']
(ROOT/'RESUMO-TESTES.md').write_text('\n'.join(lines)+'\n')
code_commit=subprocess.check_output(['git','log','-1','--format=%H','--','lib/finance-core/cashflow.mjs'],cwd=REPO,text=True).strip()
files=subprocess.check_output(['git','diff','--name-only',base['base_commit'],code_commit],cwd=REPO,text=True).splitlines()
manifest=dict(base_commit=base['base_commit'],code_commit=code_commit,branch=subprocess.check_output(['git','branch','--show-current'],cwd=REPO,text=True).strip(),
 protected_prior_file_count=len(base['protected_sha256']),prior_evidence_and_rules_unchanged=True,stage11_unchanged=True,expected_fixture_unchanged=True,
 code_files_sha256={p:sha(REPO/p) for p in files},scenario_counts=counts,formally_accepted=0,selected_cases=['CT24','CT21'],
 production_and_remote_koper_operations=[],runtime=dict(image='postgres@sha256:a63c1ea3f6a3a5a1621f97d2aba3b30faecfab4224c1b0000cc85ced57bb1939',observed_image_id='sha256:82903352d6faf8f8a318bc4353d1cb1db67d4a5ff968d2799b2718e2cb00afa2',network='none',published_ports=[],data='fictitious',auth='SQL simulated JWT; not Supabase Auth certification'),
 execution_manifests=execution_files,delivery_files_sha256={str(p.relative_to(ROOT)):sha(p) for p in ROOT.rglob('*') if p.is_file() and p.name!='manifesto-entrega.json' and '__pycache__' not in p.parts})
(E/'manifesto-entrega.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(protected_prior_files_verified=manifest['protected_prior_file_count'],code_commit=code_commit,scenario_counts=counts,formal_acceptance=0),ensure_ascii=False))
