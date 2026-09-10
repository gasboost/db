import { describe, expect, it } from "vitest";
import { SpreadsheetAppStub } from "../../src/storage/SpreadsheetAppStub";

describe("SpreadsheetAppStub", () => {
  it("getActive().getId()で固定のSpreadsheet IDを取得できる", () => {
    expect(SpreadsheetAppStub.getActive().getId()).toBe(
      "__GASBOOST_SPREADSHEET_ID__",
    );
  });

  it("SheetORM初期化用のdatabaseIdを取得できる", () => {
    const databaseId = SpreadsheetAppStub.getActive().getId();

    expect(databaseId).toBe("__GASBOOST_SPREADSHEET_ID__");
  });
});
