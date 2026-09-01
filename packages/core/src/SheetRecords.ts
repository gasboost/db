export class SheetRecords {
  private values: Map<any, Record<string, any>>;
  constructor(
    records: Record<string, any>[],
    private primaryKey: string,
  ) {
    this.values = new Map();
    records.forEach((record) => {
      this.values.set(record[this.primaryKey], record);
    });
  }

  uniqueValues(uniqueColumns: string[]) {
    const uniqueValues = new Map<string, Map<any, any>>();
    uniqueColumns.forEach((col) => uniqueValues.set(col, new Map()));
    for (const [pk, record] of this.values.entries()) {
      uniqueValues.forEach((values, columnName) => {
        const value = record[columnName];
        if (value === null || value === undefined) return;
        if (typeof value === "string" && value.trim().length === 0) {
          return;
        }
        values.set(pk, value);
      });
    }
    return uniqueValues;
  }

  getValues(): Record<string, any>[] {
    return Array.from(this.values.values());
  }

  replace(record: Record<string, any>) {
    this.values.set(record[this.primaryKey], record);
  }

  getRecord(pkValue: any): Record<string, any> | null {
    return this.values.get(pkValue) || null;
  }

  remove(pkValue: unknown) {
    this.values.delete(pkValue);
  }
}
