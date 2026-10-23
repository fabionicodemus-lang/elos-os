# Pendências adicionais — NÃO CERTIFICADAS

O resultado desta etapa não amplia a certificação limitada da [Etapa14](../etapa14-isolamento/CANAIS.md). Nenhum canal produtivo foi inspecionado. Não houve acesso a documentos de clientes.

| Canal | Evidência existente | Falta comprovar / decisão necessária | Estado14B |
|---|---|---|---|
| Buckets/anexos contratuais, notas manuais/eletrônicas, SEFAZ e anexos daIA | Políticas locais contratuais inspecionadas/reinstaladas; Storage bancário real exercitado apenas no recorte14. | Todos os buckets/fluxos, acesso por identificador, assinatura, upload/download/delete e matriz nominal, em infraestrutura compatível. | **NÃO CERTIFICADO**. |
| Exportações fiscais/XLSX e demais relatórios | JSON do fluxo testado no recorte14. | Caminhos fiscais/relatórios completos, sessão, filtros, cache e bytes exportados entre empresas. | **NÃO CERTIFICADO**. |
| Worker operacional, jobs, filas e integração remota | Testes locais de fronteira da importação; papel SQL de serviço. | Processo operacional, identidade/credenciais servidor, escopo por job e caminhos de bypass. Koper continua sem leitura/escrita nesta etapa. | **NÃO CERTIFICADO**. |
| Interface integral | Next/Chromium de rotas financeiras originais reexportadas no harness14. | Build integral estável e todos os caminhos de navegação/autorização; dev manifests apresentaram falhas. | **NÃO CERTIFICADO**. |
| URLs assinadas: expiração, reuso e revogação | Bancário local: URL válida200 sem sessão; expirada400. URL é credencial portadora temporária. | Política/TTL, invalidação após revogação de usuário/compartilhamento, necessidade de revalidar sessão a cada download e demais buckets. Não supor revogação imediata. | **NÃO CERTIFICADO** para identidade por download/revogação; expiração apenas no recorte anterior. |
| OS completo HTTP/Auth | Falha e guard daV03 testados em SQL com papéis/claims. | API/Auth/UI e chamadores completos deOS, na infraestrutura compatível. | **NÃO CERTIFICADO**. |
| Chat completo e outras ferramentas/caches daIA | Ferramenta financeira e loader reais contra PostgREST no recorte14, sem provedor externo. | Todas as ferramentas/personas, anexos, cache e contexto entre empresas. | **NÃO CERTIFICADO**. |
| Demais tabelas/RPCs e configuração implantada | Inventário local parcial, com scaffolds declarados. | Schema/ACL/RLS reais, configurações externas, outros canais e assinaturas. Não extrapolar resultado das três RPCs. | **NÃO CERTIFICADO**. |
| EntidadesA1/A2 na mesma organização e usuários multiempresa legitimamente associados | Pendência herdada; guard preserva associação legítima, sem proibição global artificial. | Matriz nominal por entidade/obra e casos integrais doCT24. | **NÃO CERTIFICADO integralmente**. |
| Recuperação de conta, MFA, revogação/renovação de sessões e demais fluxos de Auth | Senha/JWT inválido/expirado no recorte14. | Fluxos completos e política de sessão/revogação; sem testes novos nesta etapa. | **NÃO CERTIFICADO**. |

Manter o bloqueio global; responsáveis nominais e vigências ainda não informados. Não atribuir essas decisões a D02/D13: na norma v0.1, esses IDs tratam de corte/histórico e operações entre entidades/obras. Não houve nova decisão financeira nem aceite em nome do responsável.
