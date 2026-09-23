import type {
  EqExpression,
  ExistsExpression,
  PredicateExpression,
  ValueExpression,
} from "@gasboost/rls";
import {
  FirebaseRtdbBinding,
  type FirebaseRtdbBindingSource,
  type FirebaseRtdbRelation,
} from "./FirebaseRtdbBinding";
import type { FirebaseRtdbTableDefinition } from "./FirebaseRtdbTypes";

type RelationJoin = Omit<FirebaseRtdbRelation, "targetColumn">;

type RelationPartition = {
  readonly targetColumn: string;
  readonly source: FirebaseRtdbBindingSource;
};

export class FirebaseRtdbScopeProjector {
  private readonly tableRegistry: ReadonlyMap<
    string,
    FirebaseRtdbTableDefinition
  >;

  public constructor(tables: readonly FirebaseRtdbTableDefinition[] = []) {
    this.tableRegistry = new Map(tables.map((table) => [table.name, table]));
  }

  public project(
    predicate: PredicateExpression,
    table: string | FirebaseRtdbTableDefinition,
  ): readonly FirebaseRtdbBinding[] {
    const tableName = typeof table === "string" ? table : table.name;

    switch (predicate.type) {
      case "allow":
        return [];

      case "eq":
        return this.projectEquality(predicate, tableName);

      case "and": {
        const bindings: FirebaseRtdbBinding[] = [];

        for (const condition of predicate.conditions) {
          bindings.push(...this.project(condition, tableName));
        }

        return this.ensureDistinct(bindings, tableName);
      }

      case "or":
        throw new Error(
          `RLS select policy for table '${tableName}' uses or(), which cannot be projected to a single RTDB subscription scope.`,
        );

      case "exists":
        return this.projectExists(predicate, tableName);
    }
  }

  public projectEquality(
    expression: EqExpression,
    tableName: string,
  ): readonly FirebaseRtdbBinding[] {
    this.ensureValueProjectable(expression.left, tableName);
    this.ensureValueProjectable(expression.right, tableName);

    const forward = FirebaseRtdbBinding.generate(
      expression.left,
      expression.right,
      tableName,
    );

    if (forward !== null) {
      return [forward];
    }

    const reverse = FirebaseRtdbBinding.generate(
      expression.right,
      expression.left,
      tableName,
    );

    if (reverse !== null) {
      return [reverse];
    }

    const containsColumn =
      expression.left.type === "column" || expression.right.type === "column";

    if (containsColumn) {
      throw new Error(
        `RLS select equality for table '${tableName}' contains a column condition that cannot be represented as an RTDB partition.`,
      );
    }

    return [];
  }

  public projectExists(
    expression: ExistsExpression,
    tableName: string,
  ): readonly FirebaseRtdbBinding[] {
    const targetTable = this.tableRegistry.get(expression.table.name);

    if (targetTable === undefined) {
      throw new Error(
        `RLS select policy for table '${tableName}' references table '${expression.table.name}' through exists(), but that table is not registered in Firebase RTDB.`,
      );
    }

    const joins: RelationJoin[] = [];
    const partitions: RelationPartition[] = [];

    for (const condition of this.flattenAnd(expression.condition)) {
      if (condition.type !== "eq") {
        throw new Error(
          `RLS select policy for table '${tableName}' uses an exists() condition that cannot be projected to a single-hop RTDB relation.`,
        );
      }

      const join = this.extractRelationJoin({
        expression: condition,
        outerTable: tableName,
        innerTable: targetTable.name,
        targetTable,
      });

      if (join !== null) {
        joins.push(join);
        continue;
      }

      const partition = this.extractRelationPartition(
        condition,
        targetTable.name,
      );

      if (partition !== null) {
        partitions.push(partition);
        continue;
      }

      throw new Error(
        `RLS select policy for table '${tableName}' uses an exists() equality that cannot be represented as an RTDB relation partition.`,
      );
    }

    const uniqueJoins = this.distinctJoins(joins);

    if (uniqueJoins.length !== 1) {
      if (uniqueJoins.length === 0) {
        throw new Error(
          `RLS select policy for table '${tableName}' uses exists(), which cannot currently be projected to an RTDB subscription scope.`,
        );
      }

      throw new Error(
        `RLS select policy for table '${tableName}' contains an ambiguous exists() relation with more than one foreign-key equality.`,
      );
    }

    const join = uniqueJoins[0];

    if (join.targetKey !== String(targetTable.primaryKey)) {
      throw new Error(
        `RLS select policy for table '${tableName}' joins '${targetTable.name}.${join.targetKey}', but RTDB relation projection requires the referenced key to be primary key '${String(targetTable.primaryKey)}'.`,
      );
    }

    if (partitions.length === 0) {
      throw new Error(
        `RLS select policy for table '${tableName}' uses exists(), which cannot currently be projected to an RTDB subscription scope.`,
      );
    }

    return this.ensureDistinct(
      partitions.map(({ targetColumn, source }) =>
        FirebaseRtdbBinding.generateRelation({
          relation: {
            ...join,
            targetColumn,
          },
          source,
          origin: expression,
        }),
      ),
      tableName,
    );
  }

  public ensureValueProjectable(
    expression: ValueExpression<unknown>,
    tableName: string,
  ): void {
    if (expression.type === "outerColumn") {
      throw new Error(
        `RLS select policy for table '${tableName}' uses outerColumn(), which cannot currently be projected to an RTDB subscription scope.`,
      );
    }

    if (expression.type === "column" && expression.table !== tableName) {
      throw new Error(
        `RLS select policy for table '${tableName}' references '${expression.table}.${expression.column}', which is outside the current RTDB scope.`,
      );
    }
  }

  public ensureDistinct(
    bindings: readonly FirebaseRtdbBinding[],
    tableName: string,
  ): readonly FirebaseRtdbBinding[] {
    const result: FirebaseRtdbBinding[] = [];

    for (const binding of bindings) {
      const current = result.find(
        (candidate) => candidate.column() === binding.column(),
      );

      if (current === undefined) {
        result.push(binding);
        continue;
      }

      if (!current.equals(binding)) {
        throw new Error(
          `RLS for table '${tableName}' requires incompatible RTDB partitions for column '${binding.column()}'.`,
        );
      }
    }

    return result;
  }

  private flattenAnd(
    predicate: PredicateExpression,
  ): readonly PredicateExpression[] {
    if (predicate.type !== "and") {
      return [predicate];
    }

    return predicate.conditions.flatMap((condition) =>
      this.flattenAnd(condition),
    );
  }

  private extractRelationJoin({
    expression,
    outerTable,
    innerTable,
    targetTable,
  }: {
    expression: EqExpression;
    outerTable: string;
    innerTable: string;
    targetTable: FirebaseRtdbTableDefinition;
  }): RelationJoin | null {
    const candidates = [
      [expression.left, expression.right],
      [expression.right, expression.left],
    ] as const;

    for (const [inner, outer] of candidates) {
      if (inner.type !== "column" || outer.type !== "outerColumn") {
        continue;
      }

      if (inner.table !== innerTable) {
        throw new Error(
          `exists('${innerTable}') references inner column '${inner.table}.${inner.column}', which does not belong to the referenced table.`,
        );
      }

      if (outer.table !== outerTable) {
        throw new Error(
          `exists('${innerTable}') references outer column '${outer.table}.${outer.column}', but the current RTDB table is '${outerTable}'.`,
        );
      }

      return {
        fromTable: outerTable,
        foreignKey: outer.column,
        toTable: innerTable,
        targetKey: inner.column,
        targetTable,
      };
    }

    if (
      expression.left.type === "outerColumn" ||
      expression.right.type === "outerColumn"
    ) {
      throw new Error(
        `exists('${innerTable}') contains outerColumn() outside a deterministic inner-column equality.`,
      );
    }

    return null;
  }

  private extractRelationPartition(
    expression: EqExpression,
    innerTable: string,
  ): RelationPartition | null {
    const candidates = [
      [expression.left, expression.right],
      [expression.right, expression.left],
    ] as const;

    for (const [columnExpression, valueExpression] of candidates) {
      if (columnExpression.type !== "column") {
        continue;
      }

      if (columnExpression.table !== innerTable) {
        throw new Error(
          `exists('${innerTable}') references column '${columnExpression.table}.${columnExpression.column}', which does not belong to the referenced table.`,
        );
      }

      const source = FirebaseRtdbBinding.sourceFrom(valueExpression);

      if (source === null) {
        continue;
      }

      return {
        targetColumn: columnExpression.column,
        source,
      };
    }

    return null;
  }

  private distinctJoins(
    joins: readonly RelationJoin[],
  ): readonly RelationJoin[] {
    const result: RelationJoin[] = [];

    for (const join of joins) {
      if (
        result.some(
          (current) =>
            current.fromTable === join.fromTable &&
            current.foreignKey === join.foreignKey &&
            current.toTable === join.toTable &&
            current.targetKey === join.targetKey,
        )
      ) {
        continue;
      }

      result.push(join);
    }

    return result;
  }
}
