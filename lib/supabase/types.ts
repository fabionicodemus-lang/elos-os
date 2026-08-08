// Atalhos sobre o schema gerado em types/database.ts.
//
// Preferir estes apelidos a redigitar o formato de cada linha à mão: quando uma
// migration muda uma coluna, o erro aparece no build em vez de em produção.

import type { Database, Json } from "@/types/database";

export type { Json };

export type PublicSchema = Database["public"];

/** Nome de qualquer tabela ou view do schema public. */
export type TableName = keyof PublicSchema["Tables"];

/** Linha lida de uma tabela: `Row<"clients">`. */
export type Row<T extends TableName> = PublicSchema["Tables"][T]["Row"];

/** Payload de inserção: `Insert<"clients">`. */
export type Insert<T extends TableName> = PublicSchema["Tables"][T]["Insert"];

/** Payload de atualização: `Update<"clients">`. */
export type Update<T extends TableName> = PublicSchema["Tables"][T]["Update"];

/** Nome de qualquer função exposta via RPC. */
export type RpcName = keyof PublicSchema["Functions"];

/** Argumentos de uma RPC: `RpcArgs<"payables_summary">`. */
export type RpcArgs<T extends RpcName> = PublicSchema["Functions"][T]["Args"];

/** Retorno de uma RPC: `RpcReturns<"payables_summary">`. */
export type RpcReturns<T extends RpcName> = PublicSchema["Functions"][T]["Returns"];
