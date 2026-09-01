import { AccessableDataStore } from "../AccessableDataStore";
import { SheetRecords } from "../SheetRecords";
import { SheetTable } from "../SheetTable";

export abstract class WriteCommand {
  constructor(
    protected readonly gateway: AccessableDataStore,
    protected readonly table: SheetTable<string, any>,
  ) {}

  abstract execute(records: SheetRecords): unknown;
}
