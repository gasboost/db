import { Query, QueryEvaluation } from "@gasboost/query";
import type { PredicateExpression, RowLevelSecurity } from "@gasboost/rls";
import { ZodObject, z } from "zod";
import { CreateCommand } from "../commands/CreateCommand";
import { DeleteCommand } from "../commands/DeleteCommand";
import { UpdateCommand } from "../commands/UpdateCommand";
import {
  RecordWithRelations,
  WriteAuthorization,
} from "../commands/WriteCommand";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
import { Relationable, TableByName } from "./Relationable";
import {
  RowLevelSecurityEvaluator,
  RowLevelSecurityRecord,
} from "./RowLevelSecurityEvaluator";
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
> = CreateRecord<Z> & {
  relations?: CreateRelations<T>;
};

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
  principal?: Record<string, unknown>;
  rowLevelSecurity?: readonly RowLevelSecurity<T[number]>[];
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
  private readonly authorization: WriteAuthorization;

  public readonly principal: Record<string, unknown>;

  public readonly rowLevelSecurity: readonly RowLevelSecurity<T[number]>[];

  public readonly rls: RowLevelSecurityEvaluator;

  constructor(config: SheetDBConfig<T>) {
    this.tables = config.tables;
    this.gateway = config.gateway;
    this.CacheService = config.cacheService;
    this.Utilities = config.utilities;

    this._table = this.tables[0] as TableByName<T, N>;

    this.cache = this.CacheService.getScriptCache();

    this.principal = config.principal ?? {};

    this.rowLevelSecurity = config.rowLevelSecurity ?? [];

    this.rls = new RowLevelSecurityEvaluator({
      principal: this.principal,
      policies: this.rowLevelSecurity,
      load: (tableName) => this.loadRaw(tableName),
    });

    this.authorization = {
      ensureInsert: (table, records) => {
        this.rls.ensureInsert(table, records);
      },

      ensureUpdate: (table, currentRecords, nextRecords) => {
        this.rls.ensureUpdate({
          table,
          currentRecords,
          nextRecords,
          primaryKey: table.primaryKey as string,
        });
      },

      ensureDelete: (table, records) => {
        this.rls.ensureDelete(table, records);
      },
    };
  }

  public table<U extends T[number]["name"]>(name: U): SheetDB<T, U> {
    const table = this.tables.find(
      (candidate): candidate is TableByName<T, U> => candidate.name === name,
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
      this.authorization,
    );

    const records = command.getDiff();

    this.rls.ensureInsert(this._table, records as RowLevelSecurityRecord[]);

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
      this.authorization,
    );

    this.gateway.table(this._table.name, this._table.dbId);

    const currentRecords = this.gateway.read();

    const previewRecords = new SheetRecords(
      currentRecords,
      this._table.primaryKey as string,
    );

    const updatedRecords = command.preview(previewRecords);

    this.rls.ensureUpdate({
      table: this._table,
      currentRecords,
      nextRecords: updatedRecords,
      primaryKey: this._table.primaryKey as string,
    });

    if (this.transactionEnabled) {
      this._table.cache.add(command);

      return updatedRecords;
    }

    try {
      const executionRecords = new SheetRecords(
        currentRecords,
        this._table.primaryKey as string,
      );

      return command.execute(executionRecords);
    } finally {
      this._table.releaseLock();
    }
  }

  public upsert(records: CurrentRecord<T, N>[]): CurrentRecord<T, N>[] {
    this.gateway.table(this._table.name, this._table.dbId);

    const currentRecords = this.gateway.read();

    const exsist = new SheetRecords(
      currentRecords,
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
      const primaryKeyValue = record[this._table.primaryKey as string];

      if (isEmptyPrimaryKey(primaryKeyValue)) {
        if (!this._table.autoNumbering) {
          throw new Error("Primary key is required for upsert.");
        }

        delete record[this._table.primaryKey as string];

        createIndexes.push(index);

        createParams.push(record);

        return;
      }

      const existing = exsist.getRecord(primaryKeyValue);

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
            this.authorization,
          )
        : null;

    let updatedRecords: CurrentRecord<T, N>[] = [];

    if (updateCommand) {
      const previewRecords = new SheetRecords(
        currentRecords,
        this._table.primaryKey as string,
      );

      updatedRecords = updateCommand.preview(previewRecords) as CurrentRecord<
        T,
        N
      >[];

      this.rls.ensureUpdate({
        table: this._table,
        currentRecords,
        nextRecords: updatedRecords,
        primaryKey: this._table.primaryKey as string,
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
            this.authorization,
          )
        : null;

    let createdRecords: CurrentRecord<T, N>[] = [];

    if (createCommand) {
      createdRecords = createCommand.getDiff() as CurrentRecord<T, N>[];

      this.rls.ensureInsert(
        this._table,
        createdRecords as RowLevelSecurityRecord[],
      );
    }

    if (this.transactionEnabled) {
      if (updateCommand) {
        updatedRecords.forEach((record, index) => {
          resultRecords[updateIndexes[index]] = record;
        });

        this._table.cache.add(updateCommand);
      }

      if (createCommand) {
        createdRecords.forEach((record, index) => {
          resultRecords[createIndexes[index]] = record;
        });

        this._table.cache.add(createCommand);
      }

      return resultRecords;
    }

    try {
      if (updateCommand) {
        const executionRecords = new SheetRecords(
          currentRecords,
          this._table.primaryKey as string,
        );

        const executedRecords = updateCommand.execute(executionRecords);

        executedRecords.forEach((record, index) => {
          resultRecords[updateIndexes[index]] = record as CurrentRecord<T, N>;
        });
      }

      if (createCommand) {
        this.gateway.table(this._table.name, this._table.dbId);

        const createExistingRecords = new SheetRecords(
          this.gateway.read(),
          this._table.primaryKey as string,
        );

        createCommand.execute(createExistingRecords);

        const executedRecords = createCommand.getDiff() as CurrentRecord<
          T,
          N
        >[];

        executedRecords.forEach((record, index) => {
          resultRecords[createIndexes[index]] = record;
        });
      }

      return resultRecords;
    } finally {
      this._table.releaseLock();
    }
  }

  public delete(primaryKeyValues: any[]): boolean {
    this.gateway.table(this._table.name, this._table.dbId);

    const currentRecords = this.gateway.read();

    const primaryKey = this._table.primaryKey as string;

    const targetRecords = currentRecords.filter((record) =>
      primaryKeyValues.includes(record[primaryKey]),
    );

    this.rls.ensureDelete(this._table, targetRecords);

    const command = new DeleteCommand(
      this._table,
      this.gateway,
      this.CacheService,
      this.Utilities,
      this.authorization,
      primaryKeyValues,
      this.transactionEnabled,
    );

    if (this.transactionEnabled) {
      this._table.cache.add(command);

      return true;
    }

    try {
      const records = new SheetRecords(currentRecords, primaryKey);

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
    const tableNames =
      query === undefined
        ? new Set<string>([this._table.name])
        : this.collectQueryTableNames(query);

    this.collectRowLevelSecurityTableNames(tableNames);

    const tables = Array.from(tableNames).map((tableName) => {
      const table = this.tables.find(
        (candidate) => candidate.name === tableName,
      );

      if (!table) {
        throw new Error(`Table '${tableName}' not found.`);
      }

      return table;
    });

    const loaded = this.gateway.readMany(
      tables.map((table) => ({
        dbId: table.dbId,
        sheetName: table.name,
      })),
    );

    const recordsByTable = new Map<string, RowLevelSecurityRecord[]>();

    for (const table of tables) {
      recordsByTable.set(
        table.name,
        loaded.get(`${table.dbId}:${table.name}`) ?? [],
      );
    }

    const rowLevelSecurity = new RowLevelSecurityEvaluator({
      principal: this.principal,
      policies: this.rowLevelSecurity,
      load: (tableName) => {
        const records = recordsByTable.get(tableName);

        if (records === undefined) {
          throw new Error(`Table '${tableName}' was not loaded.`);
        }

        return records;
      },
    });

    if (query === undefined) {
      return rowLevelSecurity.read(this._table);
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
      const table = this.tables.find(
        (candidate) => candidate.name === tableName,
      );

      if (!table) {
        throw new Error(`Table '${tableName}' not found.`);
      }

      return rowLevelSecurity.read(table);
    });
  }

  public transaction<R>(fn: () => R): R {
    this.transactionEnabled = true;

    try {
      const result = fn();

      this.tables.forEach((table) => this.commit(table));

      return result;
    } catch (error) {
      this.tables.forEach((table) => this.rollback(table));

      throw error;
    } finally {
      this.tables.forEach((table) => table.cache.clear());

      this.transactionEnabled = false;
    }
  }

  public commit(table: T[number]): void {
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

  public rollback(table: T[number]): void {
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

  public migrate(): void {
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

  public seed<U extends T[number]["name"]>(
    tableName: U,
    datas: z.infer<TableByName<T, U>["schema"]>[],
  ): void {
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

  public protect(): void {
    for (const table of this.tables) {
      this.gateway.table(table.name, table.dbId);

      this.gateway.protect();
    }
  }

  public loadRaw(tableName: string): RowLevelSecurityRecord[] {
    const table = this.tables.find((candidate) => candidate.name === tableName);

    if (!table) {
      throw new Error(`Table '${tableName}' not found.`);
    }

    this.gateway.table(table.name, table.dbId);

    return this.gateway.read();
  }

  private collectQueryTableNames(
    query: Query<T, any>,
    tableNames = new Set<string>(),
  ): Set<string> {
    tableNames.add(query.tableName);

    for (const join of query.joins) {
      tableNames.add(join.table);

      if (join.query !== null) {
        this.collectQueryTableNames(join.query, tableNames);
      }
    }

    return tableNames;
  }

  private collectRowLevelSecurityTableNames(tableNames: Set<string>): void {
    let previousSize = -1;

    while (previousSize !== tableNames.size) {
      previousSize = tableNames.size;

      for (const tableName of Array.from(tableNames)) {
        const policy = this.rowLevelSecurity.find(
          (candidate) => candidate.table.name === tableName,
        );

        if (policy?.select === null || policy?.select === undefined) {
          continue;
        }

        this.collectPredicateTableNames(policy.select.using, tableNames);
      }
    }
  }

  private collectPredicateTableNames(
    expression: PredicateExpression,
    tableNames: Set<string>,
  ): void {
    switch (expression.type) {
      case "allow":
      case "eq":
        return;

      case "and":
      case "or":
        for (const condition of expression.conditions) {
          this.collectPredicateTableNames(condition, tableNames);
        }

        return;

      case "exists":
        tableNames.add(expression.table.name);

        this.collectPredicateTableNames(expression.condition, tableNames);

        return;
    }
  }
}
