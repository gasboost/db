import type { z } from "zod";

export type TableDefinition<
  N extends string = string,
  S extends z.ZodObject<any> = z.ZodObject<any>,
> = {
  readonly name: N;
  readonly schema: S;
};

export type TableByName<
  T extends readonly TableDefinition[],
  N extends T[number]["name"],
> = Extract<T[number], { name: N }>;

export type TableRecord<
  T extends readonly TableDefinition[],
  N extends T[number]["name"],
> = z.infer<TableByName<T, N>["schema"]>;
