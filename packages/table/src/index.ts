import type { z } from "zod";

export type TableDefinition<
  N extends string = string,
  S extends z.ZodObject<any> = z.ZodObject<any>,
> = {
  readonly name: N;
  readonly schema: S;
};

export type KeyedTableDefinition<
  N extends string = string,
  S extends z.ZodObject<any> = z.ZodObject<any>,
  PK extends Extract<keyof z.infer<S>, string> = Extract<
    keyof z.infer<S>,
    string
  >,
> = TableDefinition<N, S> & {
  readonly primaryKey: PK;
};

export type TableName<T extends TableDefinition> = T["name"];

export type TableRecord<T extends TableDefinition> = z.infer<T["schema"]>;

export type TableColumnName<T extends TableDefinition> = Extract<
  keyof TableRecord<T>,
  string
>;

export type TableColumnValue<
  T extends TableDefinition,
  K extends TableColumnName<T>,
> = TableRecord<T>[K];

export type TableByName<
  T extends readonly TableDefinition[],
  N extends T[number]["name"],
> = Extract<T[number], { readonly name: N }>;

export type TableRecordByName<
  T extends readonly TableDefinition[],
  N extends T[number]["name"],
> = TableRecord<TableByName<T, N>>;

export type PrimaryKey<T extends KeyedTableDefinition> = T["primaryKey"];

export function defineTable<
  const N extends string,
  const S extends z.ZodObject<any>,
  const PK extends Extract<keyof z.infer<S>, string>,
>(definition: KeyedTableDefinition<N, S, PK>): KeyedTableDefinition<N, S, PK>;

export function defineTable<
  const N extends string,
  const S extends z.ZodObject<any>,
>(definition: TableDefinition<N, S>): TableDefinition<N, S>;

export function defineTable(definition: TableDefinition): TableDefinition {
  return definition;
}
