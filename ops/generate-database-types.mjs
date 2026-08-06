// Gera types/database.ts a partir de um banco Postgres que já recebeu todas as
// migrations de supabase/migrations.
//
// Usa @supabase/postgres-meta — o mesmo código que a CLI do Supabase executa em
// `supabase gen types typescript`. A CLI foi descartada aqui porque exige Docker
// mesmo com --db-url, o que não existe no CI nem no ambiente de shadow database.
//
// Uso: node ops/generate-database-types.mjs "postgresql://..." [arquivo-de-saida]

import { writeFileSync } from "node:fs";
import { PostgresMeta } from "@supabase/postgres-meta";
import { getGeneratorMetadata } from "@supabase/postgres-meta/dist/lib/generators.js";
import { apply as applyTypescriptTemplate } from "@supabase/postgres-meta/dist/server/templates/typescript.js";

// O Postgres não declara nulabilidade de parâmetro: toda função aceita NULL em
// qualquer argumento. O gerador não tem como saber disso e emite `p_x: string`,
// o que reprova as chamadas que passam NULL de propósito.
//
// Trocar essas chamadas por `undefined` não seria equivalente: o PostgREST omite
// a chave e a função usa o DEFAULT, em vez de gravar NULL. Por isso a correção é
// alargar o tipo aqui, refletindo o que o banco realmente aceita.
function widenFunctionArgs(source) {
  const functionsIndex = source.indexOf("    Functions: {");
  if (functionsIndex === -1) return source;

  const head = source.slice(0, functionsIndex);
  const tail = source.slice(functionsIndex);
  let insideArgs = false;

  const widenType = (type) => (/\bnull\b/.test(type) ? type : `${type} | null`);

  const widened = tail
    .split("\n")
    .map((line) => {
      // Args curto cabe em uma linha só: `Args: { p_a: string; p_b?: string }`.
      const inline = line.match(/^(\s+Args: \{ )(.+)( \})$/);
      if (inline) {
        const [, prefix, body, suffix] = inline;
        const properties = body.split("; ").map((property) => {
          const parsed = property.match(/^([A-Za-z_][\w]*\??): (.+)$/);
          return parsed ? `${parsed[1]}: ${widenType(parsed[2])}` : property;
        });
        return `${prefix}${properties.join("; ")}${suffix}`;
      }

      if (/^\s+Args: \{$/.test(line)) {
        insideArgs = true;
        return line;
      }
      if (insideArgs && /^\s+\}$/.test(line)) {
        insideArgs = false;
        return line;
      }
      if (!insideArgs) return line;

      const property = line.match(/^(\s+)([A-Za-z_][\w]*)(\??): (.+?)(,?)$/);
      if (!property) return line;

      const [, indent, name, optional, type, comma] = property;
      return `${indent}${name}${optional}: ${widenType(type)}${comma}`;
    })
    .join("\n");

  return head + widened;
}

const connectionString = process.argv[2];
const outputPath = process.argv[3] ?? "types/database.ts";

if (!connectionString) {
  console.error("Informe a URL de conexão do banco como primeiro argumento.");
  process.exit(1);
}

const pgMeta = new PostgresMeta({ connectionString, max: 1 });

try {
  const { data: metadata, error } = await getGeneratorMetadata(pgMeta, {
    includedSchemas: ["public"],
    excludedSchemas: [],
  });

  if (error) {
    console.error("Falha ao ler o schema:", error.message);
    process.exit(1);
  }

  const generated = await applyTypescriptTemplate({
    ...metadata,
    detectOneToOneRelationships: true,
  });

  const types = widenFunctionArgs(generated);

  const header = [
    "// GERADO AUTOMATICAMENTE — NÃO EDITE À MÃO.",
    "// Regenere com: npm run db:types (veja ops/README-shadow-db.md).",
    "// A fonte é o schema materializado a partir de supabase/migrations.",
    "",
  ].join("\n");

  writeFileSync(outputPath, `${header}${types}`);
  console.log(`Tipos gravados em ${outputPath}`);
} finally {
  await pgMeta.end();
}
