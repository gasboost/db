"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SheetRecords = void 0;
class SheetRecords {
    primaryKey;
    values;
    constructor(records, primaryKey) {
        this.primaryKey = primaryKey;
        this.values = new Map();
        records.forEach((record) => {
            this.values.set(record[this.primaryKey], record);
        });
    }
    uniqueValues(uniqueColumns) {
        const uniqueValues = new Map();
        uniqueColumns.forEach((col) => uniqueValues.set(col, new Map()));
        for (const [pk, record] of this.values.entries()) {
            uniqueValues.forEach((values, columnName) => {
                const value = record[columnName];
                if (value === null || value === undefined)
                    return;
                if (typeof value === "string" && value.trim().length === 0) {
                    return;
                }
                values.set(pk, value);
            });
        }
        return uniqueValues;
    }
    getValues() {
        return Array.from(this.values.values());
    }
    replace(record) {
        this.values.set(record[this.primaryKey], record);
    }
    getRecord(pkValue) {
        return this.values.get(pkValue) || null;
    }
    remove(pkValue) {
        this.values.delete(pkValue);
    }
}
exports.SheetRecords = SheetRecords;
