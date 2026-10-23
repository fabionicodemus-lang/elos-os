# Testes e critérios de aceite técnico

Resultado da candidata: **33/33 controles aprovados**,0 falhas/fatal, recursos descartáveis removidos. [resultado.json](evidencias/resultado.json) contém cada teste, identidade/alvo quando pertinente, resposta e valores. [vulnerabilidades-antes.json](evidencias/vulnerabilidades-antes.json) contém seis reproduções HTTP antes: anônimo e usuário estrangeiro nas três funções. Essas chamadas ocorreram somente no banco fictício.

| Grupo | Evidência / resultado |
|---|---|
| Chamadas diretas |12/12 negações HTTP: anon, FinanceiroA→B, ViewerB e AdminB direto, para cada um dos três helpers. Registro alvo e totais/contagens permanecem iguais. AdminB mantém os fluxos operacionais autorizados.|
| Defesa no helper |Três grupos exercitam chamador definer sem guard externo, com anon, estrangeiro administrador/financeiro e viewer próprio; empresa/permissão ainda são exigidas. Bridges existem apenas no schema validation da fixture.|
| Membros/perfis |Membership suspensa, papel inativo e authenticated sem sujeito são negados.|
| Capacidades mínimas |11 capacidades operacionais existentes exercitadas individualmente por papéis mínimos fictícios. O usuário não recebeu outras permissões para contornar negação.|
| Fluxos nativos |Ativação de contrato, aprovação de medição e progresso deOS por HTTP/Auth real; pagamento centralizado por contexto SQL de usuário→trigger0075 literal→helper.|
| Contextos técnicos |Service_role e sessão direta do proprietário preservados. Não certifica worker remoto nem gestão de credenciais.|
| Fórmulas |Corpos antes/depois, removendo só guard, idênticos por SHA256 nas três funções. Valores esperados explícitos:100.000;20.000/2.000;18.000;20.000/8.000/7.000/6.000.|
| Implantação defensiva |Idempotência; PUBLIC/anon/authenticated/custom semEXECUTE; alvo ausente reverte transação; corpo desconhecido não é sobrescrito; outro owner, associação privilegiada comNOINHERIT e overload inesperado interrompem a aplicação.|
| Dependência da candidata14 |Aprovador mínimo apenas de medição é bloqueado pelo guard14 e permitido pela14C no fluxo nativo. Não houve alteração do esperado.|

Os33 são controles agrupados, não33 cenários financeiros distintos. O arquivo JSON registra as subverificações de cada grupo.

## Regressões reexecutadas

Reutilizado `tests/finance-second/validate.mjs`, com saída redirecionada para `evidencias/regressao-etapa13`, sem sobrescrever qualquer etapa anterior. Os dois manifests `execucoes.json` internos registram saídas0.

| Cadeia | Resultado | Caminho relativo a `evidencias/regressao-etapa13/` |
|---|---:|---|
| Etapa5:fundação, incluindo backup/restore fictício |25/25|`regressao-etapa12/reexecucao/anteriores/fundacao/banco-final.json`|
| Etapa6:integração isolada |24/24|`regressao-etapa12/reexecucao/anteriores/integracao/integracao.json`|
| Etapa7:liquidações |16/16|`regressao-etapa12/reexecucao/anteriores/liquidacoes.json`|
| Etapa8:caixa |8/8|`regressao-etapa12/reexecucao/etapa8/banco.json`|
| Etapa9:observações técnicas |7/7|`regressao-etapa12/reexecucao/etapa9/banco.json` — não são sete novos aceites financeiros.|
| Etapa10:restituição/CT10 |9/9 e comparaçãoCT10 conforme|`regressao-etapa12/reexecucao/etapa10/`|
| Etapa12:CT02/03/18/29 |4/4 numéricos|`regressao-etapa12/banco.json`, `comparacao-4.json`|
| Etapa13:CT21/24 |2/2 numéricos|`banco.json`, `comparacao-2.json`; lacunas de homologação permanecem.|
| Regressão financeira |81/81|`regressao-etapa12/regressao-81.log`|
| Suíte padrão após integrar a main auditada |153/153|`regressao-etapa12/npm-test.log`; os11 testes de cronograma adicionados na main foram preservados.|
| TypeScript/linters da cadeia anterior |Saída0|Manifests e logs de lint/typescript; lint do harness14C em `evidencias/eslint.log`.|

Há sobreposição entre suítes. Os controles25/24/16 rodam sobre os scaffolds financeiros anteriores; não incluem o schema de Engenharia integral. Os33 novos controles exercitam especificamente a migração14C e os corpos SQL do relatório em outro banco fictício. Não se declara equivalência integral com produção.

Reprodução:

```sh
node tests/finance-rpc-security/validate.mjs
python docs/financeiro/implementacao-v1/etapa14c-correcao-rpcs/scripts/confrontar_auditoria.py
python docs/financeiro/implementacao-v1/etapa14c-correcao-rpcs/scripts/verificar.py
```

O runner reúne comandos que nesta sessão foram executados individualmente; `evidencias/execucoes.json` registra essa distinção. ExigeDocker local e imagens fixadas; não recebe URL de produção nem credencial de cliente.

## Aceites e limites

Critérios técnicos cumpridos: reproduzir o defeito; negar operações não autorizadas; preservar operações próprias/nativas e contextos técnicos; manter fórmulas/valores; executar regressões; manter original auditado e rastreabilidade.

Pendentes antes de aplicação: revisão técnica; captura atual de chamadores/owners/grants/configuração; validação em staging dos outros wrappers e identidades operacionais; janela/responsável e autorização explícita de produção. A exposição HTTP produtiva não foi demonstrada. Não foi investigada exploração histórica.

Nenhum dos30 cenários foi promovido por estes testes de segurança:13 parciais,7 conformes por teste independente anterior,10 por evidência técnica herdada,0 aceites formais. Não houve nova homologação financeira ou certificação dos demais canais da14/14B.
