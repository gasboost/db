import { AccessableDataStore } from "../AccessableDataStore";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";
import { WriteCommand } from "./WriteCommand";

export class DeleteCommand extends WriteCommand {
  constructor(
    table: SheetTable<string, any>,
    gateway: AccessableDataStore,
    private readonly primaryKeys: unknown[],
  ) {
    super(gateway, table);
  }

  execute(records: SheetRecords): void {
    this.gateway.table(this.table.name, this.table.dbId);
    const previousRecords = records.getValues();
    this.primaryKeys.forEach((primaryKey) => records.remove(primaryKey));
    this.gateway.rewrite(records.getValues(), previousRecords);
  }
}
