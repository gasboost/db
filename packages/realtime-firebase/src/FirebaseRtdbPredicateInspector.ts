import type { PredicateExpression, ValueExpression } from "@gasboost/rls";

export class FirebaseRtdbPredicateInspector {
  public usesPrincipal(predicate: PredicateExpression): boolean {
    switch (predicate.type) {
      case "allow":
        return false;

      case "eq":
        return (
          this.valueUsesPrincipal(predicate.left) ||
          this.valueUsesPrincipal(predicate.right)
        );

      case "and":
      case "or":
        return predicate.conditions.some((condition) =>
          this.usesPrincipal(condition),
        );

      case "exists":
        return this.usesPrincipal(predicate.condition);
    }
  }

  public valueUsesPrincipal(expression: ValueExpression<unknown>): boolean {
    return expression.type === "principal";
  }
}
