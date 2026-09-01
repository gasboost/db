import { z } from "zod";
import { AccessableDataStore } from "./AccessableDataStore";
import { CommandBuffer } from "./CommandBuffer";
import { CreateCommand } from "./commands/CreateCommand";
import { DeleteCommand } from "./commands/DeleteCommand";
import { UpdateCommand } from "./commands/UpdateCommand";
import { SheetQuery, TableByName } from "./query/SheetQuery";
import { CacheLike, CacheServiceLike, UtilitiesLike } from "./RuntimeTypes";
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
    this.commandBuffer = commandBuffer ?? new CommandBuffer(gateway);
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
    const existing = this.recordsFor(this.currentTable);
    const command = new UpdateCommand(
      this.currentTable,
      this.gateway,
      this.cache,
      this.utilities,
      records as Record<string, any>[],
    );

    if (this.commandBuffer.isActive()) {
      const updated = command.preview(existing);
      this.commandBuffer.add(command);
      return updated as CurrentRecord<T, N>[];
    }
    return command.execute(existing) as CurrentRecord<T, N>[];
  }

  upsert(records: Partial<CurrentRecord<T, N>>[]): CurrentRecord<T, N>[] {
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
      const hasPk = pk !== null && pk !== undefined && !(typeof pk === "string" && pk.trim() === "");
      if (hasPk && existing.getRecord(pk)) {
        updateRecords.push(rawRecord);
        updateIndexes.push(index);
      } else {
        createRecords.push(rawRecord);
        createIndexes.push(index);
      }
    });

    if (updateRecords.length > 0) {
      const command = new UpdateCommand(
        this.currentTable,
        this.gateway,
        this.cache,
        this.utilities,
        updateRecords,
      );
      const updated = this.commandBuffer.isActive()
        ? command.preview(existing)
        : command.execute(existing);
      if (this.commandBuffer.isActive()) this.commandBuffer.add(command);
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
    const existing = this.recordsFor(this.currentTable);
    const command = new DeleteCommand(
      this.currentTable,
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

    const records = this.recordsFor(table).getValues().map((record) => ({ ...record }));
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

  private recordsFor(table: SheetTable<string, any>): SheetRecords {
    if (this.commandBuffer.isActive()) return this.commandBuffer.records(table);
    this.gateway.table(table.name, table.dbId);
    return new SheetRecords(this.gateway.read(), table.primaryKey as string);
  }
}
