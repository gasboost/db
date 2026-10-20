import type { JoinResolver } from "./Join";
import type { Query } from "./Query";
import type { TableDefinition } from "./TableDefinition";

export type Loader<T extends readonly TableDefinition[]> = <
  N extends T[number]["name"],
>(
  table: N,
) => Record<string, unknown>[];

export type AsyncLoader<T extends readonly TableDefinition[]> = <
  N extends T[number]["name"],
>(
  table: N,
) => Promise<Record<string, unknown>[]>;

export class QueryEvaluation<
  T extends readonly TableDefinition[],
  N extends T[number]["name"] = T[number]["name"],
> {
  public readonly query: Query<T, N>;
  public readonly joinResolver: JoinResolver;

  public constructor(query: Query<T, N>, joinResolver: JoinResolver) {
    this.query = query;
    this.joinResolver = joinResolver;
  }

  public filter(records: Record<string, unknown>[]): Record<string, unknown>[] {
    return records.filter((record) => {
      const requires = this.query.requires.every((filter) =>
        filter.isFullfiled(record),
      );

      const options =
        this.query.options.length === 0 ||
        this.query.options.some((filter) => filter.isFullfiled(record));

      return requires && options;
    });
  }

  public sort(records: Record<string, unknown>[]): Record<string, unknown>[] {
    if (this.query.orderByValue !== null) {
      records.sort((a, b) => this.query.orderByValue!.sort(a, b));
    }

    return records;
  }

  public shift(records: Record<string, unknown>[]): Record<string, unknown>[] {
    if (this.query.offsetValue !== null && this.query.offsetValue > 0) {
      records.splice(0, this.query.offsetValue);
    }

    return records;
  }

  public cut(records: Record<string, unknown>[]): Record<string, unknown>[] {
    if (this.query.limitValue !== null && this.query.limitValue > 0) {
      records.splice(this.query.limitValue);
    }

    return records;
  }

  public apply(records: Record<string, unknown>[]): Record<string, unknown>[] {
    const filtered = this.filter(records);
    const sorted = this.sort(filtered);
    const shifted = this.shift(sorted);

    return this.cut(shifted);
  }

  public resolve(load: Loader<T>): Record<string, unknown>[] {
    // Only direct INNER joins defer pagination; each subquery decides independently.
    const hasInnerJoin = this.query.joins.some((join) => join.type === "inner");
    const parents = load(this.query.tableName);
    let records = hasInnerJoin ? this.filter(parents) : this.apply(parents);

    for (const join of this.query.joins) {
      const children =
        join.query !== null
          ? new QueryEvaluation(join.query, this.joinResolver).resolve(load)
          : load(join.table);

      records = join.combine(records, children, this.joinResolver);
    }

    return hasInnerJoin ? this.cut(this.shift(this.sort(records))) : records;
  }

  public async resolveAsync(
    load: AsyncLoader<T>,
  ): Promise<Record<string, unknown>[]> {
    const hasInnerJoin = this.query.joins.some((join) => join.type === "inner");
    const parents = await load(this.query.tableName);
    let records = hasInnerJoin ? this.filter(parents) : this.apply(parents);

    for (const join of this.query.joins) {
      const children =
        join.query !== null
          ? await new QueryEvaluation(
              join.query,
              this.joinResolver,
            ).resolveAsync(load)
          : await load(join.table);

      records = join.combine(records, children, this.joinResolver);
    }

    return hasInnerJoin ? this.cut(this.shift(this.sort(records))) : records;
  }
}
