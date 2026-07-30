# Koper Worker

Serviço isolado da Elos OS para automação autorizada do Koper usando Playwright conectado a um navegador remoto no Browserless.

## Estado atual

Esta etapa entrega:

- servidor HTTP com endpoint de saúde;
- conexão segura ao Browserless;
- diagnóstico protegido que abre a página de login do Koper;
- sessão visual temporária e interativa para login manual;
- consulta protegida do status da sessão;
- encerramento explícito da sessão;
- container pronto para deploy no Railway;
- nenhuma senha do Koper armazenada.

A persistência criptografada do estado autenticado será implementada na próxima etapa.

## Arquitetura

```text
Railway / koper-worker
        |
        | WebSocket autenticado
        v
Browserless / Chromium remoto
        |
        | LiveURL temporária
        v
Login manual no Koper
```

## Variáveis obrigatórias

Use `services/koper-worker/.env.example` como referência.

- `WORKER_API_KEY`: chave interna com pelo menos 32 caracteres;
- `BROWSERLESS_WS_URL`: endpoint WebSocket fornecido pelo Browserless;
- `BROWSERLESS_TOKEN`: token secreto do Browserless;
- `KOPER_LOGIN_URL`: endereço real da tela de entrada do Koper;
- `KOPER_LOGIN_SESSION_TIMEOUT_MS`: duração da sessão visual, padrão de 5 minutos;
- `PORT`: porta HTTP, normalmente definida automaticamente pelo Railway.

Nunca coloque valores reais em arquivos versionados.

## Desenvolvimento pelo GitHub Codespaces

1. Abra o repositório `fabionicodemus-lang/elos-os` no GitHub.
2. Clique em **Code > Codespaces > Create codespace**.
3. No terminal online:

```bash
cd services/koper-worker
npm install
cp .env.example .env
npm run dev
```

4. Preencha o `.env` somente dentro do Codespace.
5. Exponha a porta `8080` como privada.

## Deploy no Railway

1. Crie um serviço a partir do repositório `fabionicodemus-lang/elos-os`.
2. Configure a branch `feature/koper-connector-bootstrap`.
3. Configure o **Root Directory** como:

```text
/services/koper-worker
```

4. Cadastre todas as variáveis da seção anterior.
5. Gere um domínio para o serviço.
6. Configure o health check como `/health`.

## Verificação

### Saúde do serviço

```bash
curl https://SEU-DOMINIO/health
```

### Diagnóstico do Browserless

```bash
curl -X POST \
  -H "Authorization: Bearer SUA_WORKER_API_KEY" \
  https://SEU-DOMINIO/diagnostics/browserless
```

O diagnóstico abre somente a URL de entrada do Koper e devolve o status HTTP, título e URL final.

## Login visual temporário

### Criar sessão

```bash
curl -X POST \
  -H "Authorization: Bearer SUA_WORKER_API_KEY" \
  https://SEU-DOMINIO/auth/koper/session
```

A resposta inclui:

- `sessionId`: identificador interno;
- `liveUrl`: link temporário e interativo do navegador remoto;
- `expiresAt`: vencimento da sessão.

O `liveUrl` não contém o token do Browserless, mas deve ser tratado como um link privado e temporário.

### Consultar status

```bash
curl \
  -H "Authorization: Bearer SUA_WORKER_API_KEY" \
  https://SEU-DOMINIO/auth/koper/session/SESSION_ID
```

O campo `authenticated` passa a `true` quando o navegador deixa o domínio de login do Koper.

### Encerrar sessão

```bash
curl -X DELETE \
  -H "Authorization: Bearer SUA_WORKER_API_KEY" \
  https://SEU-DOMINIO/auth/koper/session/SESSION_ID
```

## Próxima etapa

1. Persistir cookies e armazenamento da sessão de forma criptografada.
2. Detectar a expiração da autenticação entre execuções.
3. Mapear uma solicitação do Flow.
4. Capturar as requisições XHR/fetch e comparar com a leitura da tela.
5. Importar os primeiros registros para tabelas de staging no Supabase.
