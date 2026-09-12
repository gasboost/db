import type { PredicateExpression } from "@gasboost/rls";
import { FirebaseRtdbPredicateInspector } from "./FirebaseRtdbPredicateInspector";
import type { FirebaseRtdbCompilationContext } from "./FirebaseRtdbTypes";
import { FirebaseRtdbValueCompiler } from "./FirebaseRtdbValueCompiler";

export class FirebaseRtdbPredicateCompiler {
  private readonly context: FirebaseRtdbCompilationContext;

  public constructor(context: FirebaseRtdbCompilationContext) {
    this.context = context;
  }

  public compileAuthorized(predicate: PredicateExpression): string {
    const expression = this.compile(predicate);

    const inspector = new FirebaseRtdbPredicateInspector();

    if (!inspector.usesPrincipal(predicate)) {
      return expression;
    }

    return `auth != null && (${expression})`;
  }

  public compile(predicate: PredicateExpression): string {
    switch (predicate.type) {
      case "allow":
        return "true";

      case "eq":
        return this.compileEquality(predicate.left, predicate.right);

      case "and":
        if (predicate.conditions.length === 0) {
          return "true";
        }

        return predicate.conditions
          .map((condition) => `(${this.compile(condition)})`)
          .join(" && ");

      case "or":
        if (predicate.conditions.length === 0) {
          return "false";
        }

        return predicate.conditions
          .map((condition) => `(${this.compile(condition)})`)
          .join(" || ");

      case "exists":
        throw new Error(
          "exists() cannot currently be compiled to Firebase RTDB Security Rules.",
        );
    }
  }

  public compileEquality(
    left: Parameters<FirebaseRtdbValueCompiler["compile"]>[0],
    right: Parameters<FirebaseRtdbValueCompiler["compile"]>[0],
  ): string {
    const compiler = new FirebaseRtdbValueCompiler(this.context);

    const leftValue = compiler.compile(left);

    const rightValue = compiler.compile(right);

    if (leftValue.pathString && !rightValue.pathString) {
      return `${leftValue.expression} === (${rightValue.expression} + '')`;
    }

    if (!leftValue.pathString && rightValue.pathString) {
      return `(${leftValue.expression} + '') === ${rightValue.expression}`;
    }

    return `${leftValue.expression} === ${rightValue.expression}`;
  }
}
