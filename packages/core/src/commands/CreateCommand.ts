import { AccessableDataStore } from "../AccessableDataStore";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";
import { WriteCommand } from "./WriteCommand";

export class CreateCommand extends WriteCommand {
  private readonly diff: Record<string, any>[];

  constructor(
    gateway: AccessableDataStore,
    table: SheetTable<string, any>,
    records: Record<string, any>[],
  ) {
    super(gateway, table);
    this.diff = records.map((record) => ({ ...record }));
  }

  execute(records: SheetRecords): Record<string, any>[] {
    this.gateway.table(this.table.name, this.table.dbId);

    this.diff.forEach((record) => {
      this.table.validate(record);
      records.replace(record);
    });

    this.gateway.insert(this.diff);
    return this.getDiff();
  }

  getDiff(): Record<string, any>[] {
    return this.diff.map((record) => ({ ...record }));
  }
}
