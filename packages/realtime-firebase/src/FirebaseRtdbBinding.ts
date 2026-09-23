import type { ExistsExpression, ValueExpression } from "@gasboost/rls";
import type {
  FirebaseRtdbPathValue,
  FirebaseRtdbTableDefinition,
} from "./FirebaseRtdbTypes";

export type FirebaseRtdbBindingSource =
  | {
      readonly type: "principal";
      readonly key: string;
    }
  | {
      readonly type: "literal";
      readonly value: FirebaseRtdbPathValue;
    };

export type FirebaseRtdbRelation = {
  readonly fromTable: string;
  readonly foreignKey: string;
  readonly toTable: string;
  readonly targetKey: string;
  readonly targetColumn: string;
  readonly targetTable: FirebaseRtdbTableDefinition;
};

type FirebaseRtdbBindingDefinition =
  | {
      readonly type: "direct";
      readonly column: string;
      readonly source: FirebaseRtdbBindingSource;
    }
  | {
      readonly type: "relation";
      readonly relation: FirebaseRtdbRelation;
      readonly source: FirebaseRtdbBindingSource;
      readonly origin: ExistsExpression;
    };

type FirebaseRtdbBindingInput =
  | {
      readonly column: string;
      readonly source: FirebaseRtdbBindingSource;
      readonly relation?: never;
      readonly origin?: never;
    }
  | {
      readonly column?: never;
      readonly source: FirebaseRtdbBindingSource;
      readonly relation: FirebaseRtdbRelation;
      readonly origin: ExistsExpression;
    };

export class FirebaseRtdbBinding {
  private readonly definition: FirebaseRtdbBindingDefinition;

  public constructor(input: FirebaseRtdbBindingInput) {
    this.definition =
      input.relation === undefined
        ? {
            type: "direct",
            column: input.column,
            source: input.source,
          }
        : {
            type: "relation",
            relation: input.relation,
            source: input.source,
            origin: input.origin,
          };
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

    const source = FirebaseRtdbBinding.sourceFrom(valueExpression);

    if (source === null) {
      return null;
    }

    return new FirebaseRtdbBinding({
      column: columnExpression.column,
      source,
    });
  }

  public static generateRelation({
    relation,
    source,
    origin,
  }: {
    relation: FirebaseRtdbRelation;
    source: FirebaseRtdbBindingSource;
    origin: ExistsExpression;
  }): FirebaseRtdbBinding {
    return new FirebaseRtdbBinding({
      relation,
      source,
      origin,
    });
  }

  public static sourceFrom(
    expression: ValueExpression<unknown>,
  ): FirebaseRtdbBindingSource | null {
    if (expression.type === "principal") {
      return {
        type: "principal",
        key: expression.key,
      };
    }

    if (
      expression.type === "literal" &&
      (typeof expression.value === "string" ||
        typeof expression.value === "number" ||
        typeof expression.value === "boolean")
    ) {
      return {
        type: "literal",
        value: expression.value,
      };
    }

    return null;
  }

  public static sourcesEqual(
    left: FirebaseRtdbBindingSource,
    right: FirebaseRtdbBindingSource,
  ): boolean {
    if (left.type !== right.type) {
      return false;
    }

    if (left.type === "principal" && right.type === "principal") {
      return left.key === right.key;
    }

    if (left.type === "literal" && right.type === "literal") {
      return left.value === right.value;
    }

    return false;
  }

  public type(): "direct" | "relation" {
    return this.definition.type;
  }

  public column(): string {
    return this.definition.type === "direct"
      ? this.definition.column
      : this.definition.relation.targetColumn;
  }

  public source(): FirebaseRtdbBindingSource {
    return this.definition.source;
  }

  public relation(): FirebaseRtdbRelation | null {
    return this.definition.type === "relation"
      ? this.definition.relation
      : null;
  }

  public origin(): ExistsExpression | null {
    return this.definition.type === "relation" ? this.definition.origin : null;
  }

  public scopeVariable(index: number): string | null {
    if (this.definition.source.type !== "principal") {
      return null;
    }

    return `$scope${index}`;
  }

  public equals(other: FirebaseRtdbBinding): boolean {
    if (this.definition.type !== other.definition.type) {
      return false;
    }

    if (!FirebaseRtdbBinding.sourcesEqual(this.source(), other.source())) {
      return false;
    }

    if (
      this.definition.type === "direct" &&
      other.definition.type === "direct"
    ) {
      return this.definition.column === other.definition.column;
    }

    if (
      this.definition.type === "relation" &&
      other.definition.type === "relation"
    ) {
      const left = this.definition.relation;
      const right = other.definition.relation;

      return (
        left.fromTable === right.fromTable &&
        left.foreignKey === right.foreignKey &&
        left.toTable === right.toTable &&
        left.targetKey === right.targetKey &&
        left.targetColumn === right.targetColumn
      );
    }

    return false;
  }
}
