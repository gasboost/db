import { ZodObject, ZodRawShape, z } from "zod";
import { Relationable, TableByName } from "../core/Relationable";
import { Operand, SheetFilter } from "./SheetFilter";
import { SheetOrderBy } from "./SheetOrderBy";

export type CriteriaValue<
  Z extends ZodObject<any>,
  K extends keyof z.infer<Z>,
> = z.infer<Z>[K];

export interface SheetJoin<T extends readonly Relationable<any>[]> {
  table: string;
  localKey: string;
  foreignKey: string;
  query: SheetQuery<T, any, any> | null;
}

export class SheetQuery<
  T extends readonly Relationable<any>[],
  Z extends ZodObject<ZodRawShape>,
  U extends T[number]["name"] = T[number]["name"],
> {
  constructor(
    private requires: SheetFilter[] = [],
    private options: SheetFilter[] = [],
    private orderby: SheetOrderBy | null = null,
    private limitNum: number | null = null,
    private offsetNum: number | null = null,
    private joins: SheetJoin<T>[] = [],
    private tableName: U | null = null,
  ) {}

  getTableName(): U | null {
    return this.tableName;
  }

  public and<K extends keyof z.infer<Z>>(
    column: K,
    operand: Operand,
    values: CriteriaValue<Z, K>[],
  ): this {
    this.requires.push(
      new SheetFilter(column as string, operand, values as any[]),
    );
    return this;
  }

  public or<K extends keyof z.infer<Z>>(
    column: K,
    operand: Operand,
    values: CriteriaValue<Z, K>[],
  ): this {
    this.options.push(
      new SheetFilter(column as string, operand, values as any[]),
    );
    return this;
  }

  orderBy<K extends keyof z.infer<Z>>(
    column: K,
    order: "asc" | "desc" = "asc",
  ): this {
    this.orderby = new SheetOrderBy(column as string, order);
    return this;
  }

  limit(v: number): this {
    this.limitNum = v;
    return this;
  }

  offset(v: number): this {
    this.offsetNum = v;
    return this;
  }

  join<
    RefName extends T[number]["name"],
    FK extends keyof z.infer<Z>,
    RefTable extends TableByName<T, RefName>,
    RK extends keyof z.infer<RefTable["schema"]>,
  >(
    thisTableColumn: FK,
    referenceTableName: RefName,
    referenceTableColumn: RK,
    query?: SheetQuery<T, RefTable["schema"], RefName>,
  ): this {
    this.joins.push({
      table: referenceTableName as any,
      localKey: thisTableColumn as string,
      foreignKey: referenceTableColumn as string,
      query: query || null,
    });

    return this;
  }

  filter(records: Record<string, any>[]): Record<string, any>[] {
    return records.filter((record) => {
      const requires = this.requires.every((filter) => {
        return filter.isFullfiled(record);
      });
      const options =
        this.options.length === 0 ||
        this.options.some((filter) => {
          return filter.isFullfiled(record);
        });

      return requires && options;
    });
  }

  sort(records: Record<string, any>[]): Record<string, any>[] {
    this.orderby && records.sort((a, b) => this.orderby!.sort(a, b));
    return records;
  }

  shift(records: Record<string, any>[]): Record<string, any>[] {
    if (this.offsetNum && this.offsetNum > 0) {
      records.splice(0, this.offsetNum);
    }
    return records;
  }
  cut(records: Record<string, any>[]): Record<string, any>[] {
    if (this.limitNum && this.limitNum > 0) {
      records.splice(this.limitNum);
    }
    return records;
  }

  getJoins(): SheetJoin<T>[] {
    return this.joins;
  }
}
