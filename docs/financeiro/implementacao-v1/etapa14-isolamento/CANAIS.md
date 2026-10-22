# Canais e decisão de certificação

**BLOQUEAR certificação global/liberação multiempresa.** “Certificado no recorte” vale somente para a candidata, massa fictícia, configurações e caminhos executados. Não certifica produção, o conjunto de todas as tabelas/RPCs ou a intenção nominal dos perfis.

| Canal | Situação | Comprovação / limite |
|---|---|---|
| Auth por senha / senha incorreta |CERTIFICADO NO RECORTE|GoTrue real,8 identidades. Senha incorreta sem sessão; login próprio mantém a identidade. Outros fluxos de Auth não executados.|
| JWT da API |CERTIFICADO NO RECORTE|Assinatura adulterada e expiração retornam401 no PostgREST. Não houve uso de credencial de cliente.|
| RLS: AP/AR, contratos, bancos, eventos/linhas de liquidação, movimentos, auditoria, itens/aditivos |CERTIFICADO NO RECORTE|Consultas reais por UUID e filtro de empresa retornam0 linhas estrangeiras, preservando as próprias conforme perfil. DDL de Engenharia contém scaffolds explícitos; não certifica todos os campos/tabelas remotos.|
| Mutação financeira e servidor |CERTIFICADO NO RECORTE|PATCH estrangeiro não altera registros; liquidação estrangeira negada; revisão própria permitida a Financeiro/Admin e negada aos demais. Novas RPCs contratuais verificam empresa/permissão e negam anon.|
| Interface financeira original |CERTIFICADO NO RECORTE|Chromium e build de produção limitado a rotas originais reexportadas; página própria, URL estrangeira, cookies forjados e troca de identidade no mesmo contexto. Sem substituição de AppShell/workspace/autorização.|
| Interface integral / modo desenvolvimento do Elos |NÃO CERTIFICADO|`next dev` apresentou erros intermitentes de manifests, inclusive em acesso legítimo. Build integral do OS não foi executado; o harness usa um subconjunto explícito de rotas.|
| Exportação JSON do fluxo |CERTIFICADO NO RECORTE|HTTP real, empresa do workspace,403 no filtro estrangeiro, cookie estrangeiro ignorado e no-store.|
| Exportações fiscais/XLSX e demais relatórios |NÃO CERTIFICADO|Não executados de ponta a ponta nesta infraestrutura parcial. Não extrapolar o resultado do JSON.|
| Documentos bancários: metadados/bytes |CERTIFICADO NO RECORTE|StorageAPI real, bucket privado, upload/registro próprios. Download, assinatura, upload e exclusão estrangeiros negados; arquivo original preservado.|
| URL pública de bucket privado / assinatura expirada |CERTIFICADO NO RECORTE|Caminho conhecido não abre URL pública; assinatura da fixture expira e nega leitura.|
| Reuso/compartilhamento de URL assinada válida |NÃO CERTIFICADO para vincular cada download ao usuário|A URL válida respondeu200 sem sessão. É credencial portadora. Confirmar se esse comportamento/TTL atende à política ou se é necessário download mediado com revalidação. Não é prova de vazamento apenas por ID.|
| Anexos contratuais, notas manuais/eletrônicas, SEFAZ, anexos da IA |NÃO CERTIFICADO|Políticas contratuais inspecionadas/reinstaladas; não foram exercitados todos os buckets/fluxos de criação, assinatura e consumo. Engenharia não deve receber acesso irrestrito por inferência.|
| Rotinas de importação: fronteira SQL/API |CERTIFICADO NO RECORTE|Função privada não exposta por REST; entrada interna com claims deA nega empresaB antes do manifesto. Dados/remoto Koper não utilizados.|
| Worker, jobs, filas e integração remota |NÃO CERTIFICADO|Processo/credenciais operacionais e execução remota não exercitados. Controles24 da Etapa6 repetidos são evidência técnica herdada, não validação remota.|
| Carregador de indicadores do fluxo |CERTIFICADO NO RECORTE|`loadCashflow` real sobre PostgREST rejeita empresa/entidade estrangeira por causa de autorização, não por erro de schema. Valores próprios conservados.|
| Consulta financeira utilizada pela IA |CERTIFICADO NO RECORTE|Dispatcher e ferramenta `fluxo_de_caixa` reais, permissões e consultas HTTP reais; negação por perfil/perímetro registrada.|
| Chat completo, provedor e outras ferramentas da IA |NÃO CERTIFICADO|Sem chamada ao provedor externo nem execução de todas as ferramentas/personas/caches.|
| Recalcular totais de OS |CERTIFICADO SOMENTE EM SQL|Falha e correção demonstradas com papéis/claims e função nativa. Caminho HTTP/Auth e módulo completo de OS permanecemNÃO CERTIFICADOS.|
| Mesma organização com entidadesA1/A2 e usuários multi-organização |NÃO CERTIFICADO integralmente neste lote|Escopo exclusivo entre construtoras/`company_id`. As pendências da Etapa13 e o CT24 completo permanecem. Não foi removida autorização legítima de usuário associado às duas empresas.|

## Condições objetivas para retirar o bloqueio global

1. Executar os caminhos/buckets/exportações/RPCs ainda não certificados com a mesma matriz negativa e operações próprias, em infraestrutura integral compatível.
2. Validar schema/políticas/versões da implantação autorizada, sem supor que o scaffold local equivale ao remoto. As migrações desta tarefa são somente candidatas; não foram aplicadas à produção.
3. Aprovar a matriz nominal por empresa, perfil, entidade e canal, inclusive alcance de Engenharia e execução técnica por leitores. Não há responsável nominal identificado; financeiro e tecnologia devem indicar quem decide e a vigência.
4. Decidir e testar política de URLs assinadas, expiração e compartilhamento; confirmar se é exigida autorização de sessão em cada download.
5. Registrar revisão técnica das correções e aceites aplicáveis pelo responsável. O executor não assina aceite financeiro nem amplia privilégios para obter aprovação.

Até essas condições serem cumpridas, a candidata fica apta à revisão técnica dos recortes, sem declaração de isolamento global ou liberação produtiva.
