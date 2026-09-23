import type { FirebaseRtdbBinding } from "./FirebaseRtdbBinding";
import { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbPathSegment } from "./FirebaseRtdbPathSegment";
import type {
  FirebaseRtdbPathValue,
  FirebaseRtdbPrincipalMapping,
  FirebaseRtdbPrincipalValues,
  FirebaseRtdbRecord,
  FirebaseRtdbRecordResolutionContext,
  FirebaseRtdbTableDefinition,
} from "./FirebaseRtdbTypes";

export class FirebaseRtdbTable<
  T extends FirebaseRtdbTableDefinition,
  P extends FirebaseRtdbPrincipalMapping,
> {
  private readonly tableLayout: FirebaseRtdbLayout<T>;

  public constructor(layout: FirebaseRtdbLayout<T>) {
    this.tableLayout = layout;
  }

  public record(
    record: FirebaseRtdbRecord<T>,
    context?: FirebaseRtdbRecordResolutionContext,
  ): string {
    const segments = this.recordSegments(record, context);

    return `/${segments.join("/")}`;
  }

  public scope(principal: FirebaseRtdbPrincipalValues<P>): string {
    if (!this.tableLayout.readable()) {
      throw new Error(
        `Table '${this.tableLayout.tableName()}' does not define a readable RLS scope.`,
      );
    }

    const segments = this.scopeSegments(principal);

    return `/${segments.join("/")}`;
  }

  public recordSegments(
    record: FirebaseRtdbRecord<T>,
    context?: FirebaseRtdbRecordResolutionContext,
  ): readonly string[] {
    const segments: string[] = [
      FirebaseRtdbPathSegment.generate(this.tableLayout.tableName()).toString(),
    ];

    if (this.tableLayout.bindings().length > 0) {
      segments.push("__rls");
    }

    const resolvedRelations = new Map<
      string,
      Readonly<Record<string, unknown>>
    >();

    for (const binding of this.tableLayout.bindings()) {
      segments.push(
        FirebaseRtdbPathSegment.generate(binding.column()).toString(),
      );

      const value = this.resolveBindingValue({
        binding,
        record,
        context,
        resolvedRelations,
      });

      segments.push(FirebaseRtdbPathSegment.generate(value).toString());
    }

    const primaryKey = this.tableLayout.primaryKey();

    const primaryKeyValue = record[primaryKey];

    if (!this.isPathValue(primaryKeyValue)) {
      throw new Error(
        `Primary key '${primaryKey}' on table '${this.tableLayout.tableName()}' must be a string, number, or boolean.`,
      );
    }

    segments.push(FirebaseRtdbPathSegment.generate(primaryKeyValue).toString());

    return segments;
  }

  public scopeSegments(
    principal: FirebaseRtdbPrincipalValues<P>,
  ): readonly string[] {
    const segments: string[] = [
      FirebaseRtdbPathSegment.generate(this.tableLayout.tableName()).toString(),
    ];

    if (this.tableLayout.bindings().length > 0) {
      segments.push("__rls");
    }

    for (const binding of this.tableLayout.bindings()) {
      segments.push(
        FirebaseRtdbPathSegment.generate(binding.column()).toString(),
      );

      const source = binding.source();

      if (source.type === "literal") {
        segments.push(
          FirebaseRtdbPathSegment.generate(source.value).toString(),
        );

        continue;
      }

      const value = principal[source.key];

      if (!this.isPathValue(value)) {
        throw new Error(
          `Principal '${source.key}' is required to generate the RTDB scope for table '${this.tableLayout.tableName()}'.`,
        );
      }

      segments.push(
        FirebaseRtdbPathSegment.generate(
          value as FirebaseRtdbPathValue,
        ).toString(),
      );
    }

    return segments;
  }

  public layout(): FirebaseRtdbLayout<T> {
    return this.tableLayout;
  }

  private resolveBindingValue({
    binding,
    record,
    context,
    resolvedRelations,
  }: {
    binding: FirebaseRtdbBinding;
    record: FirebaseRtdbRecord<T>;
    context?: FirebaseRtdbRecordResolutionContext;
    resolvedRelations: Map<string, Readonly<Record<string, unknown>>>;
  }): FirebaseRtdbPathValue {
    if (binding.type() === "direct") {
      const value = record[binding.column()];

      if (!this.isPathValue(value)) {
        throw new Error(
          `RLS partition column '${binding.column()}' on table '${this.tableLayout.tableName()}' must be a string, number, or boolean.`,
        );
      }

      this.ensureLiteral(binding, value);

      return value;
    }

    const relation = binding.relation();

    if (relation === null) {
      throw new Error("Expected relation RTDB binding.");
    }

    if (context === undefined) {
      throw new Error(
        `RLS relation partition '${relation.fromTable}.${relation.foreignKey} -> ${relation.toTable}.${relation.targetKey}' requires a relation resolver to generate a record path.`,
      );
    }

    const foreignKeyValue = record[relation.foreignKey];

    if (!this.isPathValue(foreignKeyValue)) {
      throw new Error(
        `RLS relation foreign key '${relation.foreignKey}' on table '${relation.fromTable}' must be a string, number, or boolean.`,
      );
    }

    const cacheKey = JSON.stringify([
      relation.toTable,
      relation.targetKey,
      typeof foreignKeyValue,
      foreignKeyValue,
    ]);

    let relatedRecord = resolvedRelations.get(cacheKey);

    if (relatedRecord === undefined) {
      const resolved = context.resolve({
        table: relation.targetTable,
        primaryKey: relation.targetKey,
        value: foreignKeyValue,
      });

      if (
        resolved !== null &&
        typeof resolved === "object" &&
        "then" in resolved &&
        typeof (resolved as { then?: unknown }).then === "function"
      ) {
        throw new Error(
          "FirebaseRtdbTable.record() requires a synchronous relation resolver.",
        );
      }

      if (resolved === null || resolved === undefined) {
        throw new Error(
          `Related record '${relation.toTable}.${relation.targetKey}=${String(foreignKeyValue)}' was not found while generating the RTDB path for table '${relation.fromTable}'.`,
        );
      }

      relatedRecord = resolved;
      resolvedRelations.set(cacheKey, relatedRecord);
    }

    if (relatedRecord[relation.targetKey] !== foreignKeyValue) {
      throw new Error(
        `Resolved relation record '${relation.toTable}' does not match '${relation.targetKey}=${String(foreignKeyValue)}'.`,
      );
    }

    const value = relatedRecord[relation.targetColumn];

    if (!this.isPathValue(value)) {
      throw new Error(
        `RLS relation partition column '${relation.toTable}.${relation.targetColumn}' must be a string, number, or boolean.`,
      );
    }

    this.ensureLiteral(binding, value);

    return value;
  }

  private ensureLiteral(
    binding: FirebaseRtdbBinding,
    value: FirebaseRtdbPathValue,
  ): void {
    const source = binding.source();

    if (source.type === "literal" && value !== source.value) {
      throw new Error(
        `RLS partition column '${binding.column()}' must equal ${JSON.stringify(source.value)}.`,
      );
    }
  }

  private isPathValue(value: unknown): value is FirebaseRtdbPathValue {
    return (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  }
}
