import type { ReactNode } from "react";

// Renderizador mínimo do Markdown que o Elos IA devolve (títulos, listas,
// tabelas, negrito, itálico e código). Monta elementos React, nunca HTML
// cru, então o texto do modelo não consegue injetar marcação na página.

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_PATTERN).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={key}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isTableRow = (line: string) => line.trim().startsWith("|") && line.trim().length > 1;
const unorderedItem = (line: string) => /^\s*[-*•]\s+(.*)$/.exec(line);
const orderedItem = (line: string) => /^\s*\d+[.)]\s+(.*)$/.exec(line);
const heading = (line: string) => /^(#{1,4})\s+(.*)$/.exec(line.trim());
const isRule = (line: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);

export function ElosIaMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const key = `block-${index}`;

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push(<hr key={key} />);
      index += 1;
      continue;
    }

    const headingMatch = heading(line);
    if (headingMatch) {
      const content = inline(headingMatch[2].replace(/\s+#+\s*$/, ""), key);
      blocks.push(headingMatch[1].length <= 2 ? <h3 key={key}>{content}</h3> : <h4 key={key}>{content}</h4>);
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="elos-ia-table-scroll" key={key}>
          <table>
            <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell, `${key}-h${cellIndex}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? "", `${key}-${rowIndex}-${cellIndex}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (unorderedItem(line) || orderedItem(line)) {
      const ordered = !unorderedItem(line);
      const items: string[] = [];
      while (index < lines.length) {
        const match = ordered ? orderedItem(lines[index]) : unorderedItem(lines[index]);
        if (match) {
          items.push(match[1]);
          index += 1;
        } else if (lines[index].trim() && /^\s{2,}\S/.test(lines[index]) && !unorderedItem(lines[index]) && !orderedItem(lines[index]) && items.length) {
          // Linha de continuação recuada pertence ao item anterior.
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
        } else {
          break;
        }
      }
      const children = items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `${key}-${itemIndex}`)}</li>);
      blocks.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length && lines[index].trim() && !heading(lines[index]) && !isRule(lines[index]) &&
      !unorderedItem(lines[index]) && !orderedItem(lines[index]) &&
      !(isTableRow(lines[index]) && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={key}>
        {paragraph.map((part, partIndex) => (
          <span key={partIndex}>{partIndex ? <br /> : null}{inline(part, `${key}-${partIndex}`)}</span>
        ))}
      </p>,
    );
  }

  return <div className="elos-ia-markdown">{blocks}</div>;
}
