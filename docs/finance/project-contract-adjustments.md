# Reajuste por empreendimento e contrato

## Uso

1. Em **Empreendimentos → Reajustes**, configurar separadamente os novos orçamentos e as parcelas dos novos contratos. Exige gestão de empreendimentos, orçamentos e vendas.
2. A configuração do empreendimento não altera contratos existentes. Aplicar aos orçamentos já cadastrados é uma opção explícita, desmarcada por padrão.
3. Em **Comercial → Vendas → contrato → Reajustes até e após as chaves**, definir a negociação individual: sem reajuste ou duas fases, índice de cada fase (inclusive nenhum), periodicidade mensal/anual, defasagem de 0/1/2 meses, mês-base, mês das chaves, carência e limite pelo vencimento ou mês atual.
4. Salvar cria uma versão imutável com autor, data e motivo. O padrão é preservar todas as parcelas existentes. Aplicação às parcelas elegíveis exige escolha explícita e permissão de gestão de recebíveis.
5. Em **Engenharia → Orçamentos → orçamento → Reajuste e memória**, consultar referência e saldo reajustados, separadamente do orçamento nominal e dos custos históricos.

## Convenções de cálculo

- Competências mensais, sem pró-rata diário. Até o mês das chaves, inclusive, usa-se a primeira fase; a segunda começa no mês seguinte, tomando as chaves como base. O mês das chaves é próprio do contrato e não acompanha alterações na previsão de entrega da obra.
- O valor acumula os fatores das duas fases. Exemplo de teste: R$ 1.000 × (CUB 110 / CUB 100) × (1 + IPCA 1%) = R$ 1.111. Índices numéricos de séries distintas nunca são divididos entre si.
- Sem índice na segunda fase conserva os R$ 1.100 acumulados até as chaves. Sem reajuste no contrato inteiro conserva o nominal. Juros e encargos existentes são somados separadamente; esta entrega não cria uma nova modalidade de financiamento ou juros compostos.
- A carência seleciona parcelas pelo mês de vencimento em relação ao mês-base. O fator continua medido a partir da base contratual. A periodicidade anual aplica aniversários completos de cada fase.
- Defasagem desloca as competências-base e alvo; não é uma autorização para substituir um mês ausente pelo último disponível.
- Índices numéricos exigem valores das competências exatas. Índices percentuais exigem a série mensal completa. Falta de dados preserva o último valor calculado, informa pendência e impede preparar nova cobrança.
- Publicar/editar/remover valores de qualquer índice das duas fases reavalia parcelas elegíveis. A preparação da cobrança também reavalia o contrato antes de congelar a memória no boleto. A publicação mensal automática do CUB-SC continua separada desta configuração; os demais índices precisam estar cadastrados e alimentados.

## Proteções

- Não há atualização em massa de contratos na migration. Projetos começam sem padrão configurado; as regras anteriores continuam operando.
- Contratos novos de projetos com reajuste ativado começam pendentes até a negociação individual. Com reajuste desativado, começam sem reajuste, podendo ter exceção explícita.
- Importações não herdam padrões nem emitem cobranças. Parcelas eObra, travadas, pagas, parcialmente recebidas, canceladas ou com cobrança não cancelada são excluídas da revisão e da atualização automática.
- Cada parcela guarda a versão que a originou. Uma revisão contratual não altera a versão de outras parcelas sem a opção explícita. Remover a referência de uma versão existente é bloqueado; desativar exige nova revisão sem reajuste.
- RLS e funções verificam empresa, empreendimento, contrato, índice e permissões; tabelas de versões e eventos não permitem escrita direta por usuários. Concorrência de revisões usa a versão esperada e bloqueio da venda.
- Valores nominais de orçamento e custos realizados/comprometidos permanecem históricos. Só o saldo positivo recebe atualização na visualização existente; um estouro permanece negativo nominal. Publicação ausente aparece como pendente.

## Instalação e validação

Dependência: `20261014091000_preconstruction_budget_indexation.sql` (módulo de orçamento já existente no repositório). Aplicar antes de `20261127145736_project_contract_adjustment_policies.sql`. A segunda migration verifica as assinaturas do motor legado e da preparação bancária antes de adaptar seus corpos, evitando sobrescrever mudanças incompatíveis.

Testes locais: `node --test tests/finance/contract-adjustment*.test.mjs`, além das suítes CUB-SC, cobrança, pré-obra e importação eObra, TypeScript e build. A suíte PostgreSQL usa PGlite, empresas e contratos fictícios e relógio fixo; não envia documentos nem registra boletos reais. A interface é verificada com dados fictícios.

A homologação de emissão bancária depende dos conectores/credenciais Sicredi e Santander e permanece independente desta entrega. Não usar alterações de padrão ou revisões para reconstruir automaticamente o histórico já importado do eObra.
