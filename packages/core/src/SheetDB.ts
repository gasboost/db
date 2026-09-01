import { z } from "zod";
import { AccessableDataStore } from "./AccessableDataStore";
import { CreateCommand } from "./commands/CreateCommand";
import { DeleteCommand } from "./commands/DeleteCommand";
import { UpdateCommand } from "./commands/UpdateCommand";
import { SheetQuery } from "./query/SheetQuery";
import { SheetRecords } from "./SheetRecords";
import { SheetTable } from "./SheetTable";

export type TableByName<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"],
> = Extract<T[number], { name: N }>;

export type CurrentTable<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"],
> = TableByName<T, N>;

export type CurrentRecord<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"],
> = z.infer<CurrentTable<T, N>["schema"]>;

export class SheetDB<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"] = T[number]["name"],
> {
  private currentTable: TableByName<T, N>;

  constructor(
    private readonly tables: T,
    private readonly gateway: AccessableDataStore,
  ) {
    if (tables.length === 0) {
      throw new Error("At least one table is required.");
    }
    this.currentTable = tables[0] as TableByName<T, N>;
  }

  table<U extends T[number]["name"]>(name: U): SheetDB<T, U> {
    const table = this.tables.find(
      (candidate): candidate is TableByName<T, U> => candidate.name === name,
    );
    if (!table) {
      throw new Error(`Table '${name}' not found.`);
    }

    this.currentTable = table as unknown as TableByName<T, N>;
    this.gateway.table(table.name, table.dbId);
    return this as unknown as SheetDB<T, U>;
  }

  query<U extends T[number]["name"]>(
    tableName: U,
  ): SheetQuery<T, TableByName<T, U>["schema"], U> {
    return new SheetQuery<T, TableByName<T, U>["schema"], U>(
      [],
      [],
      null,
      null,
      null,
      [],
      tableName,
    );
  }

  create(records: CurrentRecord<T, N>[]): CurrentRecord<T, N>[] {
    this.gateway.table(this.currentTable.name, this.currentTable.dbId);
    const existing = new SheetRecords(
      this.gateway.read(),
      this.currentTable.primaryKey as string,
    );
    const command = new CreateCommand(
      this.gateway,
      this.currentTable,
      records as Record<string, any>[],
    );
    return command.execute(existing) as CurrentRecord<T, N>[];
  }

  update(records: CurrentRecord<T, N>[]): CurrentRecord<T, N>[] {
    this.gateway.table(this.currentTable.name, this.currentTable.dbId);
    const existing = new SheetRecords(
      this.gateway.read(),
      this.currentTable.primaryKey as string,
    );
    const command = new UpdateCommand(
      this.currentTable,
      this.gateway,
      records as Record<string, any>[],
    );
    return command.execute(existing) as CurrentRecord<T, N>[];
  }

  upsert(records: CurrentRecord<T, N>[]): CurrentRecord<T, N>[] {
    this.gateway.table(this.currentTable.name, this.currentTable.dbId);
    const existing = new SheetRecords(
      this.gateway.read(),
      this.currentTable.primaryKey as string,
    );
    const primaryKey = this.currentTable.primaryKey as string;
    const result = new Array<CurrentRecord<T, N>>(records.length);
    const createRecords: Record<string, any>[] = [];
    const createIndexes: number[] = [];
    const updateRecords: Record<string, any>[] = [];
    const updateIndexes: number[] = [];

    records.forEach((record, index) => {
      const rawRecord = { ...record } as Record<string, any>;
      const primaryKeyValue = rawRecord[primaryKey];
      const hasPrimaryKey =
        primaryKeyValue !== null &&
        primaryKeyValue !== undefined &&
        !(typeof primaryKeyValue === "string" && primaryKeyValue.trim() === "");

      if (hasPrimaryKey && existing.getRecord(primaryKeyValue)) {
        updateRecords.push(rawRecord);
        updateIndexes.push(index);
        return;
      }

      createRecords.push(rawRecord);
      createIndexes.push(index);
    });

    if (updateRecords.length > 0) {
      const command = new UpdateCommand(
        this.currentTable,
        this.gateway,
        updateRecords,
      );
      const updated = command.execute(existing);
      updated.forEach((record, index) => {
        result[updateIndexes[index]] = record as CurrentRecord<T, N>;
      });
    }

    if (createRecords.length > 0) {
      const command = new CreateCommand(
        this.gateway,
        this.currentTable,
        createRecords,
      );
      const created = command.execute(existing);
      created.forEach((record, index) => {
        result[createIndexes[index]] = record as CurrentRecord<T, N>;
      });
    }

    return result;
  }

  delete(primaryKeyValues: unknown[]): boolean {
    this.gateway.table(this.currentTable.name, this.currentTable.dbId);
    const existing = new SheetRecords(
      this.gateway.read(),
      this.currentTable.primaryKey as string,
    );
    const command = new DeleteCommand(
      this.currentTable,
      this.gateway,
      primaryKeyValues,
    );
    command.execute(existing);
    return true;
  }

  find(): CurrentRecord<T, N>[];
  find<U extends T[number]["name"]>(
    query: SheetQuery<T, TableByName<T, U>["schema"], U>,
  ): CurrentRecord<T, U>[];
  find(query?: SheetQuery<T, any, any>): Record<string, any>[] {
    const queryTableName = query?.getTableName();
    if (queryTableName) {
      this.table(queryTableName);
    }

    this.gateway.table(this.currentTable.name, this.currentTable.dbId);
    const records = this.gateway.read();
    if (!query) {
      return records;
    }

    return query.cut(query.shift(query.sort(query.filter(records))));
  }
}
