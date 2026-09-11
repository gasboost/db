import type { z } from "zod";
import { Filter, Operand } from "./Filter";
import { Join, JoinResolver } from "./Join";
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
  private readonly requires: Filter[];
  private readonly options: Filter[];
  private orderByValue: OrderBy | null;
  private limitValue: number | null;
  private offsetValue: number | null;
  private readonly joins: Join<T>[];
  private readonly tableName: N;

  constructor({
    tableName,
    requires = [],
    options = [],
    orderBy = null,
    limit = null,
    offset = null,
    joins = [],
  }: {
    tableName: N;
    requires?: Filter[];
    options?: Filter[];
    orderBy?: OrderBy | null;
    limit?: number | null;
    offset?: number | null;
    joins?: Join<T>[];
  }) {
    this.tableName = tableName;
    this.requires = requires;
    this.options = options;
    this.orderByValue = orderBy;
    this.limitValue = limit;
    this.offsetValue = offset;
    this.joins = joins;
  }

  public getTableName(): N {
    return this.tableName;
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

  public filter(records: Record<string, unknown>[]): Record<string, unknown>[] {
    return records.filter((record) => {
      const requires = this.requires.every((filter) =>
        filter.isFullfiled(record),
      );

      const options =
        this.options.length === 0 ||
        this.options.some((filter) => filter.isFullfiled(record));

      return requires && options;
    });
  }

  public sort(records: Record<string, unknown>[]): Record<string, unknown>[] {
    if (this.orderByValue !== null) {
      records.sort((a, b) => this.orderByValue!.sort(a, b));
    }

    return records;
  }

  public shift(records: Record<string, unknown>[]): Record<string, unknown>[] {
    if (this.offsetValue !== null && this.offsetValue > 0) {
      records.splice(0, this.offsetValue);
    }

    return records;
  }

  public cut(records: Record<string, unknown>[]): Record<string, unknown>[] {
    if (this.limitValue !== null && this.limitValue > 0) {
      records.splice(this.limitValue);
    }

    return records;
  }

  public getJoins(): readonly Join<T>[] {
    return this.joins;
  }

  public apply(records: Record<string, unknown>[]): Record<string, unknown>[] {
    const filtered = this.filter(records);
    const sorted = this.sort(filtered);
    const shifted = this.shift(sorted);
    return this.cut(shifted);
  }

  public async resolve(
    load: Loader<T>,
    joinResolver: JoinResolver,
  ): Promise<Record<string, unknown>[]> {
    let records = this.apply(await load(this.tableName));

    for (const join of this.joins) {
      const children =
        join.query !== null
          ? await join.query.resolve(load, joinResolver)
          : await load(join.table);

      records = join.combine(records, children, joinResolver);
    }

    return records;
  }
}
