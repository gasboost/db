import type { TableChange, KeyedTableDefinition } from "@gasboost/table";
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
  private changes: {
    definition: SheetTable<any, any>;
    change: TableChange<KeyedTableDefinition>;
  }[] = [];

  protected changed(
    table: SheetTable<any, any>,
    before: Record<string, any> | null,
    after: Record<string, any> | null,
  ): void {
    // The collector copies these immediately after successful command execution.
    this.changes.push({
      definition: table,
      change: {
        table: table.name,
        before,
        after,
      } as TableChange<KeyedTableDefinition>,
    });
  }

  public takeChanges(): {
    definition: SheetTable<any, any>;
    change: TableChange<KeyedTableDefinition>;
  }[] {
    const changes = this.changes;
    this.changes = [];
    return changes;
  }

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
