import { SheetRecords } from "../core/SheetRecords";
import { SheetTable } from "../core/SheetTable";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
import { WriteCommand } from "./WriteCommand";

type CreateParams = Record<string, any> & {
  relations?: Partial<Record<string, Record<string, any>[]>>;
};

export class CreateCommand extends WriteCommand {
  private diff: Record<string, any>[] = [];
  private relationParams: Partial<Record<string, Record<string, any>[]>>[] = [];
  constructor(
    gateway: AccessableDataStore,
    table: SheetTable<any, any>,
    CacheService: GoogleAppsScript.Cache.CacheService,
    Utilities: GoogleAppsScript.Utilities.Utilities,
    params: CreateParams[],
  ) {
    super(gateway, table, CacheService, Utilities);
    const normalized = params.map((param) => {
      const relations = param.relations || {};
      const record = { ...param };
      delete (record as { relations?: unknown }).relations;
      this.relationParams.push(relations);
      return record;
    });
    // 自動採番ではない時
    if (!this.table.autoIncrement) {
      this.diff = normalized;
      return;
    }

    if (this.table.autoNumberingMode === "uuid") {
      normalized.forEach((param) => {
        param[this.table.primaryKey as string] = this.Utilities.getUuid();
        this.diff.push(param);
      });
      return;
    }

    this.gateway.table(this.table.name, this.table.dbId);
    // 採番が重複しないようにロック
    this.table.lock(this.Cache, this.Utilities);

    // 今の最後のID
    let lastId: number | null = null;

    // キャッシュされている最大値キーを取得
    const autoIncrementCacheKey = `${this.table.dbId}:${this.table.name}:autoIncrement`;
    const cached = this.Cache.get(autoIncrementCacheKey);
    if (!cached) {
      // キャッシュにない＝誰も採番中じゃない＝DBのgetLastIdが唯一神
      lastId = this.gateway.lastId(this.table.primaryKey as string);
    } else {
      try {
        lastId = JSON.parse(cached)?.value;
      } catch {
        // キャッシュの値が不正な場合はDBのgetLastIdにフォールバック
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

    // 採番重複防止ロック解放
    this.table.releaseLock();

    // パラメーターにIDを振る
    normalized.forEach((param, index) => {
      param[this.table.primaryKey as string] = start + 1 + index;
      this.diff.push(param);
    });
  }

  execute(
    exsist: SheetRecords,
    options?: { skipGatewayTable?: boolean },
  ): void {
    // 差分を挿入
    if (!options?.skipGatewayTable) {
      this.gateway.table(this.table.name, this.table.dbId);
    }
    this.table.lock(this.Cache, this.Utilities);
    const uniqueValues = exsist.uniqueValues(this.table.getUniqueColumns());

    this.diff.forEach((record) => {
      this.table.validate(record);
      uniqueValues.forEach((uniqueMap, columnName) => {
        const value = record[columnName];
        if (value === null || value === undefined) return;
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
        uniqueMap.set(
          record[this.table.primaryKey as string],
          record[columnName],
        );
      });
      exsist.replace(record);
    });
    this.gateway.insert(this.diff);
    if (this.relationParams.length === 0) return;

    type RelationPayload = Partial<Record<string, Record<string, any>[]>>;
    type ChildBatch = {
      table: SheetTable<any, any>;
      params: Record<string, any>[];
      relationPayloads: RelationPayload[];
    };

    const collectBatches = (
      records: Record<string, any>[],
      relationPayloads: RelationPayload[],
      table: SheetTable<any, any>,
    ) => {
      const relationTree = table.getRelationTree();
      if (relationTree.length === 0) return new Map<string, ChildBatch>();

      const batches = new Map<string, ChildBatch>();
      records.forEach((record, index) => {
        const relationPayload = relationPayloads[index];
        if (!relationPayload) return;

        Object.entries(relationPayload).forEach(([relationName, children]) => {
          if (!children || children.length === 0) return;

          const relation = relationTree.find(
            (rel) => rel.childTable.name === relationName,
          );
          if (!relation) {
            throw new Error(`Relation '${relationName}' not found.`);
          }

          const parentKeyValue = (record as Record<string, any>)[
            relation.parentKey
          ];
          if (parentKeyValue === null || parentKeyValue === undefined) {
            throw new Error(
              `Parent key '${relation.parentKey}' is required for relation '${relationName}'.`,
            );
          }

          const childTable = relation.childTable as SheetTable<any, any>;
          const batchKey = `${childTable.dbId}:${childTable.name}`;
          if (!batches.has(batchKey)) {
            batches.set(batchKey, {
              table: childTable,
              params: [],
              relationPayloads: [],
            });
          }
          const batch = batches.get(batchKey)!;
          children.forEach((child) => {
            const childRecord = { ...child } as Record<string, any>;
            const childRelationPayload = childRecord.relations || {};
            delete (childRecord as { relations?: unknown }).relations;

            childRecord[relation.childKey] = parentKeyValue;
            batch.params.push(childRecord);
            batch.relationPayloads.push(childRelationPayload);
          });
        });
      });

      return batches;
    };

    let pendingBatches = collectBatches(
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

      orderedChildren.forEach((child) =>
        child.table.lock(this.Cache, this.Utilities),
      );

      const nextBatches = new Map<string, ChildBatch>();

      try {
        orderedChildren.forEach((child) => {
          const childTable = child.table;
          this.gateway.table(childTable.name, childTable.dbId);
          const childRecords = this.gateway.read();
          const childExsist = new SheetRecords(
            childRecords,
            childTable.primaryKey as string,
          );

          let childParams = child.params;
          if (childTable.autoIncrement) {
            if (childTable.autoNumberingMode === "uuid") {
              childParams = childParams.map((param) => ({
                ...param,
                [childTable.primaryKey as string]:
                  param[childTable.primaryKey as string] ??
                  this.Utilities.getUuid(),
              }));
            } else {
              const autoIncrementCacheKey = `${childTable.dbId}:${childTable.name}:autoIncrement`;
              const cached = this.Cache.get(autoIncrementCacheKey);
              let lastId: number | null = null;
              if (!cached) {
                lastId = this.gateway.lastId(childTable.primaryKey as string);
              } else {
                try {
                  lastId = JSON.parse(cached)?.value;
                } catch {
                  lastId = this.gateway.lastId(childTable.primaryKey as string);
                }
              }

              const start = lastId || 0;
              const end = start + childParams.length;
              const payload = JSON.stringify({
                value: end,
                token: this.Utilities.getUuid(),
              });
              this.Cache.put(autoIncrementCacheKey, payload, 300);

              childParams = childParams.map((param, index) => ({
                ...param,
                [childTable.primaryKey as string]: start + 1 + index,
              }));
            }
          }

          const uniqueValues = childExsist.uniqueValues(
            childTable.getUniqueColumns(),
          );
          childParams.forEach((record) => {
            childTable.validate(record);
            uniqueValues.forEach((uniqueMap, columnName) => {
              const value = record[columnName];
              if (value === null || value === undefined) return;
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
              uniqueMap.set(
                record[childTable.primaryKey as string],
                record[columnName],
              );
            });
            childExsist.replace(record);
          });
          this.gateway.insert(childParams);

          const childNextBatches = collectBatches(
            childParams,
            child.relationPayloads,
            childTable,
          );
          childNextBatches.forEach((batch, key) => {
            if (!nextBatches.has(key)) {
              nextBatches.set(key, batch);
              return;
            }
            const target = nextBatches.get(key)!;
            target.params.push(...batch.params);
            target.relationPayloads.push(...batch.relationPayloads);
          });
        });
      } finally {
        orderedChildren
          .slice()
          .reverse()
          .forEach((child) => child.table.releaseLock());
      }

      pendingBatches = nextBatches;
    }
  }

  getDiff() {
    if (this.relationParams.length === 0) return this.diff;

    const relationTree = this.table.getRelationTree();
    if (relationTree.length === 0) return this.diff;

    this.diff.forEach((record, index) => {
      const relationPayload = this.relationParams[index];
      if (!relationPayload) return;

      Object.entries(relationPayload).forEach(([relationName, children]) => {
        if (!children || children.length === 0) return;

        const relation = relationTree.find(
          (rel) => rel.childTable.name === relationName,
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

        record.relations ??= {};
        record.relations[relationName] = [];

        children.forEach((child) => {
          if (
            childTable.autoNumberingMode === "uuid" &&
            child[childTable.primaryKey as string] == null
          ) {
            child[childTable.primaryKey as string] = this.Utilities.getUuid();
          }

          const childRecord = {
            ...child,
            [relation.childKey]: parentKeyValue,
          };

          record.relations[relationName].push(childRecord);
        });
      });
    });

    return this.diff;
  }
}
