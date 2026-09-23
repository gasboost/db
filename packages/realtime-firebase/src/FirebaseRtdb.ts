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

export type FirebaseRtdbInstance<
  T extends readonly FirebaseRtdbTableDefinition[],
  P extends FirebaseRtdbPrincipalMapping,
> = FirebaseRtdb<T, P> & {
  readonly [N in FirebaseRtdbTableName<T>]: FirebaseRtdbTable<
    FirebaseRtdbTableByName<T, N>,
    P
  >;
};

export class FirebaseRtdb<
  T extends readonly FirebaseRtdbTableDefinition[],
  P extends FirebaseRtdbPrincipalMapping,
> {
  private readonly tableDefinitions: T;

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
    rowLevelSecurity = [],
    principal,
  }: FirebaseRtdbConfig<T, P>) {
    this.tableDefinitions = tables;
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

  public static generate<
    const T extends readonly FirebaseRtdbTableDefinition[],
    const P extends FirebaseRtdbPrincipalMapping,
    const R extends readonly RowLevelSecurity<T[number], string>[] =
      readonly [],
  >(config: FirebaseRtdbConfig<T, P, R>): FirebaseRtdbInstance<T, P> {
    const rtdb = new FirebaseRtdb<T, P>(config);

    for (const table of config.tables) {
      if (table.name in rtdb) {
        throw new Error(
          `Table name '${table.name}' conflicts with a FirebaseRtdb property.`,
        );
      }

      Object.defineProperty(rtdb, table.name, {
        enumerable: true,
        configurable: false,
        writable: false,
        value: rtdb.table(table.name),
      });
    }

    return rtdb as FirebaseRtdbInstance<T, P>;
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
