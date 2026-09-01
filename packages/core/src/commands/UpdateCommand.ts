import { AccessableDataStore } from "../AccessableDataStore";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";
import { WriteCommand } from "./WriteCommand";

export class UpdateCommand extends WriteCommand {
  constructor(
    table: SheetTable<string, any>,
    gateway: AccessableDataStore,
    private readonly updates: Record<string, any>[],
  ) {
    super(gateway, table);
  }

  preview(records: SheetRecords): Record<string, any>[] {
    const updatedRecords = this.updates.map((record) => ({ ...record }));

    updatedRecords.forEach((record) => {
      this.table.validate(record);
      const primaryKey = record[this.table.primaryKey as string];
      if (!records.getRecord(primaryKey)) {
        throw new Error(
          `Record with primary key ${primaryKey} does not exist for update.`,
        );
      }
      records.replace(record);
    });

    return updatedRecords;
  }

  execute(records: SheetRecords): Record<string, any>[] {
    this.gateway.table(this.table.name, this.table.dbId);
    const previousRecords = records.getValues();
    const updatedRecords = this.preview(records);
    this.gateway.rewrite(records.getValues(), previousRecords);
    return updatedRecords;
  }
}
