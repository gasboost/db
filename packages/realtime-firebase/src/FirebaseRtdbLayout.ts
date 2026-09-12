import type { RowLevelSecurity } from "@gasboost/rls";
import { FirebaseRtdbBinding } from "./FirebaseRtdbBinding";
import { FirebaseRtdbScopeProjector } from "./FirebaseRtdbScopeProjector";
import type { FirebaseRtdbTableDefinition } from "./FirebaseRtdbTypes";

export class FirebaseRtdbLayout<
  T extends FirebaseRtdbTableDefinition = FirebaseRtdbTableDefinition,
> {
  private readonly tableDefinition: T;
  private readonly securityPolicy: RowLevelSecurity<T> | null;
  private readonly partitionBindings: readonly FirebaseRtdbBinding[];
  private readonly readableScope: boolean;

  public constructor({
    table,
    policy,
    bindings,
    readable,
  }: {
    table: T;
    policy: RowLevelSecurity<T> | null;
    bindings: readonly FirebaseRtdbBinding[];
    readable: boolean;
  }) {
    this.tableDefinition = table;
    this.securityPolicy = policy;
    this.partitionBindings = bindings;
    this.readableScope = readable;
  }

  public static generate<T extends FirebaseRtdbTableDefinition>({
    table,
    policy,
  }: {
    table: T;
    policy: RowLevelSecurity<T> | null;
  }): FirebaseRtdbLayout<T> {
    if (policy === null) {
      return new FirebaseRtdbLayout({
        table,
        policy,
        bindings: [],
        readable: true,
      });
    }

    if (policy.select === null) {
      return new FirebaseRtdbLayout({
        table,
        policy,
        bindings: [],
        readable: false,
      });
    }

    const projector = new FirebaseRtdbScopeProjector();

    const bindings = projector.project(policy.select.using, table.name);

    return new FirebaseRtdbLayout({
      table,
      policy,
      bindings,
      readable: true,
    });
  }

  public table(): T {
    return this.tableDefinition;
  }

  public tableName(): string {
    return this.tableDefinition.name;
  }

  public primaryKey(): string {
    return String(this.tableDefinition.primaryKey);
  }

  public policy(): RowLevelSecurity<T> | null {
    return this.securityPolicy;
  }

  public bindings(): readonly FirebaseRtdbBinding[] {
    return this.partitionBindings;
  }

  public readable(): boolean {
    return this.readableScope;
  }

  public hasSecurity(): boolean {
    return this.securityPolicy !== null;
  }
}
