import { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbPathSegment } from "./FirebaseRtdbPathSegment";
import type {
  FirebaseRtdbPathValue,
  FirebaseRtdbPrincipalMapping,
  FirebaseRtdbPrincipalValues,
  FirebaseRtdbRecord,
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

  public record(record: FirebaseRtdbRecord<T>): string {
    const segments = this.recordSegments(record);

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

  public recordSegments(record: FirebaseRtdbRecord<T>): readonly string[] {
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

      const value = record[binding.column()];

      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new Error(
          `RLS partition column '${binding.column()}' on table '${this.tableLayout.tableName()}' must be a string, number, or boolean.`,
        );
      }

      const source = binding.source();

      if (source.type === "literal" && value !== source.value) {
        throw new Error(
          `RLS partition column '${binding.column()}' must equal ${JSON.stringify(source.value)}.`,
        );
      }

      segments.push(FirebaseRtdbPathSegment.generate(value).toString());
    }

    const primaryKey = this.tableLayout.primaryKey();

    const primaryKeyValue = record[primaryKey];

    if (
      typeof primaryKeyValue !== "string" &&
      typeof primaryKeyValue !== "number" &&
      typeof primaryKeyValue !== "boolean"
    ) {
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

      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
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
}
