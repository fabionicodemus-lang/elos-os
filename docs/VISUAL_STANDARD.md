# Elos OS — Padrão Visual Oficial

Este documento congela o padrão visual do arquivo de referência entregue por Fábio em 23/07/2026 (`Elos OS - Revisao.html`). Toda tela nova ou redesenhada deve reutilizar a estrutura compartilhada e os tokens abaixo.

## Estrutura obrigatória

- Aplicação desktop em duas colunas: sidebar de `272px` + conteúdo flexível.
- Sidebar escura `#0f1c1b`, fixa e com rolagem própria.
- Área principal com rolagem própria e fundo `#eef1f0`.
- Cabeçalho branco de `72px`, sticky, com empresa, breadcrumb, seletor de empreendimento, busca e usuário.
- Conteúdo interno com espaçamento padrão de `28px 32px 60px`.
- No mobile, sidebar vira drawer lateral e o conteúdo permanece com cabeçalho fixo.

## Identidade

- Cor principal: `#008780`.
- Cor principal forte: `#00615c`.
- Fundo suave da marca: `#e2f1ef`.
- Fundo geral: `#eef1f0`.
- Texto: `#16211f`.
- Muted: `#5f7d79`.
- Bordas: `#e5eae8`.
- Fonte de títulos: Space Grotesk.
- Fonte de interface: IBM Plex Sans.

## Componentes

- Títulos de página: eyebrow teal, título Space Grotesk, descrição e badge de versão.
- Botões: altura mínima de `40px`, raio `11px`, borda clara; ação principal em teal.
- Cards: fundo branco, borda clara, raio entre `14px` e `17px`, sombra discreta.
- Tabelas: cabeçalho cinza muito claro, títulos em caixa alta com `9px`, linhas de `12px`, rolagem horizontal em telas menores.
- Status: pills pequenas com cores semânticas.
- Formulários: campos com raio `11px`, foco teal e halo translúcido.
- Menus de módulo: grupo expansível, item principal ativo em teal e subitem ativo em teal translúcido.

## Implementação

- A estrutura oficial está em `components/app-shell.tsx`.
- A navegação responsiva está em `components/shell-navigation.tsx`.
- O seletor global de obra está em `components/project-switcher.tsx`.
- Os estilos oficiais estão em `app/elos-theme.css`.
- Nenhuma página protegida deve recriar sidebar ou cabeçalho localmente.
- Páginas protegidas devem ser renderizadas dentro de `AppShell`.
- Novos estilos devem ampliar o tema existente, sem criar outra paleta ou outro padrão de botão/card/tabela.
