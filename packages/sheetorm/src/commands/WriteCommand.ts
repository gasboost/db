import { SheetRecords } from "../core/SheetRecords";
import { SheetTable } from "../core/SheetTable";
import { AccessableDataStore } from "../gateway/AccessableDataStore";

export interface WriteAuthorization {
  ensureInsert(
    table: SheetTable<any, any>,
    records: readonly Record<string, unknown>[],
  ): void;

  ensureUpdate(
    table: SheetTable<any, any>,
    currentRecords: readonly Record<string, unknown>[],
    nextRecords: readonly Record<string, unknown>[],
  ): void;

  ensureDelete(
    table: SheetTable<any, any>,
    records: readonly Record<string, unknown>[],
  ): void;
}

export abstract class WriteCommand {
  protected Cache: GoogleAppsScript.Cache.Cache;

  constructor(
    protected gateway: AccessableDataStore,
    protected table: SheetTable<any, any>,
    protected CacheService: GoogleAppsScript.Cache.CacheService,
    protected Utilities: GoogleAppsScript.Utilities.Utilities,
    protected authorization: WriteAuthorization,
  ) {
    this.Cache = CacheService.getScriptCache();
  }

  abstract execute(exsist: SheetRecords): void;
}

export type RecordWithRelations<R> = R & {
  relations?: Record<string, Record<string, any>[]>;
};
