import type { z } from "zod";
import { Filter, Operand } from "./Filter";
import { Join } from "./Join";
import { OrderBy } from "./OrderBy";
import type { TableByName, TableDefinition } from "./TableDefinition";

export type CriteriaValue<
  S extends z.ZodObject<any>,
  K extends keyof z.infer<S>,
> = z.infer<S>[K];

export type Loader<T extends readonly TableDefinition[]> = <
  N extends T[number]["name"],
>(
  table: N,
) => Promise<Record<string, unknown>[]>;

export class Query<
  T extends readonly TableDefinition[],
  N extends T[number]["name"] = T[number]["name"],
> {
  public readonly tableName: N;
  public readonly requires: Filter[] = [];
  public readonly options: Filter[] = [];
  public orderByValue: OrderBy | null = null;
  public limitValue: number | null = null;
  public offsetValue: number | null = null;
  public readonly joins: Join<T>[] = [];

  public constructor(tableName: N) {
    this.tableName = tableName;
  }

  public and<K extends keyof z.infer<TableByName<T, N>["schema"]>>(
    column: K,
    operand: Operand,
    values: CriteriaValue<TableByName<T, N>["schema"], K>[],
  ): this {
    this.requires.push(
      new Filter(column as string, operand, values as never[]),
    );

    return this;
  }

  public or<K extends keyof z.infer<TableByName<T, N>["schema"]>>(
    column: K,
    operand: Operand,
    values: CriteriaValue<TableByName<T, N>["schema"], K>[],
  ): this {
    this.options.push(new Filter(column as string, operand, values as never[]));

    return this;
  }

  public orderBy<K extends keyof z.infer<TableByName<T, N>["schema"]>>(
    column: K,
    order: "asc" | "desc" = "asc",
  ): this {
    this.orderByValue = new OrderBy(column as string, order);

    return this;
  }

  public limit(value: number): this {
    this.limitValue = value;

    return this;
  }

  public offset(value: number): this {
    this.offsetValue = value;

    return this;
  }

  public join<
    RefName extends T[number]["name"],
    LocalKey extends keyof z.infer<TableByName<T, N>["schema"]>,
    RefKey extends keyof z.infer<TableByName<T, RefName>["schema"]>,
  >(
    localKey: LocalKey,
    referenceTableName: RefName,
    referenceKey: RefKey,
    query?: Query<T, RefName>,
  ): this {
    this.joins.push(
      new Join({
        table: referenceTableName,
        localKey: localKey as string,
        foreignKey: referenceKey as string,
        query: query ?? null,
      }),
    );

    return this;
  }
}
