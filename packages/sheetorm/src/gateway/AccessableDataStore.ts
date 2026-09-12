import { SheetRecords } from "../core/SheetRecords";

export type DataStoreTable = {
  dbId: string;
  sheetName: string;
};

export interface AccessableDataStore {
  table(sheetName: string, dbId: string): void;

  read(): Record<string, any>[];

  readMany(
    tables: readonly DataStoreTable[],
  ): Map<string, Record<string, any>[]>;

  insert(records: Record<string, any>[]): void;

  update(
    records: Record<string, any>[],
    currentRecords: SheetRecords,
    primaryKey: string,
  ): void;

  delete(
    primaryKeyValues: readonly unknown[],
    currentRecords: SheetRecords,
    primaryKey: string,
  ): void;

  rewrite(
    records: Record<string, any>[],
    previousRecords?: Record<string, any>[],
  ): void;

  setColumns(dbId: string, sheetName: string, columns: string[]): void;

  count(): number;

  lastId(primaryKey: string): number;

  protect(): void;
}
