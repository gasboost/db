import { z } from "zod";
import { SheetRecords } from "../core/SheetRecords";
import { SheetTable } from "../core/SheetTable";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
import {
  RecordWithRelations,
  WriteAuthorization,
  WriteCommand,
} from "./WriteCommand";

type RelationPayload = Partial<Record<string, Record<string, any>[]>>;

type InsertBatch = {
  table: SheetTable<any, any>;
  records: Record<string, any>[];
};

type PendingBatch = {
  table: SheetTable<any, any>;
  params: Record<string, any>[];
  relationPayloads: RelationPayload[];
};

export class CreateCommand<Z extends z.ZodObject<any>> extends WriteCommand {
  private diff: z.output<Z>[] = [];
  private relationParams: RelationPayload[] = [];

  constructor(
    gateway: AccessableDataStore,
    table: SheetTable<string, Z>,
    CacheService: GoogleAppsScript.Cache.CacheService,
    Utilities: GoogleAppsScript.Utilities.Utilities,
    params: RecordWithRelations<z.output<Z>>[],
    authorization: WriteAuthorization,
  ) {
    super(gateway, table, CacheService, Utilities, authorization);

    const normalized = params.map((param) => {
      const relations = param.relations || {};
      const record = { ...param };

      delete (record as { relations?: unknown }).relations;

      this.relationParams.push(relations);

      return record;
    });

    if (!this.table.autoNumbering) {
      this.diff = normalized;

      return;
    }

    if (this.table.autoNumbering === "uuid") {
      normalized.forEach((param) => {
        const record = param as Record<string, any>;

        record[this.table.primaryKey as string] = this.Utilities.getUuid();

        this.diff.push(param);
      });

      return;
    }

    this.gateway.table(this.table.name, this.table.dbId);

    this.table.lock(this.Cache, this.Utilities);

    let lastId: number | null = null;

    const autoIncrementCacheKey = `${this.table.dbId}:${this.table.name}:autoIncrement`;

    const cached = this.Cache.get(autoIncrementCacheKey);

    if (!cached) {
      lastId = this.gateway.lastId(this.table.primaryKey as string);
    } else {
      try {
        lastId = JSON.parse(cached)?.value;
      } catch {
        lastId = this.gateway.lastId(this.table.primaryKey as string);
      }
    }

    const start = lastId || 0;
    const end = start + normalized.length;

    const payload = JSON.stringify({
      value: end,
      token: this.Utilities.getUuid(),
    });

    this.Cache.put(autoIncrementCacheKey, payload, 300);

    this.table.releaseLock();

    normalized.forEach((param, index) => {
      const record = param as Record<string, any>;

      record[this.table.primaryKey as string] = start + 1 + index;

      this.diff.push(param);
    });
  }

  execute(
    exsist: SheetRecords,
    options?: {
      skipGatewayTable?: boolean;
    },
  ): void {
    const batches = this.buildInsertBatches(exsist, options);

    for (const batch of batches) {
      this.authorization.ensureInsert(batch.table, batch.records);
    }

    for (const batch of batches) {
      this.gateway.table(batch.table.name, batch.table.dbId);

      batch.table.lock(this.Cache, this.Utilities);

      try {
        this.gateway.insert(batch.records);
      } finally {
        batch.table.releaseLock();
      }
    }
  }

  private buildInsertBatches(
    exsist: SheetRecords,
    options?: {
      skipGatewayTable?: boolean;
    },
  ): InsertBatch[] {
    const batches: InsertBatch[] = [];

    if (!options?.skipGatewayTable) {
      this.gateway.table(this.table.name, this.table.dbId);
    }

    this.validateRecords(this.table, this.diff, exsist);

    batches.push({
      table: this.table,
      records: this.diff,
    });

    let pendingBatches = this.collectRelationBatches(
      this.diff,
      this.relationParams,
      this.table,
    );

    while (pendingBatches.size > 0) {
      const orderedChildren = Array.from(pendingBatches.values()).sort(
        (a, b) => {
          const aKey = `${a.table.dbId}:${a.table.name}`;
          const bKey = `${b.table.dbId}:${b.table.name}`;

          return aKey.localeCompare(bKey);
        },
      );

      const nextBatches = new Map<string, PendingBatch>();

      for (const child of orderedChildren) {
        const childTable = child.table;

        this.gateway.table(childTable.name, childTable.dbId);

        const childRecords = this.gateway.read();

        const childExsist = new SheetRecords(
          childRecords,
          childTable.primaryKey as string,
        );

        const childParams = this.prepareChildParams(childTable, child.params);

        this.validateRecords(childTable, childParams, childExsist);

        batches.push({
          table: childTable,
          records: childParams,
        });

        const childNextBatches = this.collectRelationBatches(
          childParams,
          child.relationPayloads,
          childTable,
        );

        childNextBatches.forEach((batch, key) => {
          const target = nextBatches.get(key);

          if (!target) {
            nextBatches.set(key, batch);

            return;
          }

          target.params.push(...batch.params);

          target.relationPayloads.push(...batch.relationPayloads);
        });
      }

      pendingBatches = nextBatches;
    }

    return batches;
  }

  private collectRelationBatches(
    records: Record<string, any>[],
    relationPayloads: RelationPayload[],
    table: SheetTable<any, any>,
  ): Map<string, PendingBatch> {
    const relationTree = table.getRelationTree();

    const batches = new Map<string, PendingBatch>();

    if (relationTree.length === 0) {
      return batches;
    }

    records.forEach((record, index) => {
      const relationPayload = relationPayloads[index];

      if (!relationPayload) {
        return;
      }

      Object.entries(relationPayload).forEach(([relationName, children]) => {
        if (!children || children.length === 0) {
          return;
        }

        const relation = relationTree.find(
          (relation) => relation.childTable.name === relationName,
        );

        if (!relation) {
          throw new Error(`Relation '${relationName}' not found.`);
        }

        const parentKeyValue = record[relation.parentKey];

        if (parentKeyValue === null || parentKeyValue === undefined) {
          throw new Error(
            `Parent key '${relation.parentKey}' is required for relation '${relationName}'.`,
          );
        }

        const childTable = relation.childTable as SheetTable<any, any>;

        const batchKey = `${childTable.dbId}:${childTable.name}`;

        let batch = batches.get(batchKey);

        if (!batch) {
          batch = {
            table: childTable,
            params: [],
            relationPayloads: [],
          };

          batches.set(batchKey, batch);
        }

        children.forEach((child) => {
          const childRecord = {
            ...child,
          } as Record<string, any>;

          const childRelationPayload = childRecord.relations || {};

          delete (
            childRecord as {
              relations?: unknown;
            }
          ).relations;

          childRecord[relation.childKey] = parentKeyValue;

          batch!.params.push(childRecord);

          batch!.relationPayloads.push(childRelationPayload);
        });
      });
    });

    return batches;
  }

  private prepareChildParams(
    table: SheetTable<any, any>,
    params: Record<string, any>[],
  ): Record<string, any>[] {
    if (!table.autoNumbering) {
      return params;
    }

    if (table.autoNumbering === "uuid") {
      return params.map((param) => ({
        ...param,
        [table.primaryKey as string]:
          param[table.primaryKey as string] ?? this.Utilities.getUuid(),
      }));
    }

    this.gateway.table(table.name, table.dbId);

    const autoIncrementCacheKey = `${table.dbId}:${table.name}:autoIncrement`;

    const cached = this.Cache.get(autoIncrementCacheKey);

    let lastId: number | null = null;

    if (!cached) {
      lastId = this.gateway.lastId(table.primaryKey as string);
    } else {
      try {
        lastId = JSON.parse(cached)?.value;
      } catch {
        lastId = this.gateway.lastId(table.primaryKey as string);
      }
    }

    const start = lastId || 0;
    const end = start + params.length;

    const payload = JSON.stringify({
      value: end,
      token: this.Utilities.getUuid(),
    });

    this.Cache.put(autoIncrementCacheKey, payload, 300);

    return params.map((param, index) => ({
      ...param,
      [table.primaryKey as string]: start + 1 + index,
    }));
  }

  private validateRecords(
    table: SheetTable<any, any>,
    records: Record<string, any>[],
    exsist: SheetRecords,
  ): void {
    const uniqueValues = exsist.uniqueValues(table.getUniqueColumns());

    records.forEach((record) => {
      table.validate(record);

      uniqueValues.forEach((uniqueMap, columnName) => {
        const value = record[columnName];

        if (value === null || value === undefined) {
          return;
        }

        if (typeof value === "string" && value.trim().length === 0) {
          return;
        }

        for (const existing of uniqueMap.values()) {
          if (existing === value) {
            throw new Error(
              `Unique constraint violation: ${columnName}=${value}`,
            );
          }
        }

        uniqueMap.set(record[table.primaryKey as string], value);
      });

      exsist.replace(record);
    });
  }

  getDiff(): z.output<Z>[] {
    if (this.relationParams.length === 0) {
      return this.diff;
    }

    const relationTree = this.table.getRelationTree();

    if (relationTree.length === 0) {
      return this.diff;
    }

    this.diff.forEach((record, index) => {
      const relationPayload = this.relationParams[index];

      if (!relationPayload) {
        return;
      }

      Object.entries(relationPayload).forEach(([relationName, children]) => {
        if (!children || children.length === 0) {
          return;
        }

        const relation = relationTree.find(
          (relation) => relation.childTable.name === relationName,
        );

        if (!relation) {
          throw new Error(`Relation '${relationName}' not found.`);
        }

        const parentKeyValue = record[relation.parentKey];

        if (parentKeyValue === null || parentKeyValue === undefined) {
          throw new Error(
            `Parent key '${relation.parentKey}' is required for relation '${relationName}'.`,
          );
        }

        const childTable = relation.childTable as SheetTable<any, any>;

        const resultRecord = record as RecordWithRelations<z.output<Z>>;

        const relations = (resultRecord.relations ??= {} as Record<
          string,
          Record<string, any>[]
        >);

        relations[relationName] = [];

        children.forEach((child) => {
          if (
            childTable.autoNumbering === "uuid" &&
            child[childTable.primaryKey as string] == null
          ) {
            child[childTable.primaryKey as string] = this.Utilities.getUuid();
          }

          const childRecord = {
            ...child,
            [relation.childKey]: parentKeyValue,
          };

          relations[relationName].push(childRecord);
        });
      });
    });

    return this.diff;
  }
}
