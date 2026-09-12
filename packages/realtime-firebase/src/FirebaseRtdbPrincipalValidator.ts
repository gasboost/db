import type {
  PredicateExpression,
  RowLevelSecurity,
  ValueExpression,
} from "@gasboost/rls";
import type { FirebaseRtdbPrincipalMapping } from "./FirebaseRtdbTypes";

export class FirebaseRtdbPrincipalValidator {
  private readonly mapping: FirebaseRtdbPrincipalMapping;

  public constructor(mapping: FirebaseRtdbPrincipalMapping) {
    this.mapping = mapping;
  }

  public validatePolicy(policy: RowLevelSecurity<any>): void {
    if (policy.select !== null) {
      this.validatePredicate(policy.select.using);
    }

    if (policy.insert !== null) {
      this.validatePredicate(policy.insert.check);
    }

    if (policy.update !== null) {
      this.validatePredicate(policy.update.using);
      this.validatePredicate(policy.update.check);
    }

    if (policy.delete !== null) {
      this.validatePredicate(policy.delete.using);
    }
  }

  public validatePredicate(predicate: PredicateExpression): void {
    switch (predicate.type) {
      case "allow":
        return;

      case "eq":
        this.validateValue(predicate.left);
        this.validateValue(predicate.right);
        return;

      case "and":
      case "or":
        for (const condition of predicate.conditions) {
          this.validatePredicate(condition);
        }
        return;

      case "exists":
        this.validatePredicate(predicate.condition);
        return;
    }
  }

  public validateValue(expression: ValueExpression<unknown>): void {
    if (expression.type !== "principal") {
      return;
    }

    if (!(expression.key in this.mapping)) {
      throw new Error(
        `Firebase principal mapping for '${expression.key}' is not defined.`,
      );
    }
  }
}
