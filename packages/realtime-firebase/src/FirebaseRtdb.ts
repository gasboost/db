import type { TableRecord, TableChange } from "@gasboost/table";
import type { VersionStore } from "./VersionStore";
import type { RtdbTransport } from "./FirebaseRtdbRestTransport";
import type {
  FirebaseRtdbRelationResolver,
  FirebaseRtdbRecordResolutionContext,
} from "./FirebaseRtdbTypes";
import type { RowLevelSecurity } from "@gasboost/rls";
import { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbPrincipalValidator } from "./FirebaseRtdbPrincipalValidator";
import { FirebaseRtdbRulesCompiler } from "./FirebaseRtdbRulesCompiler";
import { FirebaseRtdbTable } from "./FirebaseRtdbTable";
import type {
  FirebaseRtdbConfig,
  FirebaseRtdbPrincipalMapping,
  FirebaseRtdbRulesJson,
  FirebaseRtdbTableByName,
  FirebaseRtdbTableDefinition,
  FirebaseRtdbTableName,
} from "./FirebaseRtdbTypes";

export class FirebaseRtdb<
  const T extends readonly FirebaseRtdbTableDefinition[],
  const P extends FirebaseRtdbPrincipalMapping,
  const R extends readonly RowLevelSecurity<T[number], string>[] =
    readonly RowLevelSecurity<T[number], string>[],
> {
  private readonly tableDefinitions: T;
  private readonly versionStore?: VersionStore;
  private readonly transport?: RtdbTransport;
  private readonly resolve?: FirebaseRtdbRelationResolver;

  private readonly securityPolicies: readonly RowLevelSecurity<T[number]>[];

  private readonly principalDefinition: P;

  private readonly layoutRegistry: ReadonlyMap<
    string,
    FirebaseRtdbLayout<T[number]>
  >;

  private readonly tableRegistry: ReadonlyMap<
    string,
    FirebaseRtdbTable<T[number], P>
  >;

  public constructor({
    tables,
    rowLevelSecurity: configuredPolicies,
    principal,
    versionStore,
    transport,
    resolve,
  }: FirebaseRtdbConfig<T, P, R>) {
    const rowLevelSecurity = configuredPolicies ?? [];
    this.tableDefinitions = tables;
    this.versionStore = versionStore;
    this.transport = transport;
    this.resolve = resolve;
    this.securityPolicies = rowLevelSecurity;
    this.principalDefinition = principal;

    this.ensureUniqueTables();
    this.ensurePoliciesReferenceTables();

    const policyRegistry = new Map<string, RowLevelSecurity<T[number]>>();

    const validator = new FirebaseRtdbPrincipalValidator(principal);

    for (const policy of rowLevelSecurity) {
      if (policyRegistry.has(policy.table.name)) {
        throw new Error(
          `Row Level Security is defined more than once for table '${policy.table.name}'.`,
        );
      }

      validator.validatePolicy(policy);

      policyRegistry.set(policy.table.name, policy);
    }

    const layouts = new Map<string, FirebaseRtdbLayout<T[number]>>();

    const tablesRegistry = new Map<string, FirebaseRtdbTable<T[number], P>>();

    for (const table of tables) {
      const policy = policyRegistry.get(table.name) ?? null;

      const layout = FirebaseRtdbLayout.generate({
        table,
        policy,
        tables,
      });

      layouts.set(table.name, layout);

      tablesRegistry.set(table.name, new FirebaseRtdbTable(layout));
    }

    this.layoutRegistry = layouts;
    this.tableRegistry = tablesRegistry;

    this.ensureRelationProjectionAcyclic();
    this.ensureSingleHopRelationTargets();
  }

  /** Publish once per logical commit. Retry the same changes or perform a full resync on error. */
  public publish(changes: readonly TableChange<T[number]>[]): void {
    if (changes.length === 0) return;
    if (!this.versionStore || !this.transport)
      throw new Error("publish() requires versionStore and transport.");

    const context = (
      side: "before" | "after",
    ): FirebaseRtdbRecordResolutionContext => ({
      resolve: (request) => {
        const changed = changes.find(
          (change) =>
            change.table === request.table.name &&
            (change[side] as Record<string, unknown> | null)?.[
              request.primaryKey
            ] === request.value,
        );
        if (changed) return changed[side];
        return this.resolve?.(request);
      },
    });
    // Resolve all paths before allocating versions; validation must not consume versions.
    const resolved = changes.map((change) => {
      const table = this.tableRegistry.get(change.table);
      if (!table)
        throw new Error(`RTDB table '${change.table}' was not found.`);
      const before = change.before as Record<string, unknown> | null;
      const after = change.after as Record<string, unknown> | null;
      if (before === null && after === null)
        throw new Error("A change must contain before or after.");
      for (const record of [before, after]) {
        if (record && ("__syncVersion" in record || "__deleted" in record))
          throw new Error(
            "__syncVersion and __deleted are reserved RTDB fields.",
          );
      }
      return {
        change,
        table,
        beforePath:
          before === null
            ? null
            : table.record(
                change.before! as TableRecord<T[number]>,
                context("before"),
              ),
        afterPath:
          after === null
            ? null
            : table.record(
                change.after! as TableRecord<T[number]>,
                context("after"),
              ),
      };
    });
    const versions = new Map<string, number>();
    for (const { change } of resolved) {
      if (!versions.has(change.table)) {
        const version = this.versionStore.next(change.table);
        if (!Number.isSafeInteger(version) || version <= 0)
          throw new Error(`Invalid RTDB version for '${change.table}'.`);
        versions.set(change.table, version);
      }
    }
    const updates: Record<string, unknown> = {};
    // Old paths first: a new live record at the same path must win over a tombstone.
    for (const { change, table, beforePath, afterPath } of resolved) {
      const version = versions.get(change.table)!;
      if (beforePath !== null && beforePath !== afterPath) {
        updates[beforePath.slice(1)] = {
          [table.layout().primaryKey()]:
            change.before![table.layout().primaryKey()],
          __deleted: true,
          __syncVersion: version,
        };
        updates[
          `__gasboost/tableVersions${beforePath.slice(0, beforePath.lastIndexOf("/"))}`
        ] = version;
      }
    }
    for (const { change, afterPath } of resolved) {
      if (afterPath !== null) {
        const version = versions.get(change.table)!;
        updates[afterPath.slice(1)] = {
          ...change.after,
          __syncVersion: version,
        };
        updates[
          `__gasboost/tableVersions${afterPath.slice(0, afterPath.lastIndexOf("/"))}`
        ] = version;
      }
    }
    this.transport.patch(updates);
  }

  public tables(): T {
    return this.tableDefinitions;
  }

  public principal(): P {
    return this.principalDefinition;
  }

  public policies(): readonly RowLevelSecurity<T[number]>[] {
    return this.securityPolicies;
  }

  public table<N extends FirebaseRtdbTableName<T>>(
    name: N,
  ): FirebaseRtdbTable<FirebaseRtdbTableByName<T, N>, P> {
    const table = this.tableRegistry.get(name);

    if (table === undefined) {
      throw new Error(`RTDB table '${name}' was not found.`);
    }

    return table as FirebaseRtdbTable<FirebaseRtdbTableByName<T, N>, P>;
  }

  public layout(name: string): FirebaseRtdbLayout<T[number]> {
    const layout = this.layoutRegistry.get(name);

    if (layout === undefined) {
      throw new Error(`RTDB layout '${name}' was not found.`);
    }

    return layout;
  }

  public rules(): FirebaseRtdbRulesJson {
    return FirebaseRtdbRulesCompiler.generate(
      this as unknown as FirebaseRtdb<
        readonly FirebaseRtdbTableDefinition[],
        FirebaseRtdbPrincipalMapping
      >,
    );
  }

  public ensureUniqueTables(): void {
    const names = new Set<string>();

    for (const table of this.tableDefinitions) {
      if (table.name === "__gasboost")
        throw new Error(
          "Table name '__gasboost' is reserved for RTDB metadata.",
        );
      if (names.has(table.name)) {
        throw new Error(`Table '${table.name}' is defined more than once.`);
      }

      names.add(table.name);
    }
  }

  public ensurePoliciesReferenceTables(): void {
    const names = new Set(this.tableDefinitions.map((table) => table.name));

    for (const policy of this.securityPolicies) {
      if (!names.has(policy.table.name)) {
        throw new Error(
          `Row Level Security references table '${policy.table.name}', but that table is not registered in Firebase RTDB.`,
        );
      }
    }
  }

  public ensureRelationProjectionAcyclic(): void {
    const graph = new Map<string, Set<string>>();

    for (const [tableName, layout] of this.layoutRegistry) {
      const targets = new Set<string>();

      for (const binding of layout.bindings()) {
        const relation = binding.relation();

        if (relation !== null) {
          targets.add(relation.toTable);
        }
      }

      graph.set(tableName, targets);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (tableName: string, path: readonly string[]): void => {
      if (visiting.has(tableName)) {
        const start = path.indexOf(tableName);
        const cycle = [...path.slice(start), tableName];

        throw new Error(
          `RTDB relation projection contains a cycle: ${cycle.join(" -> ")}.`,
        );
      }

      if (visited.has(tableName)) {
        return;
      }

      visiting.add(tableName);

      for (const target of graph.get(tableName) ?? []) {
        visit(target, [...path, tableName]);
      }

      visiting.delete(tableName);
      visited.add(tableName);
    };

    for (const tableName of graph.keys()) {
      visit(tableName, []);
    }
  }

  public ensureSingleHopRelationTargets(): void {
    for (const layout of this.layoutRegistry.values()) {
      for (const binding of layout.bindings()) {
        const relation = binding.relation();

        if (relation === null) {
          continue;
        }

        const target = this.layoutRegistry.get(relation.toTable);

        if (target === undefined) {
          throw new Error(
            `RTDB relation references unregistered table '${relation.toTable}'.`,
          );
        }

        if (target.hasRelationBindings()) {
          throw new Error(
            `RTDB relation from '${relation.fromTable}' to '${relation.toTable}' would require multi-hop relation projection, which is not currently supported.`,
          );
        }
      }
    }
  }
}
