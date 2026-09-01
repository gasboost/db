import { AccessableDataStore } from "../AccessableDataStore";
import { CacheLike, UtilitiesLike } from "../RuntimeTypes";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";
import { WriteCommand } from "./WriteCommand";

export class CreateCommand extends WriteCommand {
  private readonly diff: Record<string, any>[];

  constructor(
    gateway: AccessableDataStore,
    table: SheetTable<string, any>,
    cache: CacheLike,
    utilities: UtilitiesLike,
    records: Record<string, any>[],
  ) {
    super(gateway, table, cache, utilities);
    this.diff = records.map((record) => ({ ...record }));

    if (!table.autoIncrement) return;

    const primaryKey = table.primaryKey as string;
    if (table.autoNumberingMode === "uuid") {
      this.diff.forEach((record) => {
        if (record[primaryKey] == null || record[primaryKey] === "") {
          record[primaryKey] = utilities.getUuid();
        }
      });
      return;
    }

    gateway.table(table.name, table.dbId);
    table.lock(cache, utilities);
    try {
      const cacheKey = `${table.dbId}:${table.name}:autoIncrement`;
      const cached = cache.get(cacheKey);
      let lastId: number;
      try {
        lastId = cached ? Number(JSON.parse(cached).value) : gateway.lastId(primaryKey);
      } catch {
        lastId = gateway.lastId(primaryKey);
      }
      if (!Number.isFinite(lastId)) lastId = 0;
      const missing = this.diff.filter(
        (record) => record[primaryKey] === null || record[primaryKey] === undefined || record[primaryKey] === "",
      );
      missing.forEach((record, index) => {
        record[primaryKey] = lastId + index + 1;
      });
      cache.put(
        cacheKey,
        JSON.stringify({ value: lastId + missing.length, token: utilities.getUuid() }),
        300,
      );
    } finally {
      table.releaseLock();
    }
  }

  preview(records: SheetRecords): Record<string, any>[] {
    const primaryKey = this.table.primaryKey as string;
    this.diff.forEach((record) => {
      this.table.validate(record);
      if (records.getRecord(record[primaryKey])) {
        throw new Error(`Primary key constraint violation: ${primaryKey}=${record[primaryKey]}`);
      }
      this.validateUnique(record, records);
      records.replace({ ...record });
    });
    return this.getDiff();
  }

  execute(records: SheetRecords): Record<string, any>[] {
    this.gateway.table(this.table.name, this.table.dbId);
    this.table.lock(this.cache, this.utilities);
    try {
      const created = this.preview(records);
      this.gateway.insert(created);
      return created;
    } finally {
      this.table.releaseLock();
    }
  }

  getDiff(): Record<string, any>[] {
    return this.diff.map((record) => ({ ...record }));
  }
}
