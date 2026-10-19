import type { TableChange } from "@gasboost/table";
import type { VersionStore } from "./VersionStore";
import type { RtdbTransport } from "./FirebaseRtdbRestTransport";
import type {
  FirebaseRtdbRelationResolver,
  FirebaseRtdbRecordQuery,
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
  private readonly query?: FirebaseRtdbRecordQuery;

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
    query,
  }: FirebaseRtdbConfig<T, P, R>) {
    const rowLevelSecurity = configuredPolicies ?? [];
    this.tableDefinitions = tables;
    this.versionStore = versionStore;
    this.transport = transport;
    this.resolve = resolve;
    this.query = query;
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

    if (!this.versionStore || !this.transport) {
      throw new Error("publish() requires versionStore and transport.");
    }

    const tables = new Set(changes.map((change) => change.table));
    const updates: Record<string, number> = {};

    for (const table of tables) {
      updates[`syncVersions/${table}`] = this.versionStore.next(table);
    }

    this.transport.patch(updates);
  }

  /** Expand physical moves from RLS bindings without changing the storage-neutral events. */
  private includeDependents(
    changes: readonly TableChange<T[number]>[],
    query: FirebaseRtdbRecordQuery,
  ): readonly TableChange<T[number]>[] {
    const expanded = [...changes];
    const identity = (
      table: FirebaseRtdbTableDefinition,
      record: Readonly<Record<string, unknown>>,
    ) => JSON.stringify([table.name, record[table.primaryKey]]);
    const explicit = new Set<string>();
    for (const change of changes) {
      const table = this.layout(change.table).table();
      for (const record of [change.before, change.after])
        if (record) explicit.add(identity(table, record));
    }
    const dependents = new Map<
      string,
      {
        table: T[number];
        record: Readonly<Record<string, unknown>>;
        deleted: boolean;
      }
    >();
    // Relation targets are single-hop by construction: expanded children cannot
    // themselves be partition sources, so one pass covers every dependency.
    for (const layout of this.layoutRegistry.values()) {
      for (const binding of layout.bindings()) {
        const relation = binding.relation();
        if (!relation) continue;
        for (const change of changes) {
          if (change.table !== relation.toTable || change.before === null)
            continue;
          if (
            change.after !== null &&
            change.before[relation.targetColumn] ===
              change.after[relation.targetColumn] &&
            change.before[relation.targetKey] ===
              change.after[relation.targetKey]
          )
            continue;
          const keys = new Set([
            change.before[relation.targetKey],
            change.after?.[relation.targetKey],
          ]);
          for (const value of keys) {
            if (value === undefined || value === null) continue;
            if (
              typeof value !== "string" &&
              typeof value !== "number" &&
              typeof value !== "boolean"
            )
              throw new Error("Relation keys must be RTDB path values.");
            const records = query({
              table: layout.table(),
              column: relation.foreignKey,
              value,
            });
            for (const record of records) {
              const key = identity(layout.table(), record);
              // Preserve the child's actual before/after for explicit changes.
              if (explicit.has(key)) continue;
              const previous = dependents.get(key);
              dependents.set(key, {
                table: layout.table(),
                record,
                deleted: previous?.deleted === true || change.after === null,
              });
            }
          }
        }
      }
    }
    for (const { table, record, deleted } of dependents.values()) {
      expanded.push({
        table: table.name,
        before: record,
        after: deleted ? null : record,
      } as TableChange<T[number]>);
    }
    return expanded;
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
