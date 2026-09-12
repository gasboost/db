export type SheetsService = {
  Spreadsheets: Pick<
    GoogleAppsScript.Sheets.Collection.SpreadsheetsCollection,
    "get" | "batchUpdate"
  > & {
    Values: Pick<
      GoogleAppsScript.Sheets.Collection.Spreadsheets.ValuesCollection,
      "get" | "batchGet" | "append" | "update" | "batchUpdate" | "batchClear"
    >;
  };
};

export const SheetsStub: SheetsService = {
  Spreadsheets: {
    get() {
      return {};
    },

    batchUpdate() {
      return {};
    },

    Values: {
      get() {
        return {
          values: [],
        };
      },

      batchGet() {
        return {
          valueRanges: [],
        };
      },

      append() {
        return {};
      },

      update() {
        return {};
      },

      batchUpdate() {
        return {};
      },

      batchClear() {
        return {};
      },
    },
  },
};
