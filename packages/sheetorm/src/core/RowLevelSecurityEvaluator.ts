import type {
  PredicateExpression,
  RowLevelSecurity,
  TableDefinition,
  ValueExpression,
} from "@gasboost/rls";

export type RowLevelSecurityRecord = Record<string, unknown>;

export type RowLevelSecurityLoader = (
  tableName: string,
) => RowLevelSecurityRecord[];

export type RowLevelSecurityEvaluationContext = {
  readonly row: RowLevelSecurityRecord;
  readonly outerRow: RowLevelSecurityRecord | null;
};

export class RowLevelSecurityEvaluator {
  public readonly principal: Record<string, unknown>;
  public readonly policies: readonly RowLevelSecurity<any>[];
  public readonly load: RowLevelSecurityLoader;

  public constructor({
    principal,
    policies,
    load,
  }: {
    principal: Record<string, unknown>;
    policies: readonly RowLevelSecurity<any>[];
    load: RowLevelSecurityLoader;
  }) {
    this.principal = principal;
    this.policies = policies;
    this.load = load;
  }

  public read(
    table: TableDefinition,
    dependencyStack: readonly string[] = [],
  ): RowLevelSecurityRecord[] {
    const records = this.load(table.name);
    const policy = this.findPolicy(table.name);

    if (policy === null) {
      return records;
    }

    if (policy.select === null) {
      return [];
    }

    const nextStack = this.enterDependency(table.name, dependencyStack);

    return records.filter((row) =>
      this.evaluate(
        policy.select!.using,
        {
          row,
          outerRow: null,
        },
        nextStack,
      ),
    );
  }

  public ensureInsert(
    table: TableDefinition,
    records: readonly RowLevelSecurityRecord[],
  ): void {
    const policy = this.findPolicy(table.name);

    if (policy === null) {
      return;
    }

    if (policy.insert === null) {
      throw new Error(
        `RLS denied insert on table '${table.name}': policy is not defined.`,
      );
    }

    const dependencyStack = this.enterDependency(table.name, []);

    for (const row of records) {
      if (
        !this.evaluate(
          policy.insert.check,
          {
            row,
            outerRow: null,
          },
          dependencyStack,
        )
      ) {
        throw new Error(`RLS denied insert on table '${table.name}'.`);
      }
    }
  }

  public ensureUpdate({
    table,
    currentRecords,
    nextRecords,
    primaryKey,
  }: {
    table: TableDefinition;
    currentRecords: readonly RowLevelSecurityRecord[];
    nextRecords: readonly RowLevelSecurityRecord[];
    primaryKey: string;
  }): void {
    const policy = this.findPolicy(table.name);

    if (policy === null) {
      return;
    }

    if (policy.update === null) {
      throw new Error(
        `RLS denied update on table '${table.name}': policy is not defined.`,
      );
    }

    const dependencyStack = this.enterDependency(table.name, []);

    const currentByPrimaryKey = new Map<unknown, RowLevelSecurityRecord>();

    for (const record of currentRecords) {
      currentByPrimaryKey.set(record[primaryKey], record);
    }

    for (const nextRow of nextRecords) {
      const primaryKeyValue = nextRow[primaryKey];
      const currentRow = currentByPrimaryKey.get(primaryKeyValue);

      if (currentRow === undefined) {
        throw new Error(
          `RLS could not resolve current record on table '${table.name}' for primary key '${String(
            primaryKeyValue,
          )}'.`,
        );
      }

      if (
        !this.evaluate(
          policy.update.using,
          {
            row: currentRow,
            outerRow: null,
          },
          dependencyStack,
        )
      ) {
        throw new Error(`RLS denied update on table '${table.name}'.`);
      }

      if (
        !this.evaluate(
          policy.update.check,
          {
            row: nextRow,
            outerRow: null,
          },
          dependencyStack,
        )
      ) {
        throw new Error(`RLS denied updated record on table '${table.name}'.`);
      }
    }
  }

  public ensureDelete(
    table: TableDefinition,
    records: readonly RowLevelSecurityRecord[],
  ): void {
    const policy = this.findPolicy(table.name);

    if (policy === null) {
      return;
    }

    if (policy.delete === null) {
      throw new Error(
        `RLS denied delete on table '${table.name}': policy is not defined.`,
      );
    }

    const dependencyStack = this.enterDependency(table.name, []);

    for (const row of records) {
      if (
        !this.evaluate(
          policy.delete.using,
          {
            row,
            outerRow: null,
          },
          dependencyStack,
        )
      ) {
        throw new Error(`RLS denied delete on table '${table.name}'.`);
      }
    }
  }

  public evaluate(
    expression: PredicateExpression,
    context: RowLevelSecurityEvaluationContext,
    dependencyStack: readonly string[],
  ): boolean {
    switch (expression.type) {
      case "allow":
        return true;

      case "eq":
        return (
          this.resolveValue(expression.left, context) ===
          this.resolveValue(expression.right, context)
        );

      case "and":
        return expression.conditions.every((condition) =>
          this.evaluate(condition, context, dependencyStack),
        );

      case "or":
        return expression.conditions.some((condition) =>
          this.evaluate(condition, context, dependencyStack),
        );

      case "exists":
        return this.evaluateExists(
          expression.table,
          expression.condition,
          context,
          dependencyStack,
        );
    }
  }

  public resolveValue(
    expression: ValueExpression<unknown>,
    context: RowLevelSecurityEvaluationContext,
  ): unknown {
    switch (expression.type) {
      case "column":
        return context.row[expression.column];

      case "outerColumn": {
        if (context.outerRow === null) {
          throw new Error(
            `outerColumn('${expression.table}', '${expression.column}') requires an outer record.`,
          );
        }

        return context.outerRow[expression.column];
      }

      case "principal":
        return this.principal[expression.key];

      case "literal":
        return expression.value;
    }
  }

  public findPolicy(tableName: string): RowLevelSecurity<any> | null {
    return (
      this.policies.find((policy) => policy.table.name === tableName) ?? null
    );
  }

  public enterDependency(
    tableName: string,
    dependencyStack: readonly string[],
  ): readonly string[] {
    if (dependencyStack.includes(tableName)) {
      throw new Error(
        `Circular RLS dependency detected: ${[
          ...dependencyStack,
          tableName,
        ].join(" -> ")}`,
      );
    }

    return [...dependencyStack, tableName];
  }

  public evaluateExists(
    table: TableDefinition,
    condition: PredicateExpression,
    context: RowLevelSecurityEvaluationContext,
    dependencyStack: readonly string[],
  ): boolean {
    const records = this.read(table, dependencyStack);

    return records.some((row) =>
      this.evaluate(
        condition,
        {
          row,
          outerRow: context.row,
        },
        dependencyStack,
      ),
    );
  }
}
