import type { z } from "zod";

export type TableDefinition<
  N extends string = string,
  S extends z.ZodObject<any> = z.ZodObject<any>,
> = {
  readonly name: N;
  readonly schema: S;
};

export type ValueExpression<T> =
  | ColumnExpression<T>
  | OuterColumnExpression<T>
  | PrincipalExpression<T>
  | LiteralExpression<T>;

export type PredicateExpression =
  | EqExpression
  | AndExpression
  | OrExpression
  | ExistsExpression;

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

export type PrincipalExpression<T> = {
  readonly type: "principal";
  readonly key: string;
  readonly __value?: T;
};

export type LiteralExpression<T> = {
  readonly type: "literal";
  readonly value: T;
  readonly __value?: T;
};

export type EqExpression = {
  readonly type: "eq";
  readonly left: ValueExpression<unknown>;
  readonly right: ValueExpression<unknown>;
};

export type AndExpression = {
  readonly type: "and";
  readonly conditions: readonly PredicateExpression[];
};

export type OrExpression = {
  readonly type: "or";
  readonly conditions: readonly PredicateExpression[];
};

export type ExistsExpression = {
  readonly type: "exists";
  readonly table: TableDefinition;
  readonly condition: PredicateExpression;
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
  K extends keyof z.infer<T["schema"]>,
>(table: T, key: K): ValueExpression<TableValue<T, K>> {
  return {
    type: "column",
    table: table.name,
    column: key as string,
  };
}

export function outerColumn<
  T extends TableDefinition,
  K extends keyof z.infer<T["schema"]>,
>(table: T, key: K): ValueExpression<TableValue<T, K>> {
  return {
    type: "outerColumn",
    table: table.name,
    column: key as string,
  };
}

export function principal<
  S extends z.ZodObject<any>,
  K extends keyof z.infer<S>,
>(schema: S, key: K): ValueExpression<PrincipalValue<S, K>> {
  void schema;

  return {
    type: "principal",
    key: key as string,
  };
}

export function literal<T>(value: T): ValueExpression<T> {
  return {
    type: "literal",
    value,
  };
}

export function eq<T>(
  left: ValueExpression<T>,
  right: ValueExpression<T>,
): PredicateExpression {
  return {
    type: "eq",
    left: left as ValueExpression<unknown>,
    right: right as ValueExpression<unknown>,
  };
}

export function and(
  ...conditions: readonly PredicateExpression[]
): PredicateExpression {
  return {
    type: "and",
    conditions,
  };
}

export function or(
  ...conditions: readonly PredicateExpression[]
): PredicateExpression {
  return {
    type: "or",
    conditions,
  };
}

export function exists(
  table: TableDefinition,
  condition: PredicateExpression,
): PredicateExpression {
  return {
    type: "exists",
    table,
    condition,
  };
}
