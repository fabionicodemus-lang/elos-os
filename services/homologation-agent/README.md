# Elos Homologation Agent

Agente Playwright para homologação autônoma do Elos OS.

## Segurança

O agente só inicia testes depois de confirmar `HOMOLOGATION_MARKER` na interface. O marcador padrão é `HORIZONTE TESTES`. Nunca configure o agente com credenciais da Bossa real.

## Variáveis obrigatórias

- `ELOS_BASE_URL`
- `ELOS_TEST_EMAIL`
- `ELOS_TEST_PASSWORD`
- `AGENT_RUN_TOKEN`

## Variáveis opcionais

- `HOMOLOGATION_MARKER=HORIZONTE TESTES`
- `GITHUB_TOKEN`
- `GITHUB_REPOSITORY=fabionicodemus-lang/elos-os`
- `HOMOLOGATION_ISSUE=165`

## API

- `GET /health`
- `POST /run` com `Authorization: Bearer <AGENT_RUN_TOKEN>` e JSON `{ "phase": "smoke" }`

A primeira versão percorre todas as rotas principais, valida sessão, HTTP, erros visíveis, tempo de resposta e captura evidências. As próximas versões adicionarão os roteiros de criação e transição de estado das fases 0 a 8.
