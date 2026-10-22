# Matriz de permissões esperadas versus observadas

64 comparações independentes,8 identidades reais de Auth no ambiente fictício. Cada perfil possui somente associação ativa à sua própria construtora. O esperado vem da configuração declarada e dos defaults/migrações citados no JSON, não é calculado por `has_company_permission`. Essa função fornece o observado.

| Perfil | AP/AR leitura | AP/AR gestão | Bancos leitura | Fluxo/exportação JSON | Contratos leitura | Contratos gestão | Outra empresa |
|---|---|---|---|---|---|---|---|
|admin|Sim / Sim|Sim / Sim|Sim / Sim|Sim / Sim|Sim / Sim|Sim / Sim|Não / Não|
|finance|Sim / Sim|Sim / Sim|Sim / Sim|Sim / Sim|Sim / Sim|Não / Não|Não / Não|
|engineering|Não / Não|Não / Não|Não / Não|Não / Não|Sim / Sim|Sim / Sim|Não / Não|
|viewer|Sim / Sim|Não / Não|Sim / Sim|Não / Não|Sim / Sim|Não / Não|Não / Não|

Cada célula mostra **esperado / observado**; o mesmo resultado foi confirmado paraA eB e para contas a receber. Detalhes por identidade e permissão: `evidencias/matriz-permissoes.json`.

Fontes: `20260810_0081_owner_admin_full_access.sql` restringe o superadministrador à empresa de sua associação; `20260722_0001_multitenancy.sql` contém os defaults; `20260728_0038_execution_service_contracts.sql` concede explicitamente leitura/gestão contratual à Engenharia e leitura a Financeiro/Viewer; os grants financeiros/viewer e de caixa reutilizam a fixture já existente das Etapas5/8. Não foram concedidas permissões adicionais aos usuários em resposta a uma falha de teste.

Bancos nesta tabela significa leitura; upload bancário próprio foi realizado pelo Financeiro, conforme permissões existentes, e os documentos estrangeiros foram negados a todos os perfis. Engenharia não recebeu AP/AR/bancos/fluxo por inferência.

A interpretação de negócio para usuários/empresas reais continua pendente: matriz nominal, vigência, alcance entre entidades de uma mesma organização, leitura de documentos contratuais e execução técnica por leitores. O código atual não constitui aprovação financeira dessa intenção. D02 eD13 da norma não foram renomeados como uma matriz de acesso.

Resultados HTTP não são uniformes em todo o legado: revisão sem gestão retorna400/P0001/“Sem permissão.”; o novo guard retorna403/42501; RLS de SELECT/PATCH retorna200 com nenhuma linha. Cada resposta efetiva foi registrada; todas essas negações conservaram os registros financeiros.
