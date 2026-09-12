import type {
  EqExpression,
  PredicateExpression,
  ValueExpression,
} from "@gasboost/rls";
import { FirebaseRtdbBinding } from "./FirebaseRtdbBinding";

export class FirebaseRtdbScopeProjector {
  public project(
    predicate: PredicateExpression,
    tableName: string,
  ): readonly FirebaseRtdbBinding[] {
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
        throw new Error(
          `RLS select policy for table '${tableName}' uses exists(), which cannot currently be projected to an RTDB subscription scope.`,
        );
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
}
