import type { TableDefinition } from "@gasboost/query";
import type { PredicateExpression } from "./Expression";

export type SelectPolicy = {
  readonly using: PredicateExpression;
};

export type InsertPolicy = {
  readonly check: PredicateExpression;
};

export type UpdatePolicy = {
  readonly using: PredicateExpression;
  readonly check: PredicateExpression;
};

export type DeletePolicy = {
  readonly using: PredicateExpression;
};

export class RowLevelSecurity<T extends TableDefinition> {
  public readonly table: T;
  public readonly select: SelectPolicy | null;
  public readonly insert: InsertPolicy | null;
  public readonly update: UpdatePolicy | null;
  public readonly delete: DeletePolicy | null;

  constructor({
    table,
    select = null,
    insert = null,
    update = null,
    delete: deletePolicy = null,
  }: {
    table: T;
    select?: SelectPolicy | null;
    insert?: InsertPolicy | null;
    update?: UpdatePolicy | null;
    delete?: DeletePolicy | null;
  }) {
    this.table = table;
    this.select = select;
    this.insert = insert;
    this.update = update;
    this.delete = deletePolicy;
  }
}
