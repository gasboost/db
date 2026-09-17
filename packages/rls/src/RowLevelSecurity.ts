import type { TableDefinition } from "@gasboost/table";
import type { PredicateExpression } from "./Expression";

export type SelectPolicy<K extends string = string> = {
  readonly using: PredicateExpression<K>;
};

export type InsertPolicy<K extends string = string> = {
  readonly check: PredicateExpression<K>;
};

export type UpdatePolicy<K extends string = string> = {
  readonly using: PredicateExpression<K>;
  readonly check: PredicateExpression<K>;
};

export type DeletePolicy<K extends string = string> = {
  readonly using: PredicateExpression<K>;
};

export class RowLevelSecurity<
  T extends TableDefinition,
  K extends string = string,
> {
  public readonly table: T;
  public readonly select: SelectPolicy<K> | null;
  public readonly insert: InsertPolicy<K> | null;
  public readonly update: UpdatePolicy<K> | null;
  public readonly delete: DeletePolicy<K> | null;

  declare public readonly __principalKeys?: K;

  constructor({
    table,
    select = null,
    insert = null,
    update = null,
    delete: deletePolicy = null,
  }: {
    table: T;
    select?: SelectPolicy<K> | null;
    insert?: InsertPolicy<K> | null;
    update?: UpdatePolicy<K> | null;
    delete?: DeletePolicy<K> | null;
  }) {
    this.table = table;
    this.select = select;
    this.insert = insert;
    this.update = update;
    this.delete = deletePolicy;
  }
}
