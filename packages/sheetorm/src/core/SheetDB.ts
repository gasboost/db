import { Query, QueryEvaluation } from "@gasboost/query";
import { ZodObject, z } from "zod";
import { CreateCommand } from "../commands/CreateCommand";
import { DeleteCommand } from "../commands/DeleteCommand";
import { UpdateCommand } from "../commands/UpdateCommand";
import { RecordWithRelations } from "../commands/WriteCommand";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
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

export type SheetDBConfig<T extends readonly SheetTable<string, any>[]> = {
  tables: T;
  gateway: AccessableDataStore;
  cacheService: GoogleAppsScript.Cache.CacheService;
  utilities: GoogleAppsScript.Utilities.Utilities;
};

export class SheetDB<
  T extends readonly SheetTable<string, any>[],
  N extends T[number]["name"] = T[number]["name"],
> {
  private _table: TableByName<T, N>;
  private transactionEnabled = false;
  private cache: GoogleAppsScript.Cache.Cache;
  private readonly tables: T;
  private gateway: AccessableDataStore;
  private CacheService: GoogleAppsScript.Cache.CacheService;
  private Utilities: GoogleAppsScript.Utilities.Utilities;

  constructor(config: SheetDBConfig<T>) {
    this.tables = config.tables;
    this.gateway = config.gateway;
    this.CacheService = config.cacheService;
    this.Utilities = config.utilities;
    this._table = this.tables[0] as TableByName<T, N>;
    this.cache = this.CacheService.getScriptCache();
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
        if (!this._table.autoNumbering) {
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

      if (this._table.autoNumbering) {
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
      this.transactionEnabled,
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

  public query<U extends T[number]["name"]>(tableName: U): Query<T, U> {
    return new Query<T, U>(tableName);
  }

  public find(): RecordWithRelations<CurrentRecord<T, N>>[];

  public find<U extends T[number]["name"]>(
    query: Query<T, U>,
  ): RecordWithRelations<CurrentRecord<T, U>>[];

  public find(
    query?: Query<T, any>,
  ): RecordWithRelations<CurrentRecord<T, N>>[];

  public find(query?: Query<T, any>): any {
    if (!query) {
      this.gateway.table(this._table.name, this._table.dbId);

      return this.gateway.read();
    }

    const evaluation = new QueryEvaluation(
      query,
      ({ parent, table, children }) => {
        const relations =
          typeof parent.relations === "object" &&
          parent.relations !== null &&
          !Array.isArray(parent.relations)
            ? parent.relations
            : {};

        return {
          ...parent,
          relations: {
            ...relations,
            [table]: children,
          },
        };
      },
    );

    return evaluation.resolve((tableName) => {
      const table = this.tables.find((table) => table.name === tableName);

      if (!table) {
        throw new Error(`Table '${tableName}' not found.`);
      }

      this.gateway.table(table.name, table.dbId);

      return this.gateway.read();
    });
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
      this.tables.forEach((table) => table.cache.clear());
      this.transactionEnabled = false;
    }
  }

  commit(table: T[number]): void {
    this.gateway.table(table.name, table.dbId);

    const cache = table.cache;

    table.lock(this.cache, this.Utilities);

    try {
      const records = new SheetRecords(
        this.gateway.read(),
        table.primaryKey as string,
      );

      if (!cache.hasExsist()) {
        cache.setExsist(records);
      }

      while (cache.hasNext()) {
        const command = cache.next();
        command.execute(records);
      }
    } finally {
      table.releaseLock();
    }
  }

  rollback(table: T[number]): void {
    const cache = table.cache;

    if (!cache.hasExsist()) {
      return;
    }

    table.lock(this.cache, this.Utilities);

    try {
      this.gateway.table(table.name, table.dbId);
      this.gateway.rewrite(cache.getExsist());
    } finally {
      table.releaseLock();
    }
  }

  migrate() {
    for (const table of this.tables) {
      const columns = table.schema.keyof().options;

      table.lock(this.cache, this.Utilities);

      try {
        this.gateway.setColumns(table.dbId, table.name, columns);
      } finally {
        table.releaseLock();
      }
    }
  }

  seed<U extends T[number]["name"]>(
    tableName: U,
    datas: z.infer<TableByName<T, U>["schema"]>[],
  ) {
    this.table(tableName);

    this.gateway.table(this._table.name, this._table.dbId);

    this._table.lock(this.cache, this.Utilities);

    try {
      if (this.gateway.count() > 0) {
        console.error(`Table '${tableName}' is not empty. Seed failed.`);

        return;
      }

      this.gateway.insert(datas);
    } finally {
      this._table.releaseLock();
    }
  }

  protect() {
    for (const table of this.tables) {
      this.gateway.table(table.name, table.dbId);
      this.gateway.protect();
    }

    return;
  }
}
