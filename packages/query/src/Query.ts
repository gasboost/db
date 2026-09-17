import type { TableColumnName, TableColumnValue } from "@gasboost/table";
import { Filter, Operand } from "./Filter";
import { Join } from "./Join";
import { OrderBy } from "./OrderBy";
import type { QueryJoinNode, QueryJoins, SetQueryJoin } from "./QueryResult";
import type { TableByName, TableDefinition } from "./TableDefinition";

declare const queryJoinsType: unique symbol;

export type CriteriaValue<
  T extends TableDefinition,
  K extends TableColumnName<T>,
> = TableColumnValue<T, K>;

export type QueryJoinsOf<Q> = Q extends Query<any, any, infer J> ? J : never;

export class Query<
  T extends readonly TableDefinition[],
  N extends T[number]["name"] = T[number]["name"],
  J extends QueryJoins = {},
> {
  declare readonly [queryJoinsType]: J;

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

  public and<K extends TableColumnName<TableByName<T, N>>>(
    column: K,
    operand: Operand,
    values: CriteriaValue<TableByName<T, N>, K>[],
  ): this {
    this.requires.push(
      new Filter(column as string, operand, values as never[]),
    );

    return this;
  }

  public or<K extends TableColumnName<TableByName<T, N>>>(
    column: K,
    operand: Operand,
    values: CriteriaValue<TableByName<T, N>, K>[],
  ): this {
    this.options.push(new Filter(column as string, operand, values as never[]));

    return this;
  }

  public orderBy<K extends TableColumnName<TableByName<T, N>>>(
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
    LocalKey extends TableColumnName<TableByName<T, N>>,
    RefKey extends TableColumnName<TableByName<T, RefName>>,
    RefJoins extends QueryJoins = {},
  >(
    localKey: LocalKey,
    referenceTableName: RefName,
    referenceKey: RefKey,
    query?: Query<T, RefName, RefJoins>,
  ): Query<T, N, SetQueryJoin<J, RefName, QueryJoinNode<RefName, RefJoins>>> {
    this.joins.push(
      new Join({
        table: referenceTableName,
        localKey: localKey as string,
        foreignKey: referenceKey as string,
        query: query ?? null,
      }),
    );

    return this as unknown as Query<
      T,
      N,
      SetQueryJoin<J, RefName, QueryJoinNode<RefName, RefJoins>>
    >;
  }
}
