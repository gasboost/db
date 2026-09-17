import type { TableDefinition } from "@gasboost/table";
import type { z } from "zod";

type PrincipalKeyCarrier<K extends string> = {
  readonly __principalKeys?: K;
};

export type ValueExpression<T, K extends string = string> = (
  | ColumnExpression<T>
  | OuterColumnExpression<T>
  | PrincipalExpression<T, K>
  | LiteralExpression<T>
) &
  PrincipalKeyCarrier<K>;

export type PredicateExpression<K extends string = string> = (
  | AllowExpression
  | EqExpression<K>
  | AndExpression<K>
  | OrExpression<K>
  | ExistsExpression<K>
) &
  PrincipalKeyCarrier<K>;

export type ColumnExpression<T> = {
  readonly type: "column";
  readonly table: string;
  readonly column: string;
  readonly __value?: T;
};

export type OuterColumnExpression<T> = {
  readonly type: "outerColumn";
  readonly table: string;
  readonly column: string;
  readonly __value?: T;
};

export type PrincipalExpression<T, K extends string = string> = {
  readonly type: "principal";
  readonly key: K;
  readonly __value?: T;
};

export type LiteralExpression<T> = {
  readonly type: "literal";
  readonly value: T;
  readonly __value?: T;
};

export type AllowExpression = {
  readonly type: "allow";
};

export type EqExpression<K extends string = string> = {
  readonly type: "eq";
  readonly left: ValueExpression<unknown, K>;
  readonly right: ValueExpression<unknown, K>;
};

export type AndExpression<K extends string = string> = {
  readonly type: "and";
  readonly conditions: readonly PredicateExpression<K>[];
};

export type OrExpression<K extends string = string> = {
  readonly type: "or";
  readonly conditions: readonly PredicateExpression<K>[];
};

export type ExistsExpression<K extends string = string> = {
  readonly type: "exists";
  readonly table: TableDefinition;
  readonly condition: PredicateExpression<K>;
};

type TableValue<
  T extends TableDefinition,
  K extends keyof z.infer<T["schema"]>,
> = z.infer<T["schema"]>[K];

type PrincipalValue<
  S extends z.ZodObject<any>,
  K extends keyof z.infer<S>,
> = z.infer<S>[K];

export function column<
  T extends TableDefinition,
  K extends Extract<keyof z.infer<T["schema"]>, string>,
>(table: T, key: K): ValueExpression<TableValue<T, K>, never> {
  return {
    type: "column",
    table: table.name,
    column: key,
  };
}

export function outerColumn<
  T extends TableDefinition,
  K extends Extract<keyof z.infer<T["schema"]>, string>,
>(table: T, key: K): ValueExpression<TableValue<T, K>, never> {
  return {
    type: "outerColumn",
    table: table.name,
    column: key,
  };
}

export function principal<
  S extends z.ZodObject<any>,
  K extends Extract<keyof z.infer<S>, string>,
>(schema: S, key: K): ValueExpression<PrincipalValue<S, K>, K> {
  void schema;

  return {
    type: "principal",
    key,
  };
}

export function literal<T>(value: T): ValueExpression<T, never> {
  return {
    type: "literal",
    value,
  };
}

export function allow(): PredicateExpression<never> {
  return {
    type: "allow",
  };
}

export function eq<T, L extends string, R extends string>(
  left: ValueExpression<T, L>,
  right: ValueExpression<T, R>,
): PredicateExpression<L | R> {
  return {
    type: "eq",
    left,
    right,
  };
}

export function and<K extends string>(
  ...conditions: readonly PredicateExpression<K>[]
): PredicateExpression<K> {
  return {
    type: "and",
    conditions,
  };
}

export function or<K extends string>(
  ...conditions: readonly PredicateExpression<K>[]
): PredicateExpression<K> {
  return {
    type: "or",
    conditions,
  };
}

export function exists<K extends string>(
  table: TableDefinition,
  condition: PredicateExpression<K>,
): PredicateExpression<K> {
  return {
    type: "exists",
    table,
    condition,
  };
}
