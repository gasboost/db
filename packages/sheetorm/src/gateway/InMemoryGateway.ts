import { Stockable } from "../storage/InMemoryDataStore";
import { AccessableDataStore } from "./AccessableDataStore";

export class InMemoryGateway implements AccessableDataStore {
    constructor(private dataStore: Stockable) {}

    private _table!: `${string}:${string}`;

    table(sheet: string, dbId: string) {
        this._table = `${dbId}:${sheet}`;
    }

    read(): Record<string, any>[] {
        const { headers, rows } = this.dataStore.get(this._table);

        return structuredClone(
            rows.map((row) =>
                Object.fromEntries(headers.map((col, i) => [col, row[i]])),
            ),
        );
    }

    rewrite(
        rows: Record<string, any>[],
        _previousRecords?: Record<string, any>[],
    ): void {
        const { headers } = this.dataStore.get(this._table);

        const dataValues = rows.map((record) =>
            headers.map((col) => record[col]),
        );

        this.dataStore.set(this._table, [headers, ...dataValues]);
    }

    insert(rows: Record<string, any>[]): void {
        if (rows.length === 0) return;

        const { headers, rows: existingRows } = this.dataStore.get(this._table);

        const appended = rows.map((record) =>
            headers.map((col) => record[col]),
        );

        this.dataStore.set(this._table, [
            headers,
            ...existingRows,
            ...appended,
        ]);
    }

    setColumns(dbId: string, sheetName: string, columns: string[]): void {
        this.table(sheetName, dbId);

        const { rows } = this.dataStore.get(this._table);

        this.dataStore.set(this._table, [columns, ...rows]);
    }

    count(): number {
        const { rows } = this.dataStore.get(this._table);
        return rows.length;
    }

    lastId(pk: string): number {
        const { headers, rows } = this.dataStore.get(this._table);

        const pkIndex = headers.indexOf(pk);
        if (pkIndex === -1) {
            throw new Error(`Primary key column ${pk} not found`);
        }

        if (rows.length === 0) return 0;

        return Math.max(...rows.map((r) => r[pkIndex]));
    }

    protect(): void {
        // No-op for in-memory gateway
    }
}
