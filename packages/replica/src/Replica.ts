import { QueryEvaluation, type Query } from "@gasboost/query";
import Dexie, { type Table } from "dexie";
import { ReplicaTable } from "./ReplicaTable";
import {
  type ReplicaRecord,
  type ReplicaTableByName,
  type ReplicaTableDefinition,
} from "./ReplicaTableDefinition";

type PrimaryKey<
  T extends readonly ReplicaTableDefinition[],
  N extends T[number]["name"],
> = ReplicaRecord<T, N>[ReplicaTableByName<T, N>["primaryKey"] &
  keyof ReplicaRecord<T, N>];

export class Replica<T extends readonly ReplicaTableDefinition[]> {
  private readonly db: Dexie;
  private readonly tables: T;

  constructor({ name, tables }: { name: string; tables: T }) {
    this.tables = tables;
    this.db = new Dexie(name);

    const schema = Object.fromEntries(
      tables.map((table) => [table.name, table.primaryKey]),
    );

    this.db.version(1).stores(schema);
  }

  public table<N extends T[number]["name"]>(
    name: N,
  ): ReplicaTable<ReplicaRecord<T, N>, PrimaryKey<T, N>> {
    return new ReplicaTable(
      this.db.table(name) as Table<ReplicaRecord<T, N>, PrimaryKey<T, N>>,
    );
  }

  public async sync<N extends T[number]["name"]>(
    name: N,
    records: ReplicaRecord<T, N>[],
  ): Promise<void> {
    const table = this.db.table(name);

    await this.db.transaction("rw", table, async () => {
      await table.clear();

      if (records.length > 0) {
        await table.bulkPut(records);
      }
    });
  }

  public async find<N extends T[number]["name"]>(
    query: Query<T, N>,
  ): Promise<Record<string, unknown>[]> {
    const evaluation = new QueryEvaluation(
      query,
      async (name) =>
        this.db.table(name).toArray() as Promise<Record<string, unknown>[]>,
      ({ parent, table, children }) => ({
        ...parent,
        [table]: children,
      }),
    );

    return evaluation.resolve();
  }
}
