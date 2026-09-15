import type { TableDefinition, TableRecord } from "./TableDefinition";

export type QueryJoinNode<
  N extends string = string,
  J extends QueryJoins = QueryJoins,
> = {
  readonly table: N;
  readonly joins: J;
};

export type QueryJoins = {
  readonly [relationName: string]: QueryJoinNode;
};

export type SetQueryJoin<
  J extends QueryJoins,
  N extends string,
  V extends QueryJoinNode,
> = {
  readonly [K in keyof J | N]: K extends N
    ? V
    : K extends keyof J
      ? J[K]
      : never;
};

export type QueryRelations<
  T extends readonly TableDefinition[],
  J extends QueryJoins,
> = {
  [K in keyof J]: J[K] extends QueryJoinNode<infer N, infer NestedJoins>
    ? N extends T[number]["name"]
      ? QueryResult<T, N, NestedJoins>[]
      : never
    : never;
};

export type QueryResult<
  T extends readonly TableDefinition[],
  N extends T[number]["name"],
  J extends QueryJoins,
> = [keyof J] extends [never]
  ? TableRecord<T, N>
  : TableRecord<T, N> & {
      relations: QueryRelations<T, J>;
    };
