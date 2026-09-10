import type { Table } from "dexie";

export class ReplicaTable<RecordType, KeyType> {
  constructor(private readonly table: Table<RecordType, KeyType>) {}

  public async put(record: RecordType): Promise<void> {
    await this.table.put(record);
  }

  public async bulkPut(records: RecordType[]): Promise<void> {
    await this.table.bulkPut(records);
  }

  public async delete(key: KeyType): Promise<void> {
    await this.table.delete(key);
  }

  public async toArray(): Promise<RecordType[]> {
    return this.table.toArray();
  }
}
