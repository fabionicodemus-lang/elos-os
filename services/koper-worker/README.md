# Koper Worker

Serviço isolado da Elos OS para automação autorizada do Koper usando Playwright conectado a um navegador remoto no Browserless.

## Estado atual

Esta primeira etapa entrega apenas:

- servidor HTTP com endpoint de saúde;
- conexão segura ao Browserless;
- diagnóstico protegido que abre a página de login do Koper;
- container pronto para deploy no Railway;
- nenhuma senha do Koper armazenada.

A autenticação manual assistida e a persistência da sessão serão implementadas na próxima etapa.

## Arquitetura

```text
Railway / koper-worker
        |
        | WebSocket autenticado
        v
Browserless / Chromium remoto
        |
        v
Koper
```

## Variáveis obrigatórias

Use `services/koper-worker/.env.example` como referência.

- `WORKER_API_KEY`: chave interna com pelo menos 32 caracteres;
- `BROWSERLESS_WS_URL`: endpoint WebSocket fornecido pelo Browserless;
- `BROWSERLESS_TOKEN`: token secreto do Browserless;
- `KOPER_LOGIN_URL`: endereço real da tela de entrada do Koper;
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

1. Crie um projeto no Railway a partir do repositório GitHub `fabionicodemus-lang/elos-os`.
2. Crie um serviço para o worker.
3. Configure o **Root Directory** como:

```text
/services/koper-worker
```

4. O Railway encontrará o `Dockerfile` dentro dessa pasta.
5. Cadastre todas as variáveis da seção anterior no painel do serviço.
6. Gere um domínio para o serviço.
7. Configure o health check para:

```text
/health
```

## Verificação

### Saúde do serviço

```bash
curl https://SEU-DOMINIO/health
```

Resposta esperada:

```json
{
  "ok": true,
  "service": "koper-worker"
}
```

### Diagnóstico do Browserless

```bash
curl -X POST \
  -H "Authorization: Bearer SUA_WORKER_API_KEY" \
  https://SEU-DOMINIO/diagnostics/browserless
```

O diagnóstico abre somente a URL de entrada do Koper e devolve o status HTTP, título e URL final. Ele não envia usuário ou senha.

## Próxima etapa

1. Criar sessão visual remota para login manual.
2. Persistir cookies e armazenamento da sessão de forma criptografada.
3. Detectar expiração da autenticação.
4. Mapear uma solicitação do Flow.
5. Capturar as requisições XHR/fetch e comparar com a leitura da tela.
6. Importar os primeiros registros para tabelas de staging no Supabase.
