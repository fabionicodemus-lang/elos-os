"""Preserva pendências anteriores; aprovação numérica não substitui aceite nominal."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
rows=json.loads((ROOT.parent/'etapa7-calculos/evidencias/matriz-30.json').read_text())
changes={
'CT04':('Parcialmente coberto','Oráculo de datas e faixas completo em componente: aberto/vencido em 21; caixa em 22, sem novo caixa em 24. Persistência econômica integral do caso ainda pendente.','componentes-casos.json; comparacao-componentes.json'),
'CT12':('Integralmente aprovado no perímetro isolado','Entidade/fonte/fornecedor/obrigação validados explicitamente; pagamento e conciliação de 2.000 sem obra. Entidade: custo dado/comprovado na fixture 10.000, aberto 8.000; obra A 6.000; sem obra: custo 4.000, aberto 2.000 e desembolso 2.000; apropriação original 60%. Sem padrão Flow.','banco.json; comparacao-integrais.json'),
'CT15':('Integralmente aprovado no perímetro isolado','Aberturas 50.000/10.000 comprovadas na fixture. Dia20: banco39.985 + trânsito20.000; dia21: banco59.985 e trânsito0. Tarifa15 é única saída externa. Pontas e tarifa vinculadas a extratos fictícios.','banco.json; comparacao-integrais.json'),
'CT16':('Integralmente aprovado no perímetro isolado','Mútuo documentado20.000: A/B fecham30.000 cada. Consolidado autorizado60.000; zero fluxo externo do mútuo; registros individuais preservados. Natureza/direitos no evento, sem presumir DFC contábil ou criar receita/custo.','banco.json; comparacao-integrais.json'),
'CT17':('Integralmente aprovado no perímetro isolado','Versões persistidas e fontes congeladas. Original130.000/80.000/40.000; reprogramado80.000/−10.000/40.000; necessidade0→30.000. Vencimentos permanecem até acordo separado; variante de renegociação e posição anterior passam. Incorrido20.000 é fato fixo da fixture.','banco.json; comparacao-integrais.json; servidor-tela.log'),
'CT25':('Integralmente aprovado no perímetro isolado','P3.000→R1.000+P2.000→P2.000 após pagamento conciliado. Ocorrência e vínculo imutáveis; reimportações documentadas preservam título e não recriam previsão ou caixa.','banco.json; comparacao-integrais.json'),
'CT29':('Parcialmente coberto','Oráculo puro completo: banco120.000−restrição20.000=100.000 disponível; finais40.000/−30.000; necessidade50.000. Limite não sacado70.000 não entra; amortização20.000 já incluída não é repetida. Agenda integral de financiamento persistido/documentos reais ainda não homologada.','componentes-casos.json; comparacao-componentes.json'),
}
for row in rows:
 if row['id'] in changes:row['status'],row['observed'],row['evidence']=changes[row['id']]
 else:
  parts=[]
  for part in row['evidence'].split('; '):
   if part=='—' or part.startswith('lib/') or part=='migração candidata':parts.append(part)
   elif (ROOT/'evidencias/anteriores'/part).exists():parts.append('anteriores/'+part)
   elif (ROOT.parent/'etapa7-calculos/evidencias'/part).exists():parts.append('../../etapa7-calculos/evidencias/'+part)
   else:parts.append(part)
  row['evidence']='; '.join(parts)
 if row['id']=='CT03':row['observed']+=' Leitura de saldo/eventos e vínculos bancários exercitada; extrato/caso completo permanece pendente.'
 if row['id']=='CT24':row['observed']+=' Etapa8 testa cenários/transferências/cobertura e titular sem obra; Auth/browser e todos os canais ainda pendentes.'
 if row['id']=='CT18':row['observed']+=' P→C e cronograma físico persistidos em controle adicional; não promove todos os estados integrais do caso.'
 if row['id']=='CT21':row['observed']+=' Abertura/restrição sem prova gera saldo não validado, data ausente fica explícita; projeção por entidade evita compensação indevida.'
(ROOT/'evidencias/matriz-30.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
text='# Resultado individual dos 30 cenários\n\n11 integrais no perímetro automatizado isolado, 18 parciais, nenhum reprovado nessa massa, 1 não executado. **Conjunto não homologado documentalmente nem por responsável financeiro.** Integral significa as saídas e ações da fixture declarada: banco/núcleo e fronteiras documentadas, não todos os canais do produto.\n\n| Caso | Situação atual | Resultado e limitação | Evidências em `evidencias/` |\n|---|---|---|---|\n'
text+='\n'.join(f"| {r['id']} — {r['title']} | {r['status']} | {r['observed']} | {r['evidence']} |" for r in rows)+'\n'
text+='\nO comparador original valida 11 casos integrais separadamente de 5 oráculos de componentes puros (CT04/18/19/21/29). Estes cinco continuam parciais no fluxo completo. Dados econômicos declarados como aceitos nas fixtures CT12/17/25 não certificam reconhecimento contábil em dados reais. Sem aprovação nominal em nome de terceiros.\n'
(ROOT/'CENARIOS-30.md').write_text(text)
