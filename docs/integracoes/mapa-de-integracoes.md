# Mapa de Integrações — Elos OS

## Objetivo

O Elos OS é o sistema mestre. Koper, Sienge, ProObra, planilhas e outras fontes externas fornecem dados, mas seus códigos não definem a identidade interna do Elos.

O Mapa de Integrações mantém o de-para persistente entre uma chave externa e uma entidade canônica do Elos. Cada confirmação passa a ser reutilizada em importações futuras.

## Regras

1. Código externo é referência, não ID estrutural do Elos.
2. O mapa pode ter escopo de empresa ou de empreendimento.
3. Um vínculo confirmado nunca é trocado silenciosamente por fuzzy matching.
4. Vínculos rejeitados devem permanecer registrados como rejeitados para evitar sugestões repetidas.
5. Toda alteração é auditada.
6. Importadores consultam o mapa antes de tentar matching textual.
7. A importação deve ser idempotente; o mapa não substitui a chave externa do documento/lote.

## Modelo

### `integration_mappings`

Um registro representa uma chave externa persistente:

- `source_system`: sistema de origem (`koper`, `sienge`, `excel`, etc.);
- `source_entity_type`: tipo na origem (`cost_center`, `service`, `supplier`, etc.);
- `scope`: `company` ou `project`;
- `key_kind`: `id`, `code`, `name_unit` ou `custom`;
- `external_key`: chave normalizada usada na resolução;
- `external_*`: valores originais para auditoria;
- `target_entity_type`: tipo canônico no Elos;
- `target_entity_id`: ID canônico no Elos;
- `status`: `confirmed`, `suggested`, `rejected` ou `inactive`;
- `confidence` e `match_method`: explicam como o vínculo foi obtido;
- `metadata`: contexto auxiliar sem contaminar o modelo principal.

### `integration_mapping_audit`

Registra insert/update/delete com estado anterior, estado novo, usuário e data.

## Ordem de resolução

A função `resolve_integration_mapping` procura, nesta ordem:

1. `external_id`;
2. `external_code`;
3. `nome + unidade` normalizados.

Dentro da mesma chave, o escopo do empreendimento tem prioridade sobre o escopo global da empresa.

Somente `status = confirmed` é usado para resolução automática.

## Administração

A RPC `upsert_integration_mapping` exige `projects.manage` ou `admin.company.manage` quando executada por usuário autenticado.

A função `set_integration_mapping_status` permite confirmar, sugerir, rejeitar ou inativar um vínculo, sempre com auditoria.

## Compatibilidade com Koper

O de-para legado `engineering_cost_center_mappings` continua existindo durante a transição.

A migração:

- copia os vínculos já aprendidos para `integration_mappings`;
- faz `resolve_engineering_cost_center_service` consultar primeiro o mapa genérico;
- mantém o fallback legado;
- mantém o trigger operacional aprendendo novos vínculos em ambos os lugares.

Isso permite migrar os importadores por etapas sem quebrar compras, estoque ou solicitações de material.

## Próximas integrações

A sequência recomendada é:

1. orçamento Excel/Koper: `service`/`input` -> catálogo técnico Elos;
2. fornecedores: `supplier` -> fornecedor Elos;
3. apropriações financeiras: códigos externos -> serviço/estrutura de apropriação Elos;
4. lotes genéricos de importação e staging;
5. tela administrativa do mapa para revisão das exceções.

## Regra para novos importadores

Nunca fazer:

```text
não encontrei -> criar cadastro automaticamente
```

Fazer:

```text
mapa confirmado
  -> ID externo
  -> código exato
  -> nome + unidade normalizados
  -> alias/regra conhecida
  -> similaridade como sugestão
  -> revisão humana
  -> criar novo somente se realmente necessário
```
