import type {
  KeyedTableDefinition,
  TableByName,
  TableColumnName,
  TableRecordByName,
} from "@gasboost/table";

export type ReplicaTableDefinition<
  N extends string = string,
  S extends KeyedTableDefinition["schema"] = KeyedTableDefinition["schema"],
  PK extends KeyedTableDefinition<N, S>["primaryKey"] = KeyedTableDefinition<
    N,
    S
  >["primaryKey"],
> = KeyedTableDefinition<N, S, PK>;

export type ValidReplicaTables<T extends readonly ReplicaTableDefinition[]> = {
  readonly [K in keyof T]: T[K] extends ReplicaTableDefinition
    ? T[K]["primaryKey"] extends TableColumnName<T[K]>
      ? T[K]
      : never
    : never;
};

export type ReplicaTableByName<
  T extends readonly ReplicaTableDefinition[],
  N extends T[number]["name"],
> = TableByName<T, N>;

export type ReplicaRecord<
  T extends readonly ReplicaTableDefinition[],
  N extends T[number]["name"],
> = TableRecordByName<T, N>;
