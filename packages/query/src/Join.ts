import type { Query } from "./Query";
import type { TableDefinition } from "./TableDefinition";

export type JoinResolver = ({
  parent,
  table,
  children,
}: {
  parent: Record<string, unknown>;
  table: string;
  children: Record<string, unknown>[];
}) => Record<string, unknown>;

export class Join<
  T extends readonly TableDefinition[],
  N extends T[number]["name"] = T[number]["name"],
> {
  public readonly type: "left" | "inner";
  public readonly table: N;
  public readonly localKey: string;
  public readonly foreignKey: string;
  public readonly query: Query<T, N> | null;

  constructor({
    table,
    localKey,
    foreignKey,
    query = null,
    type = "left",
  }: {
    type?: "left" | "inner";
    table: N;
    localKey: string;
    foreignKey: string;
    query?: Query<T, N> | null;
  }) {
    this.type = type;
    this.table = table;
    this.localKey = localKey;
    this.foreignKey = foreignKey;
    this.query = query;
  }

  public combine(
    parents: Record<string, unknown>[],
    children: Record<string, unknown>[],
    resolve: JoinResolver,
  ): Record<string, unknown>[] {
    const childrenByKey = new Map<unknown, Record<string, unknown>[]>();

    for (const child of children) {
      const key = child[this.foreignKey];

      if (key === null || key === undefined) {
        continue;
      }

      const matched = childrenByKey.get(key) ?? [];
      matched.push(child);
      childrenByKey.set(key, matched);
    }

    const results: Record<string, unknown>[] = [];
    for (const parent of parents) {
      const key = parent[this.localKey];

      const matchedChildren =
        key === null || key === undefined ? [] : (childrenByKey.get(key) ?? []);

      if (this.type === "inner" && matchedChildren.length === 0) {
        continue;
      }

      results.push(
        resolve({
          parent,
          table: this.table,
          children: matchedChildren,
        }),
      );
    }
    return results;
  }
}

export type JoinedRecord = {
  readonly parent: Record<string, unknown>;
  readonly children: Record<string, unknown>[];
};
