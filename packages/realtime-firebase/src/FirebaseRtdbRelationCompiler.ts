import {
  FirebaseRtdbBinding,
  type FirebaseRtdbBindingSource,
  type FirebaseRtdbRelation,
} from "./FirebaseRtdbBinding";
import type { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbPathSegment } from "./FirebaseRtdbPathSegment";
import { FirebaseRtdbRuleLiteral } from "./FirebaseRtdbRuleLiteral";
import type {
  FirebaseRtdbCompilationContext,
  FirebaseRtdbSnapshotKind,
} from "./FirebaseRtdbTypes";
import { FirebaseRtdbValueCompiler } from "./FirebaseRtdbValueCompiler";

export class FirebaseRtdbRelationCompiler {
  private readonly context: FirebaseRtdbCompilationContext;

  public constructor(context: FirebaseRtdbCompilationContext) {
    this.context = context;
  }

  public compileScope(bindings: readonly FirebaseRtdbBinding[]): string {
    this.ensureRelationBindings(bindings);

    if (this.context.type !== "scope") {
      throw new Error(
        "RTDB scope context is required for relation scope compilation.",
      );
    }

    const conditions: string[] = [];

    for (const binding of bindings) {
      const source = binding.source();

      if (source.type === "literal") {
        continue;
      }

      const variable = this.context.variables.get(binding.column());

      if (variable === undefined) {
        throw new Error(
          `RTDB scope variable for relation partition '${binding.column()}' was not found.`,
        );
      }

      const mapped = this.context.principal[source.key];

      if (mapped === undefined) {
        throw new Error(
          `Firebase principal mapping for '${source.key}' is not defined.`,
        );
      }

      conditions.push(`${variable} === (${mapped} + '')`);
    }

    if (conditions.length === 0) {
      return "true";
    }

    return conditions.map((condition) => `(${condition})`).join(" && ");
  }

  public compileRecord(
    bindings: readonly FirebaseRtdbBinding[],
    snapshot: FirebaseRtdbSnapshotKind,
  ): string {
    const relation = this.ensureRelationBindings(bindings);

    const resolveLayout = this.context.resolveLayout;

    if (resolveLayout === undefined) {
      throw new Error(
        `RTDB relation '${relation.fromTable}.${relation.foreignKey} -> ${relation.toTable}.${relation.targetKey}' requires a layout resolver.`,
      );
    }

    const targetLayout = resolveLayout(relation.toTable);

    if (targetLayout.hasRelationBindings()) {
      throw new Error(
        `RTDB relation from '${relation.fromTable}' to '${relation.toTable}' would require multi-hop relation projection, which is not currently supported.`,
      );
    }

    const foreignKeyExpression = new FirebaseRtdbValueCompiler({
      type: snapshot,
      layout: this.context.layout,
      principal: this.context.principal,
      resolveLayout: this.context.resolveLayout,
    }).compileOuterColumn({
      type: "outerColumn",
      table: relation.fromTable,
      column: relation.foreignKey,
    }).expression;
    const targetPath = this.compileTargetRecordPath({
      targetLayout,
      relationBindings: bindings,
      foreignKeyExpression,
    });

    const conditions: string[] = [
      `${targetPath}.exists()`,
      `${targetPath}.child(${JSON.stringify(relation.targetKey)}).val() === ${foreignKeyExpression}`,
    ];

    for (const binding of bindings) {
      const currentRelation = binding.relation();

      if (currentRelation === null) {
        throw new Error("Expected a relation RTDB binding.");
      }

      conditions.push(
        `${targetPath}.child(${JSON.stringify(currentRelation.targetColumn)}).val() === ${this.compileSourceValue(binding.source())}`,
      );
    }

    return conditions.map((condition) => `(${condition})`).join(" && ");
  }

  private compileTargetRecordPath({
    targetLayout,
    relationBindings,
    foreignKeyExpression,
  }: {
    targetLayout: FirebaseRtdbLayout;
    relationBindings: readonly FirebaseRtdbBinding[];
    foreignKeyExpression: string;
  }): string {
    let expression = `root.child(${JSON.stringify(
      FirebaseRtdbPathSegment.generate(targetLayout.tableName()).toString(),
    )})`;

    if (targetLayout.bindings().length > 0) {
      expression += `.child(${JSON.stringify("__rls")})`;
    }

    for (const targetBinding of targetLayout.bindings()) {
      if (targetBinding.type() === "relation") {
        throw new Error(
          `RTDB relation target '${targetLayout.tableName()}' uses relation-aware partitions, which would require multi-hop relation projection.`,
        );
      }

      expression += `.child(${JSON.stringify(
        FirebaseRtdbPathSegment.generate(targetBinding.column()).toString(),
      )})`;

      expression += `.child(${this.compileTargetPartitionValue(
        targetBinding,
        relationBindings,
      )})`;
    }

    expression += `.child((${foreignKeyExpression} + ''))`;

    return expression;
  }

  private compileTargetPartitionValue(
    targetBinding: FirebaseRtdbBinding,
    relationBindings: readonly FirebaseRtdbBinding[],
  ): string {
    const matchingRelationBinding = relationBindings.find((binding) => {
      const relation = binding.relation();

      return (
        relation !== null &&
        relation.targetColumn === targetBinding.column() &&
        FirebaseRtdbBinding.sourcesEqual(
          binding.source(),
          targetBinding.source(),
        )
      );
    });

    if (matchingRelationBinding !== undefined) {
      const source = matchingRelationBinding.source();

      if (source.type === "literal") {
        return this.compilePathLiteral(source.value);
      }

      const index = this.context.layout
        .bindings()
        .indexOf(matchingRelationBinding);
      const variable = matchingRelationBinding.scopeVariable(index);

      if (variable === null) {
        throw new Error(
          `RTDB scope variable for relation partition '${matchingRelationBinding.column()}' was not generated.`,
        );
      }

      return variable;
    }

    const source = targetBinding.source();

    if (source.type === "literal") {
      return this.compilePathLiteral(source.value);
    }

    const mapped = this.context.principal[source.key];

    if (mapped === undefined) {
      throw new Error(
        `Firebase principal mapping for '${source.key}' is not defined.`,
      );
    }

    return `(${mapped} + '')`;
  }

  private compilePathLiteral(value: string | number | boolean): string {
    return JSON.stringify(FirebaseRtdbPathSegment.generate(value).toString());
  }

  private compileSourceValue(source: FirebaseRtdbBindingSource): string {
    if (source.type === "literal") {
      return FirebaseRtdbRuleLiteral.generate(source.value);
    }

    const mapped = this.context.principal[source.key];

    if (mapped === undefined) {
      throw new Error(
        `Firebase principal mapping for '${source.key}' is not defined.`,
      );
    }

    return mapped;
  }

  private ensureRelationBindings(
    bindings: readonly FirebaseRtdbBinding[],
  ): FirebaseRtdbRelation {
    if (bindings.length === 0) {
      throw new Error("Projectable exists() relation metadata was not found.");
    }

    const first = bindings[0].relation();

    if (first === null) {
      throw new Error("Expected relation RTDB bindings.");
    }

    for (const binding of bindings) {
      const relation = binding.relation();

      if (
        relation === null ||
        relation.fromTable !== first.fromTable ||
        relation.foreignKey !== first.foreignKey ||
        relation.toTable !== first.toTable ||
        relation.targetKey !== first.targetKey
      ) {
        throw new Error("RTDB relation bindings do not describe one relation.");
      }
    }

    return first;
  }
}
