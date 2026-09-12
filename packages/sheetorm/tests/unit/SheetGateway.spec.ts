import { beforeEach, describe, expect, it, vi } from "vitest";
import { SheetRecords } from "../../src/core/SheetRecords";
import { SheetGateway } from "../../src/gateway/SheetGateway";

type SheetState = {
  sheetId: number;
  title: string;
  values: any[][];
  protectedRanges?: Array<{
    protectedRangeId?: number;
    description?: string;
    range?: {
      sheetId?: number;
    };
  }>;
};

type SpreadsheetState = {
  sheets: SheetState[];
};

function unquoteSheetName(value: string): string {
  const match = value.match(/^'((?:[^']|'')+)'!/);

  if (!match) {
    throw new Error(`Invalid range: ${value}`);
  }

  return match[1].replace(/''/g, "'");
}

function columnToNumber(column: string): number {
  let result = 0;

  for (const character of column) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }

  return result;
}

function parseStartCell(range: string): {
  row: number;
  column: number;
} {
  const a1 = range.split("!")[1];

  const match = a1.match(/^([A-Z]+)(\d+)/);

  if (!match) {
    return {
      row: 1,
      column: 1,
    };
  }

  return {
    column: columnToNumber(match[1]),
    row: Number(match[2]),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createSheetsService(initial: Record<string, SpreadsheetState>) {
  const spreadsheets = new Map<string, SpreadsheetState>(
    Object.entries(initial).map(([id, spreadsheet]) => [
      id,
      clone(spreadsheet),
    ]),
  );

  const getSpreadsheet = (spreadsheetId: string) => {
    const spreadsheet = spreadsheets.get(spreadsheetId);

    if (!spreadsheet) {
      throw new Error(`Spreadsheet ${spreadsheetId} not found`);
    }

    return spreadsheet;
  };

  const getSheet = (spreadsheetId: string, rangeOrName: string) => {
    const spreadsheet = getSpreadsheet(spreadsheetId);

    const sheetName = rangeOrName.includes("!")
      ? unquoteSheetName(rangeOrName)
      : rangeOrName;

    const sheet = spreadsheet.sheets.find(
      (candidate) => candidate.title === sheetName,
    );

    if (!sheet) {
      throw new Error(`Sheet ${sheetName} not found`);
    }

    return sheet;
  };

  const valuesGet = vi.fn(
    (spreadsheetId: string, range: string, _options?: unknown) => {
      const sheet = getSheet(spreadsheetId, range);

      const a1 = range.split("!")[1];

      if (a1 === "1:1") {
        return {
          values: sheet.values.length > 0 ? [clone(sheet.values[0])] : [],
        };
      }

      const columnMatch = a1.match(/^([A-Z]+)2:\1$/);

      if (columnMatch) {
        const columnIndex = columnToNumber(columnMatch[1]) - 1;

        return {
          values: sheet.values.slice(1).map((row) => [row[columnIndex]]),
        };
      }

      return {
        values: clone(sheet.values),
      };
    },
  );

  const batchGet = vi.fn(
    (
      spreadsheetId: string,
      options: {
        ranges: string[];
      },
    ) => {
      return {
        valueRanges: options.ranges.map((range) => ({
          range,
          values: clone(getSheet(spreadsheetId, range).values),
        })),
      };
    },
  );

  const append = vi.fn(
    (
      resource: {
        values?: any[][];
      },
      spreadsheetId: string,
      range: string,
      _options?: unknown,
    ) => {
      const sheet = getSheet(spreadsheetId, range);

      sheet.values.push(...clone(resource.values ?? []));

      return {};
    },
  );

  const update = vi.fn(
    (
      resource: {
        values?: any[][];
      },
      spreadsheetId: string,
      range: string,
      _options?: unknown,
    ) => {
      const sheet = getSheet(spreadsheetId, range);

      const { row, column } = parseStartCell(range);

      const values = resource.values ?? [];

      values.forEach((sourceRow, rowOffset) => {
        const targetRow = row - 1 + rowOffset;

        while (sheet.values.length <= targetRow) {
          sheet.values.push([]);
        }

        sourceRow.forEach((value, columnOffset) => {
          const targetColumn = column - 1 + columnOffset;

          while (sheet.values[targetRow].length <= targetColumn) {
            sheet.values[targetRow].push("");
          }

          sheet.values[targetRow][targetColumn] = value;
        });
      });

      return {};
    },
  );

  const valuesBatchUpdate = vi.fn(
    (
      resource: {
        data?: Array<{
          range?: string;
          values?: any[][];
        }>;
      },
      spreadsheetId: string,
    ) => {
      for (const data of resource.data ?? []) {
        if (!data.range) {
          continue;
        }

        update(
          {
            values: data.values ?? [],
          },
          spreadsheetId,
          data.range,
          {
            valueInputOption: "RAW",
          },
        );
      }

      return {};
    },
  );

  const batchClear = vi.fn(
    (
      resource: {
        ranges?: string[];
      },
      spreadsheetId: string,
    ) => {
      for (const range of resource.ranges ?? []) {
        const sheet = getSheet(spreadsheetId, range);

        const a1 = range.split("!")[1];

        if (a1 === "1:1") {
          if (sheet.values.length > 0) {
            sheet.values[0] = [];
          }

          continue;
        }

        if (a1.startsWith("A2:")) {
          sheet.values = sheet.values.length > 0 ? [sheet.values[0]] : [];
        }
      }

      return {};
    },
  );

  const spreadsheetsGet = vi.fn((spreadsheetId: string, _options?: unknown) => {
    const spreadsheet = getSpreadsheet(spreadsheetId);

    return {
      sheets: spreadsheet.sheets.map((sheet) => ({
        properties: {
          sheetId: sheet.sheetId,
          title: sheet.title,
        },
        protectedRanges: clone(sheet.protectedRanges ?? []),
      })),
    };
  });

  const spreadsheetsBatchUpdate = vi.fn(
    (
      resource: {
        requests?: Array<{
          addSheet?: {
            properties?: {
              title?: string;
            };
          };
          deleteDimension?: {
            range?: {
              sheetId?: number;
              dimension?: string;
              startIndex?: number;
              endIndex?: number;
            };
          };
          addProtectedRange?: {
            protectedRange?: {
              description?: string;
              range?: {
                sheetId?: number;
              };
            };
          };
        }>;
      },
      spreadsheetId: string,
    ) => {
      const spreadsheet = getSpreadsheet(spreadsheetId);

      const replies: any[] = [];

      for (const request of resource.requests ?? []) {
        if (request.addSheet) {
          const title = request.addSheet.properties?.title;

          if (!title) {
            throw new Error("Sheet title is required");
          }

          const nextSheetId =
            Math.max(0, ...spreadsheet.sheets.map((sheet) => sheet.sheetId)) +
            1;

          spreadsheet.sheets.push({
            sheetId: nextSheetId,
            title,
            values: [],
          });

          replies.push({
            addSheet: {
              properties: {
                sheetId: nextSheetId,
                title,
              },
            },
          });

          continue;
        }

        if (request.deleteDimension) {
          const range = request.deleteDimension.range;

          const sheet = spreadsheet.sheets.find(
            (candidate) => candidate.sheetId === range?.sheetId,
          );

          if (!sheet) {
            throw new Error("Sheet not found");
          }

          const startIndex = range?.startIndex ?? 0;

          const endIndex = range?.endIndex ?? startIndex;

          sheet.values.splice(startIndex, endIndex - startIndex);

          replies.push({});

          continue;
        }

        if (request.addProtectedRange) {
          const protectedRange = request.addProtectedRange.protectedRange;

          const sheet = spreadsheet.sheets.find(
            (candidate) => candidate.sheetId === protectedRange?.range?.sheetId,
          );

          if (!sheet) {
            throw new Error("Sheet not found");
          }

          const ranges = (sheet.protectedRanges ??= []);

          ranges.push({
            protectedRangeId: ranges.length + 1,
            description: protectedRange?.description,
            range: clone(protectedRange?.range ?? {}),
          });

          replies.push({});
        }
      }

      return {
        replies,
      };
    },
  );

  const service = {
    Spreadsheets: {
      get: spreadsheetsGet,
      batchUpdate: spreadsheetsBatchUpdate,
      Values: {
        get: valuesGet,
        batchGet,
        append,
        update,
        batchUpdate: valuesBatchUpdate,
        batchClear,
      },
    },
  };

  return {
    service,
    spreadsheets,
    mocks: {
      spreadsheetsGet,
      spreadsheetsBatchUpdate,
      valuesGet,
      batchGet,
      append,
      update,
      valuesBatchUpdate,
      batchClear,
    },
  };
}

describe("SheetGateway", () => {
  let fixture: ReturnType<typeof createSheetsService>;

  beforeEach(() => {
    fixture = createSheetsService({
      db1: {
        sheets: [
          {
            sheetId: 10,
            title: "users",
            values: [
              ["id", "name", "email"],
              [1, "Alice", "a@example.com"],
              [2, "Bob", "b@example.com"],
              [3, "Carol", "c@example.com"],
            ],
          },
          {
            sheetId: 20,
            title: "orders",
            values: [
              ["id", "userId"],
              [100, 1],
              [101, 2],
            ],
          },
        ],
      },
      db2: {
        sheets: [
          {
            sheetId: 30,
            title: "products",
            values: [
              ["id", "name"],
              [1, "Book"],
            ],
          },
        ],
      },
    });
  });

  it("reads records with batchGet", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.read()).toEqual([
      {
        id: 1,
        name: "Alice",
        email: "a@example.com",
      },
      {
        id: 2,
        name: "Bob",
        email: "b@example.com",
      },
      {
        id: 3,
        name: "Carol",
        email: "c@example.com",
      },
    ]);

    expect(fixture.mocks.batchGet).toHaveBeenCalledTimes(1);

    expect(fixture.mocks.batchGet).toHaveBeenCalledWith("db1", {
      ranges: ["'users'!A:ZZZ"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  });

  it("returns empty records when sheet has only headers", () => {
    fixture.spreadsheets.get("db1")!.sheets[0].values = [["id", "name"]];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.read()).toEqual([]);
  });

  it("returns empty records when values are empty", () => {
    fixture.spreadsheets.get("db1")!.sheets[0].values = [];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.read()).toEqual([]);
  });

  it("fills missing trailing cells with empty string", () => {
    fixture.spreadsheets.get("db1")!.sheets[0].values = [
      ["id", "name", "email"],
      [1, "Alice"],
    ];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.read()).toEqual([
      {
        id: 1,
        name: "Alice",
        email: "",
      },
    ]);
  });

  it("reads multiple tables in one batchGet per spreadsheet", () => {
    const gateway = new SheetGateway(fixture.service as any);

    const result = gateway.readMany([
      {
        dbId: "db1",
        sheetName: "users",
      },
      {
        dbId: "db1",
        sheetName: "orders",
      },
    ]);

    expect(fixture.mocks.batchGet).toHaveBeenCalledTimes(1);

    expect(fixture.mocks.batchGet).toHaveBeenCalledWith("db1", {
      ranges: ["'users'!A:ZZZ", "'orders'!A:ZZZ"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    expect(result.get("db1:users")).toHaveLength(3);

    expect(result.get("db1:orders")).toEqual([
      {
        id: 100,
        userId: 1,
      },
      {
        id: 101,
        userId: 2,
      },
    ]);
  });

  it("uses separate batchGet calls for different spreadsheets", () => {
    const gateway = new SheetGateway(fixture.service as any);

    const result = gateway.readMany([
      {
        dbId: "db1",
        sheetName: "users",
      },
      {
        dbId: "db2",
        sheetName: "products",
      },
    ]);

    expect(fixture.mocks.batchGet).toHaveBeenCalledTimes(2);

    expect(result.get("db2:products")).toEqual([
      {
        id: 1,
        name: "Book",
      },
    ]);
  });

  it("appends only inserted records", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.read();

    gateway.insert([
      {
        id: 4,
        name: "Dave",
        email: "d@example.com",
      },
    ]);

    expect(fixture.mocks.append).toHaveBeenCalledTimes(1);

    expect(fixture.mocks.append).toHaveBeenCalledWith(
      {
        values: [[4, "Dave", "d@example.com"]],
      },
      "db1",
      "'users'!A1:C",
      {
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
      },
    );

    expect(gateway.read()).toContainEqual({
      id: 4,
      name: "Dave",
      email: "d@example.com",
    });
  });

  it("does not call append for empty inserts", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.insert([]);

    expect(fixture.mocks.append).not.toHaveBeenCalled();
  });

  it("throws when insert has no headers", () => {
    fixture.spreadsheets.get("db1")!.sheets[0].values = [];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(() =>
      gateway.insert([
        {
          id: 1,
        },
      ]),
    ).toThrow("Not set table columns yet.");
  });

  it("updates only target rows with one values batchUpdate", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    const current = gateway.read();

    const records = new SheetRecords(current, "id");

    gateway.update(
      [
        {
          id: 2,
          name: "Bobby",
          email: "new@example.com",
        },
        {
          id: 3,
          name: "Caroline",
          email: "caroline@example.com",
        },
      ],
      records,
      "id",
    );

    expect(fixture.mocks.valuesBatchUpdate).toHaveBeenCalledTimes(1);

    expect(fixture.mocks.valuesBatchUpdate).toHaveBeenCalledWith(
      {
        valueInputOption: "RAW",
        data: [
          {
            range: "'users'!A3:C3",
            values: [[2, "Bobby", "new@example.com"]],
          },
          {
            range: "'users'!A4:C4",
            values: [[3, "Caroline", "caroline@example.com"]],
          },
        ],
      },
      "db1",
    );

    expect(gateway.read()).toEqual([
      {
        id: 1,
        name: "Alice",
        email: "a@example.com",
      },
      {
        id: 2,
        name: "Bobby",
        email: "new@example.com",
      },
      {
        id: 3,
        name: "Caroline",
        email: "caroline@example.com",
      },
    ]);
  });

  it("falls back to primary-key lookup when row number is unavailable", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.read();

    const current = new SheetRecords(
      [
        {
          id: 99,
          name: "Missing",
          email: "",
        },
      ],
      "id",
    );

    gateway.update(
      [
        {
          id: 2,
          name: "Bobby",
          email: "b@example.com",
        },
      ],
      current,
      "id",
    );

    expect(fixture.mocks.valuesGet).toHaveBeenCalledWith(
      "db1",
      "'users'!A2:A",
      {
        valueRenderOption: "UNFORMATTED_VALUE",
      },
    );
  });

  it("throws when update target does not exist", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.read();

    const current = new SheetRecords([], "id");

    expect(() =>
      gateway.update(
        [
          {
            id: 999,
            name: "Nobody",
            email: "",
          },
        ],
        current,
        "id",
      ),
    ).toThrow("Record with primary key '999' not found.");
  });

  it("deletes rows in descending row order", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    const current = gateway.read();

    const records = new SheetRecords(current, "id");

    gateway.delete([1, 3], records, "id");

    expect(fixture.mocks.spreadsheetsBatchUpdate).toHaveBeenCalledWith(
      {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: 10,
                dimension: "ROWS",
                startIndex: 3,
                endIndex: 4,
              },
            },
          },
          {
            deleteDimension: {
              range: {
                sheetId: 10,
                dimension: "ROWS",
                startIndex: 1,
                endIndex: 2,
              },
            },
          },
        ],
      },
      "db1",
    );

    expect(gateway.read()).toEqual([
      {
        id: 2,
        name: "Bob",
        email: "b@example.com",
      },
    ]);
  });

  it("does nothing when delete targets are empty", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.delete([], new SheetRecords([], "id"), "id");

    expect(fixture.mocks.spreadsheetsBatchUpdate).not.toHaveBeenCalled();
  });

  it("rewrites all body records", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.read();

    gateway.rewrite([
      {
        id: 10,
        name: "X",
        email: "x@example.com",
      },
      {
        id: 11,
        name: "Y",
        email: "y@example.com",
      },
    ]);

    expect(fixture.mocks.batchClear).toHaveBeenCalledWith(
      {
        ranges: ["'users'!A2:C"],
      },
      "db1",
    );

    expect(gateway.read()).toEqual([
      {
        id: 10,
        name: "X",
        email: "x@example.com",
      },
      {
        id: 11,
        name: "Y",
        email: "y@example.com",
      },
    ]);
  });

  it("clears body when rewrite data is empty", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.read();

    gateway.rewrite([]);

    expect(gateway.read()).toEqual([]);
  });

  it("restores previous records when rewrite fails", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.read();

    const original = gateway.read();

    fixture.mocks.update.mockImplementationOnce(() => {
      throw new Error("fail");
    });

    expect(() =>
      gateway.rewrite(
        [
          {
            id: 9,
            name: "Broken",
            email: "",
          },
        ],
        original,
      ),
    ).toThrow("fail");

    expect(gateway.read()).toEqual(original);
  });

  it("returns count from records", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.count()).toBe(3);
  });

  it("returns zero count for header-only sheet", () => {
    fixture.spreadsheets.get("db1")!.sheets[0].values = [["id"]];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.count()).toBe(0);
  });

  it("returns last numeric id", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.lastId("id")).toBe(3);
  });

  it("returns zero lastId for empty body", () => {
    fixture.spreadsheets.get("db1")!.sheets[0].values = [["id"]];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(gateway.lastId("id")).toBe(0);
  });

  it("throws when lastId is not numeric", () => {
    fixture.spreadsheets.get("db1")!.sheets[0].values = [["id"], ["abc"]];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    expect(() => gateway.lastId("id")).toThrow("Last ID is not a number");
  });

  it("overwrites existing headers with setColumns", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.setColumns("db1", "users", ["id", "displayName"]);

    expect(
      fixture.spreadsheets
        .get("db1")!
        .sheets.find((sheet) => sheet.title === "users")!.values[0],
    ).toEqual(["id", "displayName"]);
  });

  it("creates missing sheet with setColumns", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.setColumns("db1", "logs", ["id", "message"]);

    const sheet = fixture.spreadsheets
      .get("db1")!
      .sheets.find((candidate) => candidate.title === "logs");

    expect(sheet).toBeDefined();

    expect(sheet?.values[0]).toEqual(["id", "message"]);

    expect(fixture.mocks.spreadsheetsBatchUpdate).toHaveBeenCalledWith(
      {
        requests: [
          {
            addSheet: {
              properties: {
                title: "logs",
              },
            },
          },
        ],
      },
      "db1",
    );
  });

  it("protects a sheet with addProtectedRange", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.protect();

    const users = fixture.spreadsheets
      .get("db1")!
      .sheets.find((sheet) => sheet.title === "users")!;

    expect(users.protectedRanges).toEqual([
      {
        protectedRangeId: 1,
        description: "Protected by SheetGateway",
        range: {
          sheetId: 10,
        },
      },
    ]);
  });

  it("does not create duplicate protected ranges", () => {
    const users = fixture.spreadsheets
      .get("db1")!
      .sheets.find((sheet) => sheet.title === "users")!;

    users.protectedRanges = [
      {
        protectedRangeId: 1,
        description: "Protected by SheetGateway",
        range: {
          sheetId: 10,
        },
      },
    ];

    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("users", "db1");

    gateway.protect();

    expect(fixture.mocks.spreadsheetsBatchUpdate).not.toHaveBeenCalled();
  });

  it("throws when protecting a missing sheet", () => {
    const gateway = new SheetGateway(fixture.service as any);

    gateway.table("missing", "db1");

    expect(() => gateway.protect()).toThrow(
      "Sheet missing not found in spreadsheet db1",
    );
  });
});
