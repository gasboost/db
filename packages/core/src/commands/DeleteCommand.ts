import { AccessableDataStore } from "../AccessableDataStore";
import { CacheLike, UtilitiesLike } from "../RuntimeTypes";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";
import { WriteCommand } from "./WriteCommand";

export class DeleteCommand extends WriteCommand {
  constructor(
    table: SheetTable<string, any>,
    gateway: AccessableDataStore,
    cache: CacheLike,
    utilities: UtilitiesLike,
    private readonly primaryKeys: unknown[],
  ) {
    super(gateway, table, cache, utilities);
  }

  preview(records: SheetRecords): Record<string, any>[] {
    this.primaryKeys.forEach((primaryKey) => records.remove(primaryKey));
    return records.getValues();
  }

  execute(records: SheetRecords): Record<string, any>[] {
    this.gateway.table(this.table.name, this.table.dbId);
    this.table.lock(this.cache, this.utilities);
    try {
      const previousRecords = records.getValues().map((record) => ({ ...record }));
      const result = this.preview(records);
      this.gateway.rewrite(result, previousRecords);
      return result;
    } finally {
      this.table.releaseLock();
    }
  }
}
