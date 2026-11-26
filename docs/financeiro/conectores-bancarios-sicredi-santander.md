# Sicredi e Santander — etapa técnica de sandbox

Este pacote faz parte da Central de Cobrança (PR #384). Os dois clientes HTTP usam somente os endereços oficiais de sandbox. Não são acionados pelo cron, pelo navegador ou pelo worker operacional; nenhum banco foi consultado com credenciais reais e nenhum título foi lançado. `test_only` no escopo, na cobrança e no pagador é obrigatório. A saída indica **registro no banco de teste** (`registered_at_bank`), não registro liberado para a carteira Elos.

## 1. Solicitar habilitação hoje

### Mensagem ao Sicredi

Olá! A AR Incorporadora está migrando seu ERP para o Elos OS. Solicitamos habilitar a API de Cobrança Online para as contas/convênios atuais das SPEs e orientar o acesso ao sandbox e, após homologação, à produção. Precisamos de autenticação, registro e consulta de boletos, PDF, instruções de baixa, consultas de liquidações e configuração de notificações. Favor informar se podemos manter o convênio e carteira atuais, como preservar a numeração dos boletos em circulação, parâmetros de cooperativa/posto/beneficiário e dados fictícios homologados. Precisamos também confirmar a habilitação do extrato/retorno de conciliação e o prazo estimado. Pedimos que o compartilhamento de credenciais seja feito por canal seguro.

### Mensagem ao Santander

Olá! A AR Incorporadora está migrando seu ERP para o Elos OS. Solicitamos habilitar a API do Hub de Cobrança para os convênios atuais das SPEs, com sandbox, ambiente de produção após homologação, certificado digital, Client ID/Secret, workspace de cobrança, registro/consulta, instrução de baixa, segunda via em PDF e consulta de liquidação. Favor informar se é possível manter os convênios e carteiras atuais, como reservar Nosso Número sem conflitar com os boletos em circulação, quais dados fictícios usar no teste e quais rotas/layouts estão vigentes. Precisamos confirmar também o extrato/retorno de conciliação e as notificações, e estimar prazo de liberação. Pedimos canal seguro para as credenciais.

## 2. Escopo dos conectores

| Operação | Sicredi | Santander |
| --- | --- | --- |
| Autenticação | OAuth2 com código de acesso por convênio, API Key | OAuth2 Client Credentials sobre TLS mútuo com certificado próprio |
| Registro de teste | POST boleto v1; validação posterior GET por Nosso Número | POST bank_slips do workspace v2, `environment=TESTE`; validação posterior GET |
| Consulta | Nosso Número + convênio no escopo cooperativa/posto | Nosso Número + convênio; consulta detalhada bankslip |
| Instrução de cancelamento | Solicita baixa; só considera cancelada quando consulta confirma baixa por solicitação | Solicita baixa; permanece pendente até distinguir baixa solicitada de pagamento Pix |
| PDF | Solicita documento oficial, confere assinatura de arquivo PDF | Serviço oficial de PDF documentado como produção; não tenta acessar produção do sandbox |
| Recebimentos | Observação de dados de liquidação | Consulta settlement |

Cada consulta exige o mesmo beneficiário, conta, empreendimento, SPE, empresa e identificador reservado. O resultado de registro precisa conferir o pagador, referência, valor, vencimento e códigos bancários consistentes. A consulta Santander simplificada pode não ter todos os dados: nesses casos a consulta detalhada deve devolver identidade compatível; caso contrário fica pendente. No Santander, status baixado não é evidência suficiente de cancelamento. Nenhuma observação de liquidação é baixa financeira: os dados devem passar pela conciliação já implementada. Em produção é necessário distinguir bruto, líquido, tarifa, estorno e crédito em conta.

### Controle de duplicação

Os comandos de teste usam journal persistente em diretório privado e duas reservas exclusivas (cobrança e nosso número). Consulta sempre antecede o POST. Um timeout, resposta ambígua ou falha não libera a reserva; o próximo ciclo consulta, sem repetir a escrita. Os números são **fornecidos pelo banco/convênio de teste**: não inventar sequência ou dígito verificador, nem ocupar faixa já usada pelo eObra. O journal local tem finalidade exclusivamente de sandbox; a produção precisa de reservas transacionais, compartilhadas pelos workers no banco de dados, com migração segura da numeração.

## 3. Rodar testes sem credenciais

`npm run test:bank-sandbox` usa respostas simuladas e não realiza chamadas bancárias. `npm run test:collections` inclui os testes da central, worker e conectores. A API do banco pode ter diferenças nos payloads reais; não ativar produção a partir de mocks.

## 4. Homologação ao receber credenciais

1. Obter dados de teste oficiais e confirmação do convênio/carteira/espécie de documento e numeração. Não usar CPF/CNPJ, boleto ou cliente real como pagador de teste.
2. Criar arquivo JSON de fixture **fora do Git**, contendo `scope`, `charge`, `payer`, `reservation`. Usar os nomes e formatos abaixo com identificadores fornecidos pelo banco. Os valores não são credenciais nem dados bancários válidos por si só.
   - `scope`: `environment: sandbox`, `test_only: true`, `provider`, `company_id`, `project_id`, `legal_entity_id`, `bank_account_id`, `config_id`, `agreement`, `beneficiary_cnpj`, `bank_code`, `document_kind`; Sicredi: `cooperative`, `post`; Santander: `workspace_id`.
   - `charge`: repetir os campos de escopo de empresa/projeto/SPE/conta/configuração/provedor/convênio/beneficiário, `test_only: true`, `id`, `amount` (decimal em reais, string), `due_date` (ISO), `account_snapshot: { bank: ... }`.
   - `payer`: `test_only: true`, `document`, `name`, `address`, `neighborhood`, `city`, `state`, `zip`.
   - `reservation`: `bankNumber`, `customerRef`, `issueDate`; Sicredi: `externalRef`; Santander: `nsuCode`. Manter invariáveis todos os identificadores durante a tentativa e recuperação; ajustar data apenas antes da reserva. Usar sequência confirmada pelo banco.
3. Definir no servidor de teste `ELOS_BANK_TEST_FIXTURE` (caminho da fixture) e `ELOS_BANK_TEST_JOURNAL` (diretório privado persistente compartilhado pelas execuções de homologação).
4. Sicredi: `ELOS_SICREDI_TEST_API_KEY`, `ELOS_SICREDI_TEST_ACCESS_CODE`, `ELOS_SICREDI_TEST_USERNAME`.
5. Santander: `ELOS_SANTANDER_TEST_CLIENT_ID`, `ELOS_SANTANDER_TEST_CLIENT_SECRET`, `ELOS_SANTANDER_TEST_PFX_PATH`, `ELOS_SANTANDER_TEST_PFX_PASSPHRASE`. Não commitar certificado privado, chave ou senha.
6. Executar `node lib/collections/bank-sandbox/run.mjs query` para consultar o título e verificar autorização. Depois de confirmar dados fictícios e a reserva, executar `register`, `query`, `pdf`, `settlement`, `cancel` individualmente. O CLI só imprime situação e contagem de bytes, nunca imprime boleto, resposta bruta ou segredo. Para inconclusivos, consultar o banco sem reenviar POST/PATCH.

## 5. Antes de liberar a AR

- Homologar os payloads reais e confirmar estados de registro/cancelamento em cada banco. Sicredi tem consultas/webhook com diferenças de disponibilidade entre ambientes. Santander precisa validar o retorno de segunda via em PDF e o motivo de baixa; manter ambos bloqueados até confirmação.
- Implementar registro de tentativas transacional no Supabase, referências por conta/convênio, recuperação persistente no worker e guarda de documentos privados. Apenas depois ligar o adaptador de produção, com configuração auditada, credenciais exclusivas de produção e autorização específica do cliente.
- Importar identificadores dos boletos já registrados no eObra sem reemitir, preservar correção e conferir a numeração. Cada SPE pode configurar seu banco e convênio; nunca redirecionar fundos de uma SPE para outra.
- Configurar o retorno CNAB 240/400 como contingência; solicitar um par real anonimizado de remessa e retorno de cada banco/convênio e homologar os respectivos layouts/códigos de ocorrência. O CNAB não está implementado neste pacote.
- Confirmar retorno/extrato conciliado, crédito efetivo, tarifas e estornos, autenticar webhooks, deduplicar eventos e integrar e-mail/WhatsApp. Nenhum envio real até todos os requisitos de registro e conciliação estarem atendidos.

## Documentação oficial consultada

- Sicredi: [Como obter acesso](https://developers.sicredi.com.br/public/docs/como-obter-acesso-%C3%A0-api-de-cobran%C3%A7a), [OAuth](https://developers.sicredi.com.br/public/reference/autenticar), [Registro](https://developers.sicredi.com.br/public/reference/cadastrarboleto), [Manual 3.9.1](https://www.sicredi.com.br/media/produtos/filer_public/2026/04/20/manual_da_api_da_cobranca_-_391.pdf), [Comandos](https://developers.sicredi.com.br/public/docs/comandos-de-instru%C3%A7%C3%A3o).
- Santander: [Portal do desenvolvedor](https://developer.santander.com.br/), [Guia API Cobrança v2.5](https://developer.santander.com.br/sites/default/files/2024-02/user_guide_api_de_cobranca_pt_br_v2_5.pdf). Conferir contrato/OpenAPI vigente no portal antes da homologação.
