import type { TableDefinition } from "@gasboost/query";
import type { z } from "zod";

export type ReplicaTableDefinition<
  N extends string = string,
  S extends z.ZodObject<any> = z.ZodObject<any>,
  PK extends Extract<keyof z.infer<S>, string> = Extract<
    keyof z.infer<S>,
    string
  >,
> = TableDefinition<N, S> & {
  readonly primaryKey: PK;
};

export type ValidReplicaTables<T extends readonly ReplicaTableDefinition[]> = {
  readonly [K in keyof T]: T[K] extends {
    readonly schema: infer S extends z.ZodObject<any>;
    readonly primaryKey: infer PK;
  }
    ? PK extends Extract<keyof z.infer<S>, string>
      ? T[K]
      : never
    : never;
};

export type ReplicaTableByName<
  T extends readonly ReplicaTableDefinition[],
  N extends T[number]["name"],
> = Extract<T[number], { name: N }>;

export type ReplicaRecord<
  T extends readonly ReplicaTableDefinition[],
  N extends T[number]["name"],
> = z.infer<ReplicaTableByName<T, N>["schema"]>;
