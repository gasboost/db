import { z } from "zod";
import { AccessableDataStore } from "./AccessableDataStore";
import { CommandBuffer } from "./CommandBuffer";
import { CreateCommand } from "./commands/CreateCommand";
import { DeleteCommand } from "./commands/DeleteCommand";
import { UpdateCommand } from "./commands/UpdateCommand";
import { SheetQuery, TableByName } from "./query/SheetQuery";
import { CacheLike, CacheServiceLike, UtilitiesLike } from "./RuntimeTypes";
import {
  getIncomingRelations,
  getOutgoingRelations,
  SheetRelation,
} from "./SheetRelation";
import { SheetRecords } from "./SheetRecords";
import { SheetTable } from "./SheetTable";

export type CurrentTable<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"],
> = TableByName<T, N>;

export type CurrentRecord<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"],
> = z.infer<CurrentTable<T, N>["schema"]>;

const localCache = new Map<string, string>();
const fallbackCache: CacheLike = {
  get: (key) => localCache.get(key) ?? null,
  put: (key, value) => void localCache.set(key, value),
  remove: (key) => void localCache.delete(key),
};
const fallbackUtilities: UtilitiesLike = {
  getUuid: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  sleep: () => undefined,
};

export class SheetDB<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"] = T[number]["name"],
> {
  private readonly currentTable: TableByName<T, N>;
  private readonly cache: CacheLike;
  private readonly utilities: UtilitiesLike;
  private readonly commandBuffer: CommandBuffer;

  constructor(
    private readonly tables: T,
    private readonly gateway: AccessableDataStore,
    private readonly CacheService?: CacheServiceLike,
    Utilities?: UtilitiesLike,
    currentTable?: TableByName<T, N>,
    commandBuffer?: CommandBuffer,
  ) {
    if (tables.length === 0) throw new Error("At least one table is required.");
    this.currentTable = currentTable ?? (tables[0] as TableByName<T, N>);
    this.cache = CacheService?.getScriptCache() ?? fallbackCache;
    this.utilities = Utilities ?? fallbackUtilities;
    this.commandBuffer =
      commandBuffer ?? new CommandBuffer(gateway, this.cache, this.utilities);
  }

  table<U extends T[number]["name"]>(name: U): SheetDB<T, U> {
    const table = this.tables.find(
      (candidate): candidate is TableByName<T, U> => candidate.name === name,
    );
    if (!table) throw new Error(`Table '${name}' not found.`);
    return new SheetDB<T, U>(
      this.tables,
      this.gateway,
      this.CacheService,
      this.utilities,
      table,
      this.commandBuffer,
    );
  }

  query<U extends T[number]["name"]>(
    tableName: U,
  ): SheetQuery<T, TableByName<T, U>["schema"], U> {
    return new SheetQuery<T, TableByName<T, U>["schema"], U>(
      [], [], null, null, null, [], tableName,
    );
  }

  create(records: Partial<CurrentRecord<T, N>>[]): CurrentRecord<T, N>[] {
    if (!this.commandBuffer.isActive() && getOutgoingRelations(this.currentTable).length > 0) {
      return this.transaction(() => this.create(records));
    }

    this.validateForeignKeys(
      this.currentTable,
      records as Record<string, any>[],
    );
    const existing = this.recordsFor(this.currentTable);
    const command = new CreateCommand(
      this.gateway,
      this.currentTable,
      this.cache,
      this.utilities,
      records as Record<string, any>[],
    );

    if (this.commandBuffer.isActive()) {
      const created = command.preview(existing);
      this.commandBuffer.add(command);
      return created as CurrentRecord<T, N>[];
    }
    return command.execute(existing) as CurrentRecord<T, N>[];
  }

  update(records: CurrentRecord<T, N>[]): CurrentRecord<T, N>[] {
    if (!this.commandBuffer.isActive() && getOutgoingRelations(this.currentTable).length > 0) {
      return this.transaction(() => this.update(records));
    }

    this.validateForeignKeys(
      this.currentTable,
      records as Record<string, any>[],
    );
    const existing = this.recordsFor(this.currentTable);
    return this.executeUpdate(
      this.currentTable,
      records as Record<string, any>[],
      existing,
    ) as CurrentRecord<T, N>[];
  }

  upsert(records: Partial<CurrentRecord<T, N>>[]): CurrentRecord<T, N>[] {
    if (!this.commandBuffer.isActive() && getOutgoingRelations(this.currentTable).length > 0) {
      return this.transaction(() => this.upsert(records));
    }

    this.validateForeignKeys(
      this.currentTable,
      records as Record<string, any>[],
    );
    const existing = this.recordsFor(this.currentTable);
    const primaryKey = this.currentTable.primaryKey as string;
    const result = new Array<CurrentRecord<T, N>>(records.length);
    const createRecords: Record<string, any>[] = [];
    const createIndexes: number[] = [];
    const updateRecords: Record<string, any>[] = [];
    const updateIndexes: number[] = [];

    records.forEach((record, index) => {
      const rawRecord = { ...record } as Record<string, any>;
      const pk = rawRecord[primaryKey];
      const hasPk =
        pk !== null &&
        pk !== undefined &&
        !(typeof pk === "string" && pk.trim() === "");
      if (hasPk && existing.getRecord(pk)) {
        updateRecords.push(rawRecord);
        updateIndexes.push(index);
      } else {
        createRecords.push(rawRecord);
        createIndexes.push(index);
      }
    });

    if (updateRecords.length > 0) {
      const updated = this.executeUpdate(
        this.currentTable,
        updateRecords,
        existing,
      );
      updated.forEach((record, index) => {
        result[updateIndexes[index]] = record as CurrentRecord<T, N>;
      });
    }

    if (createRecords.length > 0) {
      const command = new CreateCommand(
        this.gateway,
        this.currentTable,
        this.cache,
        this.utilities,
        createRecords,
      );
      const created = this.commandBuffer.isActive()
        ? command.preview(existing)
        : command.execute(existing);
      if (this.commandBuffer.isActive()) this.commandBuffer.add(command);
      created.forEach((record, index) => {
        result[createIndexes[index]] = record as CurrentRecord<T, N>;
      });
    }

    return result;
  }

  delete(primaryKeyValues: unknown[]): boolean {
    if (!this.commandBuffer.isActive() && getIncomingRelations(this.currentTable).length > 0) {
      return this.transaction(() => this.delete(primaryKeyValues));
    }

    this.deleteRecords(
      this.currentTable,
      primaryKeyValues,
      new Set<string>(),
    );
    return true;
  }

  find(): CurrentRecord<T, N>[];
  find<U extends T[number]["name"]>(
    query: SheetQuery<T, TableByName<T, U>["schema"], U>,
  ): CurrentRecord<T, U>[];
  find(query?: SheetQuery<T, any, any>): Record<string, any>[] {
    const queryTableName = query?.getTableName();
    const table = queryTableName
      ? this.tables.find((candidate) => candidate.name === queryTableName)
      : this.currentTable;
    if (!table) throw new Error(`Table '${queryTableName}' not found.`);

    const records = this.recordsFor(table)
      .getValues()
      .map((record) => ({ ...record }));
    if (!query) return records;
    return query.cut(query.shift(query.sort(query.filter(records))));
  }

  transaction<R>(fn: () => R): R {
    this.commandBuffer.begin();
    try {
      const result = fn();
      this.commandBuffer.commit();
      return result;
    } catch (error) {
      if (this.commandBuffer.isActive()) this.commandBuffer.abort();
      throw error;
    }
  }

  private validateForeignKeys(
    table: SheetTable<string, any>,
    records: Record<string, any>[],
  ): void {
    for (const relation of getOutgoingRelations(table)) {
      const parentRecords = this.recordsFor(relation.parentTable).getValues();
      for (const record of records) {
        const value = record[relation.childKey];
        if (value === null || value === undefined) continue;

        const exists = parentRecords.some(
          (parent) => parent[relation.parentKey] === value,
        );
        if (!exists) {
          throw new Error(
            `Foreign key violation: ${relation.childTable.name}.${relation.childKey}=${String(value)} references ${relation.parentTable.name}.${relation.parentKey}`,
          );
        }
      }
    }
  }

  private deleteRecords(
    table: SheetTable<string, any>,
    primaryKeyValues: unknown[],
    visited: Set<string>,
  ): void {
    const visitKey = `${table.dbId}:${table.name}:${JSON.stringify(primaryKeyValues)}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const existing = this.recordsFor(table);
    const primaryKey = table.primaryKey as string;
    const targets = primaryKeyValues
      .map((value) => existing.getRecord(value))
      .filter((record): record is Record<string, any> => Boolean(record));

    for (const relation of getIncomingRelations(table)) {
      this.applyOnDelete(relation, targets, visited);
    }

    const command = new DeleteCommand(
      table,
      this.gateway,
      this.cache,
      this.utilities,
      primaryKeyValues,
    );
    if (this.commandBuffer.isActive()) {
      command.preview(existing);
      this.commandBuffer.add(command);
    } else {
      command.execute(existing);
    }
  }

  private applyOnDelete(
    relation: SheetRelation,
    parentRecords: Record<string, any>[],
    visited: Set<string>,
  ): void {
    if (parentRecords.length === 0) return;

    const parentValues = parentRecords.map(
      (record) => record[relation.parentKey],
    );
    const childRecords = this.recordsFor(relation.childTable);
    const affected = childRecords
      .getValues()
      .filter((record) => parentValues.includes(record[relation.childKey]));
    if (affected.length === 0) return;

    if (relation.onDelete === "restrict") {
      throw new Error(
        `Delete restricted: ${relation.parentTable.name}.${relation.parentKey} is referenced by ${relation.childTable.name}.${relation.childKey}`,
      );
    }

    if (relation.onDelete === "cascade") {
      const childPrimaryKey = relation.childTable.primaryKey as string;
      this.deleteRecords(
        relation.childTable,
        affected.map((record) => record[childPrimaryKey]),
        visited,
      );
      return;
    }

    const updates = affected.map((record) => ({
      ...record,
      [relation.childKey]: null,
    }));
    this.validateForeignKeys(relation.childTable, updates);
    this.executeUpdate(relation.childTable, updates, childRecords);
  }

  private executeUpdate(
    table: SheetTable<string, any>,
    records: Record<string, any>[],
    existing: SheetRecords,
  ): Record<string, any>[] {
    const command = new UpdateCommand(
      table,
      this.gateway,
      this.cache,
      this.utilities,
      records,
    );
    const updated = this.commandBuffer.isActive()
      ? command.preview(existing)
      : command.execute(existing);
    if (this.commandBuffer.isActive()) this.commandBuffer.add(command);
    return updated;
  }

  private recordsFor(table: SheetTable<string, any>): SheetRecords {
    if (this.commandBuffer.isActive()) return this.commandBuffer.records(table);
    this.gateway.table(table.name, table.dbId);
    return new SheetRecords(this.gateway.read(), table.primaryKey as string);
  }
}
