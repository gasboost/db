import { AccessableDataStore } from "../AccessableDataStore";
import { CacheLike, UtilitiesLike } from "../RuntimeTypes";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";
import { WriteCommand } from "./WriteCommand";

export class UpdateCommand extends WriteCommand {
  private prepared: Record<string, any>[] | null = null;

  constructor(
    table: SheetTable<string, any>,
    gateway: AccessableDataStore,
    cache: CacheLike,
    utilities: UtilitiesLike,
    private readonly updates: Record<string, any>[],
  ) {
    super(gateway, table, cache, utilities);
  }

  preview(records: SheetRecords): Record<string, any>[] {
    const primaryKey = this.table.primaryKey as string;
    const updatedRecords = (this.prepared ?? this.updates).map((record) => ({ ...record }));

    updatedRecords.forEach((record) => {
      const previous = records.getRecord(record[primaryKey]);
      if (!previous) {
        throw new Error(`Record with primary key ${record[primaryKey]} does not exist for update.`);
      }

      if (!this.prepared && this.table.hasOptimisticLock()) {
        const versionColumn = this.table.versionColumn as string;
        if (record[versionColumn] !== previous[versionColumn]) {
          throw new Error(
            `Optimistic lock error: expected version ${previous[versionColumn]} but got ${record[versionColumn]}`,
          );
        }
        record[versionColumn] = previous[versionColumn] + 1;
      }

      this.table.validate(record);
      this.validateUnique(record, records, true);
      records.replace({ ...record });
    });

    if (!this.prepared) this.prepared = updatedRecords.map((record) => ({ ...record }));
    return updatedRecords;
  }

  execute(records: SheetRecords): Record<string, any>[] {
    this.gateway.table(this.table.name, this.table.dbId);
    this.table.lock(this.cache, this.utilities);
    try {
      const previousRecords = records.getValues().map((record) => ({ ...record }));
      const updated = this.preview(records);
      this.gateway.rewrite(records.getValues(), previousRecords);
      return updated;
    } finally {
      this.table.releaseLock();
    }
  }
}
