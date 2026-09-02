import { ZodObject, z } from "zod";
import { CreateCommand } from "../commands/CreateCommand";
import { DeleteCommand } from "../commands/DeleteCommand";
import { UpdateCommand } from "../commands/UpdateCommand";
import { RecordWithRelations } from "../commands/WriteCommand";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
import { SheetQuery } from "../query/SheetQuery";
import { Relationable, TableByName } from "./Relationable";
import { SheetRecords } from "./SheetRecords";
import { SheetTable } from "./SheetTable";

export type CurrentTable<
  T extends readonly Relationable<any>[],
  N extends T[number]["name"],
> = TableByName<T, N>;

export type CurrentSchema<
  T extends readonly Relationable<any>[],
  N extends T[number]["name"],
> = CurrentTable<T, N>["schema"];

type CreateRecord<T extends ZodObject<any>> = {
  [K in keyof z.infer<T> as T["shape"][K] extends {
    _def: {
      meta: {
        primary: true;
        autoIncrement: true;
      };
    };
  }
    ? never
    : K]?: z.infer<T>[K];
};

type CreateParams<
  T extends readonly Relationable<any>[],
  Z extends ZodObject<any>,
> = CreateRecord<Z> & { relations?: CreateRelations<T> };

export type CurrentRecord<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"],
> = z.infer<CurrentSchema<T, N>>;

type CreateRelations<T extends readonly Relationable<any>[]> = Partial<{
  [K in T[number]["name"]]: CreateParams<T, TableByName<T, K>["schema"]>[];
}>;

export class SheetDB<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"] = T[number]["name"],
> {
  private _table: TableByName<T, N>;
  private transactionEnabled = false;
  private cache: GoogleAppsScript.Cache.Cache;
  constructor(
    private readonly tables: T,
    private gateway: AccessableDataStore,
    private CacheService: GoogleAppsScript.Cache.CacheService,
    private Utilities: GoogleAppsScript.Utilities.Utilities,
  ) {
    this._table = tables[0] as TableByName<T, N>;
    this.cache = CacheService.getScriptCache();
  }

  public table<U extends T[number]["name"]>(name: U): SheetDB<T, U> {
    const table = this.tables.find(
      (t): t is TableByName<T, U> => t.name === name,
    );

    if (!table) {
      throw new Error(`Table '${name}' not found.`);
    }

    this._table = table as unknown as TableByName<T, N>;
    this.gateway.table(this._table.name, this._table.dbId);
    return this as any;
  }

  public create(
    params: CreateParams<T, CurrentSchema<T, N>>[],
  ): CurrentRecord<T, N>[] {
    const command = new CreateCommand(
      this.gateway,
      this._table,
      this.CacheService,
      this.Utilities,
      params,
    );
    const records = command.getDiff();

    if (this.transactionEnabled) {
      this._table.cache.add(command);
      return records;
    }

    try {
      this.gateway.table(this._table.name, this._table.dbId);
      const exsist = new SheetRecords(
        this.gateway.read(),
        this._table.primaryKey as string,
      );
      command.execute(exsist);
    } finally {
      this._table.releaseLock();
    }
    return command.getDiff();
  }

  public update(records: CurrentRecord<T, N>[]): CurrentRecord<T, N>[] {
    const command = new UpdateCommand(
      this._table,
      this.gateway,
      this.CacheService,
      this.Utilities,
      records,
    );
    if (this.transactionEnabled) {
      this.gateway.table(this._table.name, this._table.dbId);
      const exsist = new SheetRecords(
        this.gateway.read(),
        this._table.primaryKey as string,
      );
      const updatedRecords = command.preview(exsist);
      this._table.cache.add(command);
      return updatedRecords;
    }

    try {
      this.gateway.table(this._table.name, this._table.dbId);
      const exsist = new SheetRecords(
        this.gateway.read(),
        this._table.primaryKey as string,
      );
      const updatedRecords = command.execute(exsist);
      return updatedRecords;
    } finally {
      this._table.releaseLock();
    }
  }

  public upsert(records: CurrentRecord<T, N>[]): CurrentRecord<T, N>[] {
    this.gateway.table(this._table.name, this._table.dbId);
    const exsist = new SheetRecords(
      this.gateway.read(),
      this._table.primaryKey as string,
    );

    const isEmptyPrimaryKey = (value: unknown) => {
      return (
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim().length === 0)
      );
    };

    const resultRecords = records.map(() => null) as unknown as CurrentRecord<
      T,
      N
    >[];
    const createIndexes: number[] = [];
    const updateIndexes: number[] = [];
    const createParams: Record<string, any>[] = [];
    const updateRecords: Record<string, any>[] = [];

    records.forEach((record, index) => {
      const pkValue = record[this._table.primaryKey as string];

      if (isEmptyPrimaryKey(pkValue)) {
        if (!this._table.autoIncrement) {
          throw new Error("Primary key is required for upsert.");
        }
        delete record[this._table.primaryKey as string];
        createIndexes.push(index);
        createParams.push(record);
        return;
      }

      const existing = exsist.getRecord(pkValue);
      if (existing) {
        updateIndexes.push(index);
        updateRecords.push(record);
        return;
      }

      if (this._table.autoIncrement) {
        delete record[this._table.primaryKey as string];
      }

      createIndexes.push(index);
      createParams.push(record);
    });

    const updateCommand =
      updateRecords.length > 0
        ? new UpdateCommand(
            this._table,
            this.gateway,
            this.CacheService,
            this.Utilities,
            updateRecords,
          )
        : null;

    if (this.transactionEnabled) {
      if (updateCommand) {
        const updatedRecords = updateCommand.preview(exsist);
        updatedRecords.forEach((record, index) => {
          resultRecords[updateIndexes[index]] = record;
        });
        this._table.cache.add(updateCommand);
      }

      const createCommand =
        createParams.length > 0
          ? new CreateCommand(
              this.gateway,
              this._table,
              this.CacheService,
              this.Utilities,
              createParams,
            )
          : null;

      if (createCommand) {
        const createdRecords = createCommand.getDiff();
        createdRecords.forEach((record, index) => {
          resultRecords[createIndexes[index]] = record as CurrentRecord<T, N>;
        });
        this._table.cache.add(createCommand);
      }

      return resultRecords;
    }

    try {
      if (updateCommand) {
        const updatedRecords = updateCommand.execute(exsist);
        updatedRecords.forEach((record, index) => {
          resultRecords[updateIndexes[index]] = record;
        });
      }

      const createCommand =
        createParams.length > 0
          ? new CreateCommand(
              this.gateway,
              this._table,
              this.CacheService,
              this.Utilities,
              createParams,
            )
          : null;

      if (createCommand) {
        createCommand.execute(exsist);
        const createdRecords = createCommand.getDiff();
        createdRecords.forEach((record, index) => {
          resultRecords[createIndexes[index]] = record as CurrentRecord<T, N>;
        });
      }

      return resultRecords;
    } finally {
      this._table.releaseLock();
    }
  }

  public delete(pkValues: any[]): boolean {
    const command = new DeleteCommand(
      this._table,
      this.gateway,
      this.CacheService,
      this.Utilities,
      pkValues,
    );

    if (this.transactionEnabled) {
      this._table.cache.add(command);
      return true;
    }

    try {
      this.gateway.table(this._table.name, this._table.dbId);
      const records = new SheetRecords(
        this.gateway.read(),
        this._table.primaryKey as string,
      );
      command.execute(records);
    } finally {
      this._table.releaseLock();
    }

    return true;
  }

  query<U extends T[number]["name"]>(
    tableName: U,
  ): SheetQuery<T, TableByName<T, U>["schema"], U> {
    return new SheetQuery<T, TableByName<T, U>["schema"], U>(
      [],
      [],
      null,
      null,
      null,
      [],
      tableName,
    );
  }

  find(): RecordWithRelations<CurrentRecord<T, N>>[];
  find<U extends T[number]["name"]>(
    query: SheetQuery<T, TableByName<T, U>["schema"], U>,
    recursive?: boolean,
  ): RecordWithRelations<CurrentRecord<T, U>>[];
  find(
    query?: SheetQuery<T, any, any>,
    recursive?: boolean,
  ): RecordWithRelations<CurrentRecord<T, N>>[];
  find(query?: SheetQuery<T, any, any>, recursive?: boolean): any {
    const queryTableName = query?.getTableName();
    if (queryTableName) {
      this.table(queryTableName as any);
    }
    if (!recursive) this.gateway.table(this._table.name, this._table.dbId);
    const records = this.gateway.read();

    if (!query) return records;

    const filterdRecords = query.filter(records);
    const sortedRecords = query.sort(filterdRecords);
    const shiftedRecords = query.shift(sortedRecords);
    const cuttedRecords = query.cut(shiftedRecords);

    const joins = query.getJoins();

    if (joins.length <= 0) return cuttedRecords;

    const baseTableName = this._table.name;

    joins.forEach((join) => {
      // join のたびに親テーブルへ戻してから処理する
      this.table(baseTableName as any);

      const parents = cuttedRecords.reduce(
        (acc, record) => {
          const key = record[join.localKey as string];
          if (key === null || key === undefined) return acc;
          const keyStr = String(key);
          if (!acc[keyStr]) acc[keyStr] = [];
          acc[keyStr].push(record);
          return acc;
        },
        {} as Record<string, RecordWithRelations<CurrentRecord<T, N>>[]>,
      );

      this.table(join.table);

      // 子データを取得
      this.gateway.table(this._table.name, this._table.dbId);
      const children = this.find(join.query || undefined, true);

      // 関連データをエンティティに追加する
      children.forEach((child) => {
        const parentKey = child[join.foreignKey];
        if (parentKey === null || parentKey === undefined) return;
        const matchedParents = parents[String(parentKey)];
        if (!matchedParents || matchedParents.length === 0) return;
        matchedParents.forEach(
          (parent: RecordWithRelations<CurrentRecord<T, N>>) => {
            parent.relations ??= {};
            parent.relations[join.table] ??= [];
            parent.relations[join.table].push(child);
          },
        );
      });
    });

    // find() 呼び出し元のテーブル状態を戻す
    this.table(baseTableName as any);
    return cuttedRecords;
  }

  transaction<R>(fn: () => R): R {
    this.transactionEnabled = true;
    try {
      const result = fn();
      this.tables.forEach((table) => this.commit(table));
      return result;
    } catch (e) {
      this.tables.forEach((table) => this.rollback(table));
      throw e;
    } finally {
      this.transactionEnabled = false;
    }
  }

  commit(table: T[number]): void {
    this.gateway.table(table.name, table.dbId);
    const cache = table.cache;
    table.lock(this.cache, this.Utilities);

    const records = new SheetRecords(
      this.gateway.read(),
      table.primaryKey as string,
    );
    cache.setExsist(records);
    while (cache.hasNext()) {
      const command = cache.next();
      command.execute(records);
    }

    table.releaseLock();
    cache.clear();
  }

  rollback(table: T[number]): void {
    table.lock(this.cache, this.Utilities);
    const cache = table.cache;

    const exsist = cache.getExsist();
    this.gateway.table(table.name, table.dbId);
    if (!exsist || exsist.length === 0) {
      table.releaseLock();
      return;
    }

    try {
      this.gateway.rewrite(exsist);
    } finally {
      table.releaseLock();
      cache.clear();
    }
  }

  migrate() {
    for (const table of this.tables) {
      const columns = table.schema.keyof().options;
      this._table.lock(this.cache, this.Utilities);
      try {
        this.gateway.setColumns(table.dbId, table.name, columns);
      } finally {
        this._table.releaseLock();
      }
    }
    return;
  }

  seed<U extends T[number]["name"]>(
    tableName: U,
    datas: z.infer<TableByName<T, U>["schema"]>[],
  ) {
    this.table(tableName);
    this.gateway.table(this._table.name, this._table.dbId);
    if (this.gateway.count() > 0) {
      console.error(`Table '${tableName}' is not empty. Seed failed.`);
      return;
    }
    this._table.lock(this.cache, this.Utilities);
    try {
      this.gateway.insert(datas);
    } finally {
      this._table.releaseLock();
    }
    return;
  }

  protect() {
    for (const table of this.tables) {
      this.gateway.table(table.name, table.dbId);
      this.gateway.protect();
    }
    return;
  }
}
