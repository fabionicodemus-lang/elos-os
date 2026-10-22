from pathlib import Path
import json,csv,collections
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias'
tests=json.loads((E/'tentativas.json').read_text());perms=json.loads((E/'matriz-permissoes.json').read_text())
assert len(tests)==342 and all(r['passed'] for r in tests)
assert len(perms)==64 and all(r['passed'] for r in perms)
with (E/'tentativas.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['Teste','Usuário','ID usuário','Empresa','Perfil','Canal','Registro/empresa solicitados','Esperado','Resposta efetiva','Resultado'])
 for r in tests:
  a=r['identity'] or {};w.writerow([r['id'],a.get('email'),a.get('id'),a.get('company'),a.get('profile'),r['target'].get('channel'),json.dumps(r['target'],ensure_ascii=False),r['expected'],json.dumps(r.get('actual'),ensure_ascii=False),'Conforme' if r['passed'] else 'Reprovado'])
lines=['# Matriz de permissões esperadas versus observadas','',
 '64 comparações independentes,8 identidades reais de Auth no ambiente fictício. Cada perfil possui somente associação ativa à sua própria construtora. O esperado vem da configuração declarada e dos defaults/migrações citados no JSON, não é calculado por `has_company_permission`. Essa função fornece o observado.','',
 '| Perfil | AP/AR leitura | AP/AR gestão | Bancos leitura | Fluxo/exportação JSON | Contratos leitura | Contratos gestão | Outra empresa |','|---|---|---|---|---|---|---|---|']
for role in ['admin','finance','engineering','viewer']:
 p={r['permission']:r for r in perms if r['identity']['profile']==role and r['identity']['company']=='A'}
 def v(key):return 'Sim / Sim' if p[key]['expected_own'] else 'Não / Não'
 lines.append('|'+role+'|'+v('payables.view')+'|'+v('payables.manage')+'|'+v('finance.bank_accounts.view')+'|'+v('cashflow.view')+'|'+v('execution.contracts.view')+'|'+v('execution.contracts.manage')+'|Não / Não|')
lines+=['','Cada célula mostra **esperado / observado**; o mesmo resultado foi confirmado paraA eB e para contas a receber. Detalhes por identidade e permissão: `evidencias/matriz-permissoes.json`.','',
 'Fontes: `20260810_0081_owner_admin_full_access.sql` restringe o superadministrador à empresa de sua associação; `20260722_0001_multitenancy.sql` contém os defaults; `20260728_0038_execution_service_contracts.sql` concede explicitamente leitura/gestão contratual à Engenharia e leitura a Financeiro/Viewer; os grants financeiros/viewer e de caixa reutilizam a fixture já existente das Etapas5/8. Não foram concedidas permissões adicionais aos usuários em resposta a uma falha de teste.','',
 'Bancos nesta tabela significa leitura; upload bancário próprio foi realizado pelo Financeiro, conforme permissões existentes, e os documentos estrangeiros foram negados a todos os perfis. Engenharia não recebeu AP/AR/bancos/fluxo por inferência.','',
 'A interpretação de negócio para usuários/empresas reais continua pendente: matriz nominal, vigência, alcance entre entidades de uma mesma organização, leitura de documentos contratuais e execução técnica por leitores. O código atual não constitui aprovação financeira dessa intenção. D02 eD13 da norma não foram renomeados como uma matriz de acesso.','',
 'Resultados HTTP não são uniformes em todo o legado: revisão sem gestão retorna400/P0001/“Sem permissão.”; o novo guard retorna403/42501; RLS de SELECT/PATCH retorna200 com nenhuma linha. Cada resposta efetiva foi registrada; todas essas negações conservaram os registros financeiros.']
(ROOT/'PERMISSOES.md').write_text('\n'.join(lines)+'\n')
old=json.loads((ROOT.parent/'etapa13-segundo-grupo/evidencias/matriz-30.json').read_text())
for r in old:
 r['stage14_main_fixture_executed']=False
 if r['id']=='CT24':r['stage14_evidence']={'status':'Parcial — recortes entre company_id certificados; caso integral/aceite pendentes','paths':['etapa14-isolamento/README.md','etapa14-isolamento/CANAIS.md','etapa14-isolamento/evidencias/tentativas.json'],'notes':'Massa diferente do CT24 aprovado; não substituir esperado/obtido. EntidadesA1/A2 da mesma organização e todos os canais continuam pendentes.'}
(E/'matriz-30.json').write_text(json.dumps(old,ensure_ascii=False,indent=2)+'\n')
counts=collections.Counter(r['classification'] for r in old)
(E/'situacao-30.json').write_text(json.dumps(dict(counts=counts,formal_financial_acceptance=0,original_expected_and_actual_unchanged=True),ensure_ascii=False,indent=2)+'\n')
