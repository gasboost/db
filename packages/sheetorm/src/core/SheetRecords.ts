export class SheetRecords {
  private readonly values: Map<any, Record<string, any>>;
  private readonly rowNumbers: Map<any, number>;

  constructor(
    records: Record<string, any>[],
    private readonly primaryKey: string,
    firstRowNumber = 2,
  ) {
    this.values = new Map();
    this.rowNumbers = new Map();

    records.forEach((record, index) => {
      const primaryKeyValue = record[this.primaryKey];

      this.values.set(primaryKeyValue, record);
      this.rowNumbers.set(primaryKeyValue, firstRowNumber + index);
    });
  }

  uniqueValues(uniqueColumns: string[]) {
    const uniqueValues = new Map<string, Map<any, any>>();

    uniqueColumns.forEach((column) => {
      uniqueValues.set(column, new Map());
    });

    for (const [primaryKeyValue, record] of this.values.entries()) {
      uniqueValues.forEach((values, columnName) => {
        const value = record[columnName];

        if (value === null || value === undefined) {
          return;
        }

        if (typeof value === "string" && value.trim().length === 0) {
          return;
        }

        values.set(primaryKeyValue, value);
      });
    }

    return uniqueValues;
  }

  getValues(): Record<string, any>[] {
    return Array.from(this.values.values());
  }

  replace(record: Record<string, any>): void {
    this.values.set(record[this.primaryKey], record);
  }

  getRecord(primaryKeyValue: any): Record<string, any> | null {
    return this.values.get(primaryKeyValue) ?? null;
  }

  getRowNumber(primaryKeyValue: any): number | null {
    return this.rowNumbers.get(primaryKeyValue) ?? null;
  }

  remove(primaryKeyValue: any): void {
    this.values.delete(primaryKeyValue);
    this.rowNumbers.delete(primaryKeyValue);
  }
}
