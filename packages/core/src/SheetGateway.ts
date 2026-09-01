import { AccessableDataStore } from "./AccessableDataStore";

export class SheetGateway implements AccessableDataStore {
  private _table!: GoogleAppsScript.Spreadsheet.Sheet;

  constructor(
    private dataStore: GoogleAppsScript.Spreadsheet.SpreadsheetApp,
    private spreadsheets: Map<
      string,
      GoogleAppsScript.Spreadsheet.Spreadsheet
    > = new Map(),
    private sheets: Map<string, GoogleAppsScript.Spreadsheet.Sheet> = new Map(),
  ) {}

  public table(tableName: string, ssId: string | null) {
    let ss: GoogleAppsScript.Spreadsheet.Spreadsheet;
    let activeSsId = ssId;
    if (!ssId) {
      try {
        ss = this.dataStore.getActive();
        activeSsId = ss.getId();
        this.spreadsheets.set(activeSsId, ss);
      } catch {
        throw new Error(`Active spreadsheet not found`);
      }
    } else if (!this.spreadsheets.has(ssId)) {
      try {
        ss = this.dataStore.openById(ssId);
        this.spreadsheets.set(ssId, ss);
      } catch {
        throw new Error(`Spreadsheet with ID ${ssId} not found`);
      }
    } else {
      ss = this.spreadsheets.get(ssId)!;
    }

    // シートを取得
    if (!this.sheets.has(`${activeSsId || ssId}:${tableName}`)) {
      const sheet = ss.getSheetByName(tableName);
      if (!sheet) {
        throw new Error(
          `Sheet ${tableName} not found in spreadsheet ${ss.getName()}`,
        );
      }
      this.sheets.set(`${activeSsId || ssId}:${tableName}`, sheet);
      this._table = sheet;
    }
    this._table = this.sheets.get(`${activeSsId || ssId}:${tableName}`)!;
  }

  public lastId(pkColumn: string): any {
    const lastRow = this._table.getLastRow();
    if (lastRow < 2) {
      return 0;
    }
    const pkColumnIndex =
      this._table
        .getRange(1, 1, 1, this._table.getLastColumn())
        .getValues()[0]
        .indexOf(pkColumn) + 1;
    if (pkColumnIndex === 0) {
      throw new Error(`Primary key column ${pkColumn} not found`);
    }
    const lastId = this._table.getRange(lastRow, pkColumnIndex).getValue();
    if (typeof lastId !== "number") throw new Error(`Last ID is not a number`);
    return lastId;
  }

  read(): Record<string, any>[] {
    const lastRow = this._table.getLastRow();
    if (lastRow < 2) return [];
    const lastColumn = this._table.getLastColumn();
    const values = this._table
      .getRange(2, 1, lastRow - 1, lastColumn)
      .getValues();
    const columns = this._table.getRange(1, 1, 1, lastColumn).getValues()[0];
    return values.map((row) => {
      const record: Record<string, any> = {};
      columns.forEach((col, index) => {
        record[col] = row[index];
      });
      return record;
    });
  }

  insert(data: Record<string, any>[]): void {
    if (data.length === 0) return;
    const startRow = this._table.getLastRow() + 1;
    const columns = this._table.getLastColumn();
    if (columns === 0) throw new Error("Not set table columns yet.");
    const headers = this._table.getRange(1, 1, 1, columns).getValues()[0];
    const dataValues = data.map((record) => headers.map((col) => record[col]));
    this._table
      .getRange(startRow, 1, data.length, columns)
      .setValues(dataValues);
    this.dataStore.flush();
  }

  rewrite(
    data: Record<string, any>[],
    previousRecords?: Record<string, any>[],
  ): void {
    const lastRow = this._table.getLastRow();
    if (lastRow <= 1) return;
    const lastColumn = this._table.getLastColumn();
    let headers: any[] | null = null;
    const getHeaders = () => {
      if (!headers) {
        if (lastColumn === 0) {
          throw new Error("Not set table columns yet.");
        }
        headers = this._table.getRange(1, 1, 1, lastColumn).getValues()[0];
      }
      return headers;
    };

    const previousValues = previousRecords
      ? previousRecords.map((record) => getHeaders().map((col) => record[col]))
      : this._table.getRange(2, 1, lastRow - 1, lastColumn).getValues();
    try {
      this._table.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
      if (data.length === 0) return;
      const dataValues = data.map((record) =>
        getHeaders().map((col) => record[col]),
      );
      this._table.getRange(2, 1, data.length, lastColumn).setValues(dataValues);
      this.dataStore.flush();
    } catch (e) {
      if (previousValues.length > 0) {
        this._table
          .getRange(2, 1, previousValues.length, lastColumn)
          .setValues(previousValues);
      }
      throw e;
    }
  }

  setColumns(dbId: string, sheetName: string, columns: string[]): void {
    const ss = this.dataStore.openById(dbId);
    const table = ss.getSheetByName(sheetName);
    if (!table) {
      this._table = ss.insertSheet(sheetName);
    } else {
      this._table = table;
    }
    const lastColumn = this._table.getLastColumn();
    if (lastColumn > 0) {
      this._table.getRange(1, 1, 1, lastColumn).clearContent();
    }
    this._table.getRange(1, 1, 1, columns.length).setValues([columns]);
  }

  count() {
    const lastRow = this._table.getLastRow();
    return lastRow > 1 ? lastRow - 1 : 0;
  }

  protect(): void {
    this._table.protect().setDescription("Protected by SheetGateway");
  }
}
