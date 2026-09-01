export interface AccessableDataStore {
    table(sheetName: string, dbId: string): void;

    read(): Record<string, any>[];
    insert(records: Record<string, any>[]): void;
    rewrite(
        records: Record<string, any>[],
        previousRecords?: Record<string, any>[],
    ): void;

    setColumns(dbId: string, sheetName: string, columns: string[]): void;
    count(): number;
    lastId(pk: string): number;
    protect(): void;
}
