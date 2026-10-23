# Plano controlado — não executado em produção

**Condição atual: implantação desconhecida. Não aplicar correções por presunção.** A preparação abaixo reutiliza as duas migrações candidatas da Etapa14. A autorização desta tarefa abrange diagnóstico e testes isolados; não autoriza aplicação produtiva.

## 1. Verificar e decidir

1. Tecnologia identifica projeto Supabase, ambiente e implantação que realmente atendem o Elos; fornece conexão somente para metadados ou executa o coletor por acesso já autorizado. Não enviar credenciais no relatório/chat.
2. Coletar `sql/inventario-metadados.sql`; registrar origem, operador, horário UTC e hash do arquivo. Confirmar captura íntegra e as três assinaturas, inclusive overloads. `environment` vem propositalmente como não atestado; não basta editar esse campo para comprovar proveniência.
3. Obter configuração não secreta do gateway/PostgREST: schemas expostos, papel anônimo e autenticado, autenticação, eventuais hooks, roteamento e cache de schema. Não chamar as RPCs produtivas, mesmo com UUID fictício. Projeto errado, conexão sem proveniência e OpenAPI isolado não comprovam a versão.
4. Comparar corpos e modos/ACL com a candidata local e as migrações nativas; revisar os helpers `auth.uid`, `is_company_member` e `has_company_permission`, papéis/proprietários, grants adicionais e herdados, RLS/FORCE RLS e schemas de busca. Body hash igual não certifica as dependências. Revisar chamadores privilegiados, triggers e SQL dinâmico: a busca textual é incompleta.
5. Se a função estiver ausente ou já corrigida, documentar e não aplicar alteração redundante. Se existir versão vulnerável/exposição comprovada, priorizarV01; avaliar tambémV02/V03. Se houver corpo/assinatura inesperados, interromper aplicação até revisar a diferença. Não inserir guard em corpo desconhecido apenas porque a expressão regular encontrou `BEGIN`.

## 2. Menor correção candidata

| Alvo | Artefato existente | Efeito |
|---|---|---|
| V01/V02 | `supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql` | Introduz guard por usuário/empresa/permissões existentes e revoga PUBLIC/anon EXECUTE; mantém authenticated/service_role. Preserva corpo financeiro. |
| V03 | `supabase/migrations/20261025110000_work_order_financial_tenant_guard.sql` | Mesma fronteira paraOS, preservando as agregações. |

Os hashes desses arquivos constam de `evidencias/base.json` e do manifesto final. Não há nova regra de negócio nem reimplementação financeira nesta etapa.

As migrações verificam assinatura/SECURITY DEFINER/argumento antes de alterar e são idempotentes no corpo nativo testado. Isso não elimina a revisão do DDL real. A existência do marcador não comprova que o guard permaneceu íntegro. Um marcador mal colocado exige revisão, não confiança automática.

## 3. Staging isolado e critérios de passagem

Reproduzir o **DDL metadado** implantado em ambiente descartável, sem copiar registros de clientes nem chaves reais. Criar Horizonte/Atlântico fictícias. Repetir antes/depois e verificar:

- Anônimo não recebe valores nem executa as funções após a correção; estrangeiro não altera contrato/OS mesmo conhecendo UUID. Membership/perfil desativados e authenticated sem sujeito são negados.
- Usuário autorizado da própria empresa mantém operação; serviço confiável mantém execução somente no servidor. Revisar se chamadores legítimos dependem de contextos de sessão distintos.
- V01: itens90.000+aditivo10.000 mantêm total100.000. V02: medido20.000/retido2.000. V03: autorizado20.000/executado8.000/aceito7.000/medido6.000. Estrangeiro não pode produzir esses recálculos; operação própria pode.
- Corpos financeiros antes/depois, removendo apenas o guard, têm hashes idênticos. ACL efetiva sem caminhos alternativos para anon/PUBLIC. Reaplicação não duplica o guard.
- Testar módulos HTTP/Auth integrais e chamadores operacionais antes de liberar. V01/V02 têm evidência HTTP herdada da14; V03 ainda exige HTTP/Auth integral. Contexto SQL `service_role` local não certifica worker remoto.

Reexecução14B:7 controles do coletor/artefatos,8 de guards contratuais e4 deOS aprovados;81 regressões e142 testes padrão aprovados. A massa/schemas parciais estão declarados. Não são substitutos da reprodução do DDL real e da configuração de gateway.

## 4. Aplicação futura, somente após autorização explícita

1. Revisão técnica/segurança aprova os diffs reais e os hashes. Responsáveis por operação e financeiro confirmam a matriz nominal aplicável, incluindo execução técnica por leitores e contexto do worker; o executor não assina por eles.
2. Aprovar janela, impacto, executor, monitoramento e critérios de abortar. Preparar snapshot de **DDL/ACL/metadados**, sem dados de negócio, guardado em local restrito e com hash. Registrar a disponibilidade dos procedimentos operacionais de recuperação existentes; não restaurar dados reais nesta etapa.
3. Aplicar **somente os dois arquivos aprovados**, não `supabase db push` ou a fila inteira de migrações. Cada arquivo possui sua própria transação; o lote não é atomicamente único. Se o segundo falhar, conservar o primeiro corrigido e investigar; não reabrirV01/V02.
4. Usar conexão administrativa autorizada do operador, nunca credenciais no browser. Definir timeout de locks/execução no processo operacional aprovado. Se houver drift desde o snapshot, abortar e revisar.
5. Recoletar metadados e comparar guard/corpo/ACL/proprietários/configurações. Atualização de cache do gateway, se necessária, é uma operação produtiva separada a aprovar. Não fazer chamadas de prova às RPCs vulneráveis nem consultar valores financeiros reais como teste deste plano.
6. Registrar operador, instante, hash, logs sem segredos, resultado e pendências. Monitoramento agregado por operação pode ocorrer no procedimento aprovado, sem expor registros financeiros no dossiê.

## 5. Reversão e contenção

- Falha antes do COMMIT: a transação da migração correspondente reverte automaticamente. Confirmar por metadados; não presumir que o arquivo seguinte também foi aplicado.
- Regressão do aplicativo: reverter a implantação do aplicativo preservando os guards/ACL corrigidos, se tecnicamente compatível. Preferir correção adiante revisada.
- Regressão de autorização grave: sob autorização de incidente, retirar EXECUTE interativo sem remover os guards. [sql/contencao-condicional.sql](sql/contencao-condicional.sql) revoga PUBLIC/anon/authenticated das três assinaturas; foi testado isoladamente. **Interrompe operações legítimas interativas.** Não altera dados nem concede privilégios novos.
- O script pressupõe que o inventário comprovou ausência de grants alternativos, herança ou chamadores SECURITY DEFINER que continuem disponíveis. Se existirem, elaborar contenção específica; não declarar bloqueio só pelos três REVOKE. Serviço privilegiado existente permanece; precisa de controle operacional próprio.
- **Não restaurar automaticamente DDL/ACL vulneráveis**, em especial PUBLIC/anon. O snapshot permite diagnóstico e recuperação seletiva; restaurar corpo legado sem guard recriaria a falha para authenticated. Qualquer exceção exige decisão explícita de segurança e outra contenção comprovada.
- Reabertura posterior de authenticated requer novamente guard íntegro, revisão de ACL efetiva e autorização de retomada. O operador deve recolher metadados após cada ação.

## Decisões, acessos e autorizações pendentes

| Necessidade | Quem deve prover/decidir | Bloqueia |
|---|---|---|
| Identificação atestada da produção e conexão/snapshot somente de metadados | Tecnologia/operador do banco; nominal a indicar | Conclusão SIM/NÃO sobre versão implantada. |
| Configuração externa não secreta do gateway, schemas, papéis/hooks e roteamento | Operador Supabase/API | Comprovação do caminho de acesso potencial em produção. |
| Revisão dos diffs reais, dependências e concessões adicionais | Responsável de segurança/DBA | Aprovação técnica da aplicação/contenção. |
| Matriz nominal, execução técnica por leitores e contexto do serviço | Responsáveis de tecnologia e financeiro; nominal/vigência pendentes | Aceite operacional da remediação, sem ampliar privilégios. |
| Autorização explícita de deploy/migração ou contenção, janela e reversão | Responsável autorizado pela produção | Qualquer escrita produtiva; nenhuma foi solicitada para execução nesta etapa. |
| Políticas de documentos/TTL/revogação de assinaturas | Segurança/produto/responsável financeiro conforme documento | Certificação dos canais listados separadamente. |

Não há aceite financeiro formal ou autorização produtiva registrados nesta entrega. Não houve aplicação de remediação, contenção ou rollback em produção.
