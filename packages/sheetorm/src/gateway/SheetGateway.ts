import { SheetRecords } from "../core/SheetRecords";
import { AccessableDataStore, DataStoreTable } from "./AccessableDataStore";

type SheetProperties = {
  sheetId: number;
  title: string;
};

export class SheetGateway implements AccessableDataStore {
  private spreadsheetId!: string;
  private sheetName!: string;

  private readonly sheetProperties = new Map<string, SheetProperties>();
  private readonly headers = new Map<string, string[]>();

  constructor(private readonly sheets: GoogleAppsScript.Sheets) {}

  public table(sheetName: string, dbId: string): void {
    this.spreadsheetId = dbId;
    this.sheetName = sheetName;
  }

  public read(): Record<string, any>[] {
    const response = this.sheets.Spreadsheets.Values.batchGet(
      this.spreadsheetId,
      {
        ranges: [this.tableRange(this.sheetName)],
        valueRenderOption: "UNFORMATTED_VALUE",
      },
    );

    const values = response.valueRanges?.[0]?.values ?? [];

    return this.toRecords(values, this.tableKey());
  }

  public readMany(
    tables: readonly DataStoreTable[],
  ): Map<string, Record<string, any>[]> {
    const result = new Map<string, Record<string, any>[]>();

    const grouped = new Map<string, DataStoreTable[]>();

    for (const table of tables) {
      const current = grouped.get(table.dbId) ?? [];

      current.push(table);

      grouped.set(table.dbId, current);
    }

    for (const [dbId, dbTables] of grouped.entries()) {
      const response = this.sheets.Spreadsheets.Values.batchGet(dbId, {
        ranges: dbTables.map((table) => this.tableRange(table.sheetName)),
        valueRenderOption: "UNFORMATTED_VALUE",
      });

      const valueRanges = response.valueRanges ?? [];

      dbTables.forEach((table, index) => {
        const key = this.tableKey(dbId, table.sheetName);
        const values = valueRanges[index]?.values ?? [];

        result.set(key, this.toRecords(values, key));
      });
    }

    return result;
  }

  public insert(records: Record<string, any>[]): void {
    if (records.length === 0) {
      return;
    }

    const headers = this.getHeaders();

    if (headers.length === 0) {
      throw new Error("Not set table columns yet.");
    }

    const lastColumn = this.columnName(headers.length);

    this.sheets.Spreadsheets.Values.append(
      {
        values: records.map((record) =>
          headers.map((header) => this.toSheetValue(record[header])),
        ),
      },
      this.spreadsheetId,
      `${this.quotedSheetName()}!A1:${lastColumn}`,
      {
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
      },
    );
  }

  public update(
    records: Record<string, any>[],
    currentRecords: SheetRecords,
    primaryKey: string,
  ): void {
    if (records.length === 0) {
      return;
    }

    const headers = this.getHeaders();

    if (headers.length === 0) {
      throw new Error("Not set table columns yet.");
    }

    const lastColumn = this.columnName(headers.length);

    const data = records.map((record) => {
      const primaryKeyValue = record[primaryKey];

      let rowNumber = currentRecords.getRowNumber(primaryKeyValue);

      if (rowNumber === null) {
        rowNumber = this.findRowNumber(primaryKey, primaryKeyValue);
      }

      if (rowNumber === null) {
        throw new Error(
          `Record with primary key '${String(primaryKeyValue)}' not found.`,
        );
      }

      return {
        range: `${this.quotedSheetName()}!A${rowNumber}:${lastColumn}${rowNumber}`,
        values: [headers.map((header) => this.toSheetValue(record[header]))],
      };
    });

    this.sheets.Spreadsheets.Values.batchUpdate(
      {
        valueInputOption: "RAW",
        data,
      },
      this.spreadsheetId,
    );
  }

  public delete(
    primaryKeyValues: readonly unknown[],
    currentRecords: SheetRecords,
    primaryKey: string,
  ): void {
    if (primaryKeyValues.length === 0) {
      return;
    }

    const properties = this.getSheetProperties(
      this.spreadsheetId,
      this.sheetName,
    );

    const rowNumbers = primaryKeyValues
      .map((primaryKeyValue) => {
        const knownRowNumber = currentRecords.getRowNumber(primaryKeyValue);

        if (knownRowNumber !== null) {
          return knownRowNumber;
        }

        return this.findRowNumber(primaryKey, primaryKeyValue);
      })
      .filter((rowNumber): rowNumber is number => rowNumber !== null)
      .sort((left, right) => right - left);

    if (rowNumbers.length === 0) {
      return;
    }

    this.sheets.Spreadsheets.batchUpdate(
      {
        requests: rowNumbers.map((rowNumber) => ({
          deleteDimension: {
            range: {
              sheetId: properties.sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        })),
      },
      this.spreadsheetId,
    );
  }

  public rewrite(
    records: Record<string, any>[],
    previousRecords?: Record<string, any>[],
  ): void {
    const headers = this.getHeaders();

    if (headers.length === 0) {
      throw new Error("Not set table columns yet.");
    }

    const lastColumn = this.columnName(headers.length);
    const bodyRange = `${this.quotedSheetName()}!A2:${lastColumn}`;

    const previous = previousRecords ?? this.read();

    try {
      this.sheets.Spreadsheets.Values.batchClear(
        {
          ranges: [bodyRange],
        },
        this.spreadsheetId,
      );

      if (records.length === 0) {
        return;
      }

      this.sheets.Spreadsheets.Values.update(
        {
          values: records.map((record) =>
            headers.map((header) => this.toSheetValue(record[header])),
          ),
        },
        this.spreadsheetId,
        `${this.quotedSheetName()}!A2:${lastColumn}${records.length + 1}`,
        {
          valueInputOption: "RAW",
        },
      );
    } catch (error) {
      this.sheets.Spreadsheets.Values.batchClear(
        {
          ranges: [bodyRange],
        },
        this.spreadsheetId,
      );

      if (previous.length > 0) {
        this.sheets.Spreadsheets.Values.update(
          {
            values: previous.map((record) =>
              headers.map((header) => this.toSheetValue(record[header])),
            ),
          },
          this.spreadsheetId,
          `${this.quotedSheetName()}!A2:${lastColumn}${previous.length + 1}`,
          {
            valueInputOption: "RAW",
          },
        );
      }

      throw error;
    }
  }

  public setColumns(dbId: string, sheetName: string, columns: string[]): void {
    let properties = this.findSheetProperties(dbId, sheetName);

    if (properties === null) {
      const response = this.sheets.Spreadsheets.batchUpdate(
        {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
        dbId,
      );

      const sheetId = response.replies?.[0]?.addSheet?.properties?.sheetId;

      if (sheetId === undefined || sheetId === null) {
        throw new Error(
          `Failed to create sheet '${sheetName}' in spreadsheet '${dbId}'.`,
        );
      }

      properties = {
        sheetId,
        title: sheetName,
      };

      this.sheetProperties.set(this.tableKey(dbId, sheetName), properties);
    }

    const key = this.tableKey(dbId, sheetName);

    this.sheets.Spreadsheets.Values.batchClear(
      {
        ranges: [`${this.quotedSheetName(sheetName)}!1:1`],
      },
      dbId,
    );

    if (columns.length > 0) {
      const lastColumn = this.columnName(columns.length);

      this.sheets.Spreadsheets.Values.update(
        {
          values: [columns],
        },
        dbId,
        `${this.quotedSheetName(sheetName)}!A1:${lastColumn}1`,
        {
          valueInputOption: "RAW",
        },
      );
    }

    this.headers.set(key, [...columns]);
  }

  public count(): number {
    return this.read().length;
  }

  public lastId(primaryKey: string): number {
    const records = this.read();

    if (records.length === 0) {
      return 0;
    }

    const lastId = records.at(-1)?.[primaryKey];

    if (typeof lastId !== "number") {
      throw new Error("Last ID is not a number");
    }

    return lastId;
  }

  public protect(): void {
    const spreadsheet = this.sheets.Spreadsheets.get(this.spreadsheetId, {
      fields:
        "sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description,range))",
    });

    const sheet = spreadsheet.sheets?.find(
      (candidate) => candidate.properties?.title === this.sheetName,
    );

    if (!sheet) {
      throw new Error(
        `Sheet ${this.sheetName} not found in spreadsheet ${this.spreadsheetId}`,
      );
    }

    const sheetId = sheet.properties?.sheetId;

    if (sheetId === undefined || sheetId === null) {
      throw new Error(`Sheet ${this.sheetName} has no sheetId`);
    }
    const exists =
      sheet.protectedRanges?.some(
        (protectedRange) =>
          protectedRange.description === "Protected by SheetGateway" &&
          protectedRange.range?.sheetId === sheetId,
      ) ?? false;

    if (exists) {
      return;
    }

    this.sheets.Spreadsheets.batchUpdate(
      {
        requests: [
          {
            addProtectedRange: {
              protectedRange: {
                range: {
                  sheetId,
                },
                description: "Protected by SheetGateway",
              },
            },
          },
        ],
      },
      this.spreadsheetId,
    );
  }

  private toRecords(values: any[][], key: string): Record<string, any>[] {
    if (values.length === 0) {
      this.headers.set(key, []);

      return [];
    }

    const headers = (values[0] ?? []).map((value) => String(value));

    this.headers.set(key, headers);

    if (headers.length === 0) {
      return [];
    }

    return values.slice(1).map((row) => {
      const record: Record<string, any> = {};

      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });

      return record;
    });
  }

  private getHeaders(): string[] {
    const key = this.tableKey();

    const cached = this.headers.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const response = this.sheets.Spreadsheets.Values.get(
      this.spreadsheetId,
      `${this.quotedSheetName()}!1:1`,
      {
        valueRenderOption: "UNFORMATTED_VALUE",
      },
    );

    const headers = response.values?.[0]?.map((value) => String(value)) ?? [];

    this.headers.set(key, headers);

    return headers;
  }

  private findRowNumber(
    primaryKey: string,
    primaryKeyValue: unknown,
  ): number | null {
    const headers = this.getHeaders();

    const columnIndex = headers.indexOf(primaryKey);

    if (columnIndex === -1) {
      throw new Error(`Primary key column ${primaryKey} not found`);
    }

    const column = this.columnName(columnIndex + 1);

    const response = this.sheets.Spreadsheets.Values.get(
      this.spreadsheetId,
      `${this.quotedSheetName()}!${column}2:${column}`,
      {
        valueRenderOption: "UNFORMATTED_VALUE",
      },
    );

    const values = response.values ?? [];

    const index = values.findIndex((row) => row[0] === primaryKeyValue);

    return index === -1 ? null : index + 2;
  }

  private getSheetProperties(dbId: string, sheetName: string): SheetProperties {
    const cached = this.sheetProperties.get(this.tableKey(dbId, sheetName));

    if (cached !== undefined) {
      return cached;
    }

    const properties = this.findSheetProperties(dbId, sheetName);

    if (properties === null) {
      throw new Error(`Sheet ${sheetName} not found in spreadsheet ${dbId}`);
    }

    return properties;
  }

  private findSheetProperties(
    dbId: string,
    sheetName: string,
  ): SheetProperties | null {
    const cached = this.sheetProperties.get(this.tableKey(dbId, sheetName));

    if (cached !== undefined) {
      return cached;
    }

    const spreadsheet = this.sheets.Spreadsheets.get(dbId, {
      fields: "sheets.properties(sheetId,title)",
    });

    const sheet = spreadsheet.sheets?.find(
      (candidate) => candidate.properties?.title === sheetName,
    );

    const sheetId = sheet?.properties?.sheetId;
    const title = sheet?.properties?.title;

    if (
      sheetId === undefined ||
      sheetId === null ||
      title === undefined ||
      title === null
    ) {
      return null;
    }

    const properties = {
      sheetId,
      title,
    };

    this.sheetProperties.set(this.tableKey(dbId, sheetName), properties);

    return properties;
  }

  private tableRange(sheetName: string): string {
    return `${this.quotedSheetName(sheetName)}!A:ZZZ`;
  }

  private quotedSheetName(sheetName = this.sheetName): string {
    return `'${sheetName.replace(/'/g, "''")}'`;
  }

  private tableKey(
    dbId = this.spreadsheetId,
    sheetName = this.sheetName,
  ): string {
    return `${dbId}:${sheetName}`;
  }

  private columnName(column: number): string {
    let current = column;
    let result = "";

    while (current > 0) {
      const remainder = (current - 1) % 26;

      result = String.fromCharCode(65 + remainder) + result;

      current = Math.floor((current - 1) / 26);
    }

    return result;
  }

  private toSheetValue(value: unknown): unknown {
    return value ?? "";
  }
}
