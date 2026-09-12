import type { ValueExpression } from "@gasboost/rls";
import { FirebaseRtdbRuleLiteral } from "./FirebaseRtdbRuleLiteral";
import type {
  FirebaseRtdbCompilationContext,
  FirebaseRtdbCompiledValue,
} from "./FirebaseRtdbTypes";

export class FirebaseRtdbValueCompiler {
  private readonly context: FirebaseRtdbCompilationContext;

  public constructor(context: FirebaseRtdbCompilationContext) {
    this.context = context;
  }

  public compile(
    expression: ValueExpression<unknown>,
  ): FirebaseRtdbCompiledValue {
    switch (expression.type) {
      case "column":
        return this.compileColumn(expression);

      case "principal": {
        const mapped = this.context.principal[expression.key];

        if (mapped === undefined) {
          throw new Error(
            `Firebase principal mapping for '${expression.key}' is not defined.`,
          );
        }

        return {
          expression: mapped,
          pathString: false,
        };
      }

      case "literal":
        return {
          expression: FirebaseRtdbRuleLiteral.generate(expression.value),
          pathString: false,
        };

      case "outerColumn":
        throw new Error(
          "outerColumn() cannot currently be compiled to Firebase RTDB Security Rules.",
        );
    }
  }

  public compileColumn(
    expression: Extract<ValueExpression<unknown>, { readonly type: "column" }>,
  ): FirebaseRtdbCompiledValue {
    if (expression.table !== this.context.layout.tableName()) {
      throw new Error(
        `Column '${expression.table}.${expression.column}' cannot be resolved from RTDB table '${this.context.layout.tableName()}'.`,
      );
    }

    if (this.context.type === "current") {
      return {
        expression: `data.child(${JSON.stringify(expression.column)}).val()`,
        pathString: false,
      };
    }

    if (this.context.type === "next") {
      return {
        expression: `newData.child(${JSON.stringify(expression.column)}).val()`,
        pathString: false,
      };
    }

    if (!("variables" in this.context)) {
      throw new Error(
        `RTDB scope context is required to compile column '${expression.column}'.`,
      );
    }

    const binding = this.context.layout
      .bindings()
      .find((candidate) => candidate.column() === expression.column);

    if (binding === undefined) {
      throw new Error(
        `Column '${expression.column}' is not represented in the RTDB subscription scope for table '${this.context.layout.tableName()}'.`,
      );
    }

    const source = binding.source();

    if (source.type === "literal") {
      return {
        expression: FirebaseRtdbRuleLiteral.generate(source.value),
        pathString: false,
      };
    }

    const variable = this.context.variables.get(expression.column);

    if (variable === undefined) {
      throw new Error(
        `RTDB scope variable for column '${expression.column}' was not found.`,
      );
    }

    return {
      expression: variable,
      pathString: true,
    };
  }
}
