import { SheetRecords } from "../core/SheetRecords";
import { SheetTable } from "../core/SheetTable";
import { AccessableDataStore } from "../gateway/AccessableDataStore";

export abstract class WriteCommand {
  protected Cache: GoogleAppsScript.Cache.Cache;
  constructor(
    protected gateway: AccessableDataStore,
    protected table: SheetTable<any, any>,
    protected CacheService: GoogleAppsScript.Cache.CacheService,
    protected Utilities: GoogleAppsScript.Utilities.Utilities,
  ) {
    this.Cache = CacheService.getScriptCache();
  }
  abstract execute(exsist: SheetRecords): void;
}
