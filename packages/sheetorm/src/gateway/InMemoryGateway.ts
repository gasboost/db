import { SheetRecords } from "../core/SheetRecords";
import { Stockable } from "../storage/InMemoryDataStore";
import { AccessableDataStore, DataStoreTable } from "./AccessableDataStore";

export class InMemoryGateway implements AccessableDataStore {
  constructor(private dataStore: Stockable) {}

  private _table!: `${string}:${string}`;

  table(sheet: string, dbId: string): void {
    this._table = `${dbId}:${sheet}`;
  }

  read(): Record<string, any>[] {
    const { headers, rows } = this.dataStore.get(this._table);

    return structuredClone(
      rows.map((row) =>
        Object.fromEntries(
          headers.map((column, index) => [column, row[index]]),
        ),
      ),
    );
  }

  readMany(
    tables: readonly DataStoreTable[],
  ): Map<string, Record<string, any>[]> {
    const result = new Map<string, Record<string, any>[]>();

    for (const table of tables) {
      const key = `${table.dbId}:${table.sheetName}` as `${string}:${string}`;

      const { headers, rows } = this.dataStore.get(key);

      result.set(
        key,
        structuredClone(
          rows.map((row) =>
            Object.fromEntries(
              headers.map((column, index) => [column, row[index]]),
            ),
          ),
        ),
      );
    }

    return result;
  }

  insert(rows: Record<string, any>[]): void {
    if (rows.length === 0) {
      return;
    }

    const { headers, rows: existingRows } = this.dataStore.get(this._table);

    const appended = rows.map((record) =>
      headers.map((column) => record[column]),
    );

    this.dataStore.set(this._table, [headers, ...existingRows, ...appended]);
  }

  update(
    records: Record<string, any>[],
    currentRecords: SheetRecords,
    primaryKey: string,
  ): void {
    if (records.length === 0) {
      return;
    }

    const { headers, rows } = this.dataStore.get(this._table);

    const nextRows = rows.map((row) => [...row]);

    for (const record of records) {
      const primaryKeyValue = record[primaryKey];

      const rowNumber = currentRecords.getRowNumber(primaryKeyValue);

      if (rowNumber === null) {
        throw new Error(
          `Record with primary key '${String(primaryKeyValue)}' not found.`,
        );
      }

      const rowIndex = rowNumber - 2;

      nextRows[rowIndex] = headers.map((column) => record[column]);
    }

    this.dataStore.set(this._table, [headers, ...nextRows]);
  }

  delete(
    primaryKeyValues: readonly unknown[],
    currentRecords: SheetRecords,
    _primaryKey: string,
  ): void {
    if (primaryKeyValues.length === 0) {
      return;
    }

    const { headers, rows } = this.dataStore.get(this._table);

    const deletedIndexes = new Set(
      primaryKeyValues
        .map((primaryKeyValue) => currentRecords.getRowNumber(primaryKeyValue))
        .filter((rowNumber): rowNumber is number => rowNumber !== null)
        .map((rowNumber) => rowNumber - 2),
    );

    const nextRows = rows.filter((_, index) => !deletedIndexes.has(index));

    this.dataStore.set(this._table, [headers, ...nextRows]);
  }

  rewrite(
    rows: Record<string, any>[],
    _previousRecords?: Record<string, any>[],
  ): void {
    const { headers } = this.dataStore.get(this._table);

    const dataValues = rows.map((record) =>
      headers.map((column) => record[column]),
    );

    this.dataStore.set(this._table, [headers, ...dataValues]);
  }

  setColumns(dbId: string, sheetName: string, columns: string[]): void {
    this.table(sheetName, dbId);

    const { rows } = this.dataStore.get(this._table);

    this.dataStore.set(this._table, [columns, ...rows]);
  }

  count(): number {
    const { rows } = this.dataStore.get(this._table);

    return rows.length;
  }

  lastId(primaryKey: string): number {
    const { headers, rows } = this.dataStore.get(this._table);

    const primaryKeyIndex = headers.indexOf(primaryKey);

    if (primaryKeyIndex === -1) {
      throw new Error(`Primary key column ${primaryKey} not found`);
    }

    if (rows.length === 0) {
      return 0;
    }

    const lastId = rows.at(-1)?.[primaryKeyIndex];

    if (typeof lastId !== "number") {
      throw new Error("Last ID is not a number");
    }

    return lastId;
  }

  protect(): void {
    // No-op for in-memory gateway.
  }
}
