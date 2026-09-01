import { CacheLike, UtilitiesLike } from "../RuntimeTypes";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";
import { AccessableDataStore } from "../AccessableDataStore";

export abstract class WriteCommand {
  constructor(
    protected readonly gateway: AccessableDataStore,
    public readonly table: SheetTable<string, any>,
    protected readonly cache: CacheLike,
    protected readonly utilities: UtilitiesLike,
  ) {}

  protected validateUnique(
    record: Record<string, any>,
    records: SheetRecords,
    excludeCurrentRecord = false,
  ): void {
    const primaryKey = this.table.primaryKey as string;
    const uniqueValues = records.uniqueValues(this.table.getUniqueColumns());

    uniqueValues.forEach((values, columnName) => {
      if (excludeCurrentRecord) values.delete(record[primaryKey]);
      const value = record[columnName];
      if (value === null || value === undefined) return;
      if (typeof value === "string" && value.trim().length === 0) return;
      if (Array.from(values.values()).some((existing) => existing === value)) {
        throw new Error(`Unique constraint violation: ${columnName}=${value}`);
      }
    });
  }

  abstract preview(records: SheetRecords): Record<string, any>[];
  abstract execute(records: SheetRecords): Record<string, any>[];
}
