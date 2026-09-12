import type { ValueExpression } from "@gasboost/rls";
import type { FirebaseRtdbPathValue } from "./FirebaseRtdbTypes";

export type FirebaseRtdbBindingSource =
  | {
      readonly type: "principal";
      readonly key: string;
    }
  | {
      readonly type: "literal";
      readonly value: FirebaseRtdbPathValue;
    };

export class FirebaseRtdbBinding {
  private readonly columnName: string;
  private readonly sourceDefinition: FirebaseRtdbBindingSource;

  public constructor({
    column,
    source,
  }: {
    column: string;
    source: FirebaseRtdbBindingSource;
  }) {
    this.columnName = column;
    this.sourceDefinition = source;
  }

  public static generate(
    columnExpression: ValueExpression<unknown>,
    valueExpression: ValueExpression<unknown>,
    tableName: string,
  ): FirebaseRtdbBinding | null {
    if (columnExpression.type !== "column") {
      return null;
    }

    if (columnExpression.table !== tableName) {
      return null;
    }

    if (valueExpression.type === "principal") {
      return new FirebaseRtdbBinding({
        column: columnExpression.column,
        source: {
          type: "principal",
          key: valueExpression.key,
        },
      });
    }

    if (
      valueExpression.type === "literal" &&
      (typeof valueExpression.value === "string" ||
        typeof valueExpression.value === "number" ||
        typeof valueExpression.value === "boolean")
    ) {
      return new FirebaseRtdbBinding({
        column: columnExpression.column,
        source: {
          type: "literal",
          value: valueExpression.value,
        },
      });
    }

    return null;
  }

  public column(): string {
    return this.columnName;
  }

  public source(): FirebaseRtdbBindingSource {
    return this.sourceDefinition;
  }

  public scopeVariable(index: number): string | null {
    if (this.sourceDefinition.type !== "principal") {
      return null;
    }

    return `$scope${index}`;
  }

  public equals(other: FirebaseRtdbBinding): boolean {
    if (this.columnName !== other.columnName) {
      return false;
    }

    if (this.sourceDefinition.type !== other.sourceDefinition.type) {
      return false;
    }

    if (
      this.sourceDefinition.type === "principal" &&
      other.sourceDefinition.type === "principal"
    ) {
      return this.sourceDefinition.key === other.sourceDefinition.key;
    }

    if (
      this.sourceDefinition.type === "literal" &&
      other.sourceDefinition.type === "literal"
    ) {
      return this.sourceDefinition.value === other.sourceDefinition.value;
    }

    return false;
  }
}
