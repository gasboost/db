import { describe, expect, it, vi } from "vitest";
import { SheetGateway } from "../../src/SheetGateway";

type RangeWrite = { row: number; col: number; values: any[][] };

class MockRange {
  constructor(
    private sheet: MockSheet,
    private row: number,
    private col: number,
    private numRows: number,
    private numCols: number,
  ) {}

  getValues(): any[][] {
    const values: any[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowValues: any[] = [];
      for (let c = 0; c < this.numCols; c++) {
        rowValues.push(this.sheet.getCell(this.row + r, this.col + c));
      }
      values.push(rowValues);
    }
    return values;
  }

  setValues(values: any[][]): void {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        this.sheet.setCell(this.row + r, this.col + c, values[r][c]);
      }
    }
    this.sheet.writes.push({ row: this.row, col: this.col, values });
  }

  clearContent(): void {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        this.sheet.setCell(this.row + r, this.col + c, "");
      }
    }
  }

  getValue(): any {
    return this.sheet.getCell(this.row, this.col);
  }
}

class MockSheet {
  public writes: RangeWrite[] = [];
  private data: any[][];
  private protectedDescription = "";

  constructor(
    private name: string,
    data?: any[][],
  ) {
    this.data = data ? data.map((row) => [...row]) : [[]];
  }

  getName(): string {
    return this.name;
  }

  getLastRow(): number {
    return this.data.length;
  }

  getLastColumn(): number {
    return this.data[0]?.length ?? 0;
  }

  getRange(row: number, col: number, numRows = 1, numCols = 1): MockRange {
    return new MockRange(this, row, col, numRows, numCols);
  }

  getCell(row: number, col: number): any {
    const r = row - 1;
    const c = col - 1;
    if (!this.data[r]) return "";
    return this.data[r][c] ?? "";
  }

  setCell(row: number, col: number, value: any): void {
    const r = row - 1;
    const c = col - 1;
    while (this.data.length <= r) this.data.push([]);
    while (this.data[r].length <= c) this.data[r].push("");
    this.data[r][c] = value;
  }

  protect() {
    return {
      setDescription: (desc: string) => {
        this.protectedDescription = desc;
      },
    };
  }

  getProtectedDescription(): string {
    return this.protectedDescription;
  }
}

class MockSpreadsheet {
  constructor(
    private id: string,
    private name: string,
    private sheets: Map<string, MockSheet>,
  ) {}

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  getSheetByName(name: string): MockSheet | null {
    return this.sheets.get(name) || null;
  }

  insertSheet(name: string): MockSheet {
    const sheet = new MockSheet(name, [[]]);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

class MockSpreadsheetApp {
  public flush = vi.fn();
  constructor(
    private active: MockSpreadsheet | null,
    private byId: Map<string, MockSpreadsheet>,
  ) {}

  getActive(): MockSpreadsheet {
    if (!this.active) throw new Error("no active");
    return this.active;
  }

  openById(id: string): MockSpreadsheet {
    const ss = this.byId.get(id);
    if (!ss) throw new Error("missing");
    return ss;
  }
}

describe("SheetGateway", () => {
  it("throws when active spreadsheet is missing", () => {
    const app = new MockSpreadsheetApp(null, new Map());
    const gateway = new SheetGateway(app as any);
    expect(() => gateway.table("users", null)).toThrow(
      "Active spreadsheet not found",
    );
  });

  it("throws when spreadsheet id is missing", () => {
    const app = new MockSpreadsheetApp(null, new Map());
    const gateway = new SheetGateway(app as any);
    expect(() => gateway.table("users", "missing")).toThrow(
      "Spreadsheet with ID missing not found",
    );
  });

  it("throws when sheet is missing", () => {
    const spreadsheet = new MockSpreadsheet("id", "Book", new Map());
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);
    expect(() => gateway.table("users", null)).toThrow(
      "Sheet users not found in spreadsheet Book",
    );
  });

  it("reads and writes rows", () => {
    const sheet = new MockSheet("users", [
      ["id", "name"],
      [1, "A"],
    ]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(gateway.read()).toEqual([{ id: 1, name: "A" }]);

    gateway.insert([{ id: 2, name: "B" }]);
    expect(gateway.read()).toEqual([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
    expect(app.flush).toHaveBeenCalled();
  });

  it("reuses cached spreadsheet instance", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", "id");
    gateway.table("users", "id");

    expect(gateway.read()).toEqual([{ id: 1 }]);
  });

  it("avoids refetching sheet when cached", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const getSheetSpy = vi
      .spyOn(spreadsheet, "getSheetByName")
      .mockReturnValue(sheet);
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", "id");
    gateway.table("users", "id");

    expect(getSheetSpy).toHaveBeenCalledTimes(1);
  });

  it("caches sheets for active spreadsheet", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    gateway.table("users", null);

    expect(gateway.read()).toEqual([{ id: 1 }]);
  });

  it("handles empty active spreadsheet id", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(spreadsheet, new Map());
    const gateway = new SheetGateway(app as any);

    gateway.table("users", "");

    expect(gateway.read()).toEqual([{ id: 1 }]);
  });

  it("caches sheet instances on first access", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const sheets = new Map<string, MockSheet>();
    const spreadsheets = new Map<string, MockSpreadsheet>();
    const gateway = new SheetGateway(
      app as any,
      spreadsheets as any,
      sheets as any,
    );

    gateway.table("users", "id");
    expect(sheets.has("id:users")).toBe(true);
  });

  it("uses cached sheet entries without fetching", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const sheets = new Map<string, MockSheet>([["id:users", sheet]]);
    const spreadsheets = new Map<string, MockSpreadsheet>([
      ["id", spreadsheet],
    ]);
    const gateway = new SheetGateway(
      app as any,
      spreadsheets as any,
      sheets as any,
    );

    gateway.table("users", "id");
    expect(gateway.read()).toEqual([{ id: 1 }]);
  });

  it("uses cached spreadsheet map and caches sheet", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(null, new Map([["id", spreadsheet]]));
    const spreadsheets = new Map<string, MockSpreadsheet>([
      ["id", spreadsheet],
    ]);
    const sheets = new Map<string, MockSheet>();
    const openByIdSpy = vi.spyOn(app, "openById");
    const gateway = new SheetGateway(
      app as any,
      spreadsheets as any,
      sheets as any,
    );

    gateway.table("users", "id");

    expect(openByIdSpy).not.toHaveBeenCalled();
    expect(sheets.has("id:users")).toBe(true);
    expect(gateway.read()).toEqual([{ id: 1 }]);
  });

  it("handles lastId and count", () => {
    const sheet = new MockSheet("users", [["id"], [1], [3]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(gateway.count()).toBe(2);
    expect(gateway.lastId("id")).toBe(3);
  });

  it("returns 0 count when only headers exist", () => {
    const sheet = new MockSheet("users", [["id"]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(gateway.count()).toBe(0);
  });

  it("returns 0 when lastRow < 2", () => {
    const sheet = new MockSheet("users", [["id"]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(gateway.lastId("id")).toBe(0);
  });

  it("throws when pk column is missing or non-number", () => {
    const sheet = new MockSheet("users", [["id"], ["x"]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(() => gateway.lastId("missing")).toThrow(
      "Primary key column missing not found",
    );
    expect(() => gateway.lastId("id")).toThrow("Last ID is not a number");
  });

  it("handles insert with no columns", () => {
    const sheet = new MockSheet("users", [[]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(() => gateway.insert([{ id: 1 }])).toThrow(
      "Not set table columns yet.",
    );
  });

  it("returns empty when no data rows exist", () => {
    const sheet = new MockSheet("users", [["id"]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(gateway.read()).toEqual([]);
  });

  it("skips insert when data is empty", () => {
    const sheet = new MockSheet("users", [["id"]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    gateway.insert([]);
    expect(gateway.read()).toEqual([]);
  });

  it("rewrites and restores on failure", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    const originalSetValues = MockRange.prototype.setValues;
    let shouldThrow = true;
    MockRange.prototype.setValues = function (values: any[][]): void {
      if (shouldThrow && (this as any).row === 2 && (this as any).col === 1) {
        shouldThrow = false;
        throw new Error("fail");
      }
      return originalSetValues.call(this, values);
    };

    expect(() => gateway.rewrite([{ id: 2 }])).toThrow("fail");

    MockRange.prototype.setValues = originalSetValues;
    expect(gateway.read()).toEqual([{ id: 1 }]);
  });

  it("rewrites data successfully", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    gateway.rewrite([{ id: 2 }]);

    expect(gateway.read()).toEqual([{ id: 2 }]);
  });

  it("rewrites and restores using previous records", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    const originalSetValues = MockRange.prototype.setValues;
    let shouldThrow = true;
    MockRange.prototype.setValues = function (values: any[][]): void {
      if (shouldThrow && (this as any).row === 2 && (this as any).col === 1) {
        shouldThrow = false;
        throw new Error("fail");
      }
      return originalSetValues.call(this, values);
    };

    expect(() => gateway.rewrite([{ id: 2 }], [{ id: 1 }])).toThrow("fail");

    MockRange.prototype.setValues = originalSetValues;
    expect(gateway.read()).toEqual([{ id: 1 }]);
  });

  it("skips restore when previous records are empty", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    const originalSetValues = MockRange.prototype.setValues;
    let shouldThrow = true;
    MockRange.prototype.setValues = function (values: any[][]): void {
      if (shouldThrow && (this as any).row === 2 && (this as any).col === 1) {
        shouldThrow = false;
        throw new Error("fail");
      }
      return originalSetValues.call(this, values);
    };

    expect(() => gateway.rewrite([{ id: 2 }], [])).toThrow("fail");

    MockRange.prototype.setValues = originalSetValues;
    expect(gateway.read()).toEqual([{ id: "" }]);
  });

  it("clears rows when rewrite data is empty", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    gateway.rewrite([]);

    expect(gateway.read()).toEqual([{ id: "" }]);
  });

  it("throws when rewrite has no columns", () => {
    const sheet = new MockSheet("users", [[], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    expect(() => gateway.rewrite([{ id: 1 }])).toThrow(
      "Not set table columns yet.",
    );
  });

  it("skips rewrite when only headers exist", () => {
    const sheet = new MockSheet("users", [["id"]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    gateway.rewrite([{ id: 1 }]);
    expect(gateway.read()).toEqual([]);
  });

  it("setColumns creates or overwrites headers", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.setColumns("id", "users", ["id", "name"]);
    gateway.table("users", "id");
    expect(gateway.read()).toEqual([{ id: 1, name: "" }]);

    const spreadsheet2 = new MockSpreadsheet("id2", "Book2", new Map());
    const app2 = new MockSpreadsheetApp(null, new Map([["id2", spreadsheet2]]));
    const gateway2 = new SheetGateway(app2 as any);

    gateway2.setColumns("id2", "newSheet", ["id"]);
    gateway2.table("newSheet", "id2");
    expect(gateway2.read()).toEqual([]);
  });

  it("protects sheet", () => {
    const sheet = new MockSheet("users", [["id"], [1]]);
    const spreadsheet = new MockSpreadsheet(
      "id",
      "Book",
      new Map([["users", sheet]]),
    );
    const app = new MockSpreadsheetApp(
      spreadsheet,
      new Map([["id", spreadsheet]]),
    );
    const gateway = new SheetGateway(app as any);

    gateway.table("users", null);
    gateway.protect();
    expect(sheet.getProtectedDescription()).toBe("Protected by SheetGateway");
  });
});
