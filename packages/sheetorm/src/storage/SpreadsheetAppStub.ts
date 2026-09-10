export const SpreadsheetAppStub = {
  getActive(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    return {
      getId: () => "__GASBOOST_SPREADSHEET_ID__",
    } as GoogleAppsScript.Spreadsheet.Spreadsheet;
  },
} as GoogleAppsScript.Spreadsheet.SpreadsheetApp;
