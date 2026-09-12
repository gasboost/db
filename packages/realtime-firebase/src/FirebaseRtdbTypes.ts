import type { RowLevelSecurity, TableDefinition } from "@gasboost/rls";

export type FirebaseRtdbPathValue = string | number | boolean;

export type FirebaseRtdbPrincipalMapping = Readonly<Record<string, string>>;

export type FirebaseRtdbPrincipalValues<
  P extends FirebaseRtdbPrincipalMapping,
> = {
  readonly [K in keyof P]: FirebaseRtdbPathValue;
};

export type FirebaseRtdbTableDefinition<
  T extends TableDefinition = TableDefinition,
> = T & {
  readonly primaryKey: Extract<keyof T["schema"]["_output"], string>;
};

export type FirebaseRtdbRecord<T extends FirebaseRtdbTableDefinition> =
  T["schema"]["_output"];

export type FirebaseRtdbConfig<
  T extends readonly FirebaseRtdbTableDefinition[],
  P extends FirebaseRtdbPrincipalMapping,
> = {
  readonly tables: T;
  readonly rowLevelSecurity?: readonly RowLevelSecurity<T[number]>[];
  readonly principal: P;
};

export type FirebaseRtdbTableName<
  T extends readonly FirebaseRtdbTableDefinition[],
> = T[number]["name"];

export type FirebaseRtdbTableByName<
  T extends readonly FirebaseRtdbTableDefinition[],
  N extends FirebaseRtdbTableName<T>,
> = Extract<T[number], { readonly name: N }>;

export type FirebaseRtdbCompiledValue = {
  readonly expression: string;
  readonly pathString: boolean;
};

export type FirebaseRtdbRulesJsonNode = {
  [key: string]: FirebaseRtdbRulesJsonNode | string | boolean;
};

export type FirebaseRtdbRulesJson = {
  readonly rules: FirebaseRtdbRulesJsonNode;
};

export type FirebaseRtdbSnapshotKind = "current" | "next";

export type FirebaseRtdbCompilationContext =
  | {
      readonly type: "scope";
      readonly principal: FirebaseRtdbPrincipalMapping;
      readonly variables: ReadonlyMap<string, string>;
      readonly layout: import("./FirebaseRtdbLayout").FirebaseRtdbLayout;
    }
  | {
      readonly type: FirebaseRtdbSnapshotKind;
      readonly principal: FirebaseRtdbPrincipalMapping;
      readonly layout: import("./FirebaseRtdbLayout").FirebaseRtdbLayout;
    };
