import type {
  KeyedTableDefinition,
  TableColumnName,
  TableRecord,
  TableRecordByName,
} from "@gasboost/table";
import type { RowLevelSecurity } from "@gasboost/rls";

export type FirebaseRtdbPathValue = string | number | boolean;

export type FirebaseRtdbPrincipalMapping = Readonly<Record<string, string>>;

export type FirebaseRtdbRequiredPrincipalKeys<
  R extends readonly RowLevelSecurity<any, string>[],
> = R[number] extends RowLevelSecurity<any, infer K> ? K : never;

export type FirebaseRtdbRequiredPrincipalMapping<
  R extends readonly RowLevelSecurity<any, string>[],
> = {
  readonly [K in FirebaseRtdbRequiredPrincipalKeys<R>]: string;
};

export type FirebaseRtdbPrincipalValues<
  P extends FirebaseRtdbPrincipalMapping,
> = {
  readonly [K in keyof P]: FirebaseRtdbPathValue;
};

export type FirebaseRtdbTableDefinition = KeyedTableDefinition;

export type FirebaseRtdbValidatedTable<T extends FirebaseRtdbTableDefinition> =
  T["primaryKey"] extends TableColumnName<T> ? T : never;

export type FirebaseRtdbValidatedTables<
  T extends readonly FirebaseRtdbTableDefinition[],
> = {
  readonly [K in keyof T]: T[K] extends FirebaseRtdbTableDefinition
    ? FirebaseRtdbValidatedTable<T[K]>
    : never;
};

export type FirebaseRtdbRecord<T extends FirebaseRtdbTableDefinition> =
  TableRecord<T>;

export type FirebaseRtdbConfig<
  T extends readonly FirebaseRtdbTableDefinition[],
  P extends FirebaseRtdbPrincipalMapping,
  R extends readonly RowLevelSecurity<T[number], string>[] =
    readonly RowLevelSecurity<T[number], string>[],
> = {
  readonly tables: T & FirebaseRtdbValidatedTables<T>;
  readonly rowLevelSecurity?: R;
  readonly principal: P & FirebaseRtdbRequiredPrincipalMapping<R>;
};

export type FirebaseRtdbTableName<
  T extends readonly FirebaseRtdbTableDefinition[],
> = T[number]["name"];

export type FirebaseRtdbTableByName<
  T extends readonly FirebaseRtdbTableDefinition[],
  N extends FirebaseRtdbTableName<T>,
> = Extract<T[number], { readonly name: N }>;

export type FirebaseRtdbRecordByName<
  T extends readonly FirebaseRtdbTableDefinition[],
  N extends FirebaseRtdbTableName<T>,
> = TableRecordByName<T, N>;

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
