import { Relationable } from "../core/Relationable";
import { SheetRecords } from "../core/SheetRecords";
import { SheetTable } from "../core/SheetTable";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
import type { WriteAuthorization } from "./WriteCommand";
import { WriteCommand } from "./WriteCommand";

export class DeleteCommand extends WriteCommand {
  constructor(
    table: SheetTable<any, any>,
    gateway: AccessableDataStore,
    CacheService: GoogleAppsScript.Cache.CacheService,
    Utilities: GoogleAppsScript.Utilities.Utilities,
    authorization: WriteAuthorization,
    private pkValues: any[],
    private transactionEnabled = false,
  ) {
    super(gateway, table, CacheService, Utilities, authorization);
  }

  execute(_exsist: SheetRecords): void {
    const affectedTables = new Map<string, Relationable<any>>();

    const collectTables = (
      table: Relationable<any>,
      visited: Set<string>,
    ): void => {
      const tableKey = `${table.dbId}:${table.name}`;

      if (visited.has(tableKey)) {
        return;
      }

      visited.add(tableKey);
      affectedTables.set(tableKey, table);

      for (const relation of table.getChildren()) {
        collectTables(relation.childTable, visited);
      }
    };

    collectTables(this.table, new Set());

    const orderedTables = Array.from(affectedTables.values()).sort(
      (left, right) => {
        const leftKey = `${left.dbId}:${left.name}`;

        const rightKey = `${right.dbId}:${right.name}`;

        return leftKey.localeCompare(rightKey);
      },
    );

    orderedTables.forEach((table) => table.lock(this.Cache, this.Utilities));

    try {
      const loaded = this.gateway.readMany(
        orderedTables.map((table) => ({
          dbId: table.dbId,
          sheetName: table.name,
        })),
      );

      const originalRecords = new Map<string, Record<string, any>[]>();

      const currentRecords = new Map<string, Record<string, any>[]>();

      const locatedRecords = new Map<string, SheetRecords>();

      const updatedRecords = new Map<string, Map<any, Record<string, any>>>();

      const deletedPrimaryKeys = new Map<string, Set<any>>();

      for (const table of orderedTables) {
        const tableKey = `${table.dbId}:${table.name}`;

        const records = loaded.get(tableKey) ?? [];

        originalRecords.set(tableKey, records);

        currentRecords.set(
          tableKey,
          records.map((record) => ({
            ...record,
          })),
        );

        const sheetTable = table as SheetTable<any, any>;

        const located = new SheetRecords(
          records,
          sheetTable.primaryKey as string,
        );

        locatedRecords.set(tableKey, located);

        if (this.transactionEnabled && !sheetTable.cache.hasExsist()) {
          sheetTable.cache.setExsist(
            new SheetRecords(records, sheetTable.primaryKey as string),
          );
        }
      }

      const rootKey = `${this.table.dbId}:${this.table.name}`;

      const rootRecords = currentRecords.get(rootKey) ?? [];

      const targetRecords = rootRecords.filter((record) =>
        this.pkValues.includes(record[this.table.primaryKey as string]),
      );

      const deleteRecords = (
        table: Relationable<any>,
        targets: Record<string, any>[],
        visitedTargets: Set<string>,
      ): void => {
        if (targets.length === 0) {
          return;
        }

        const tableKey = `${table.dbId}:${table.name}`;

        const targetPrimaryKeys = targets.map(
          (record) => record[table.primaryKey as string],
        );

        const visitKey = `${tableKey}:${JSON.stringify(
          [...targetPrimaryKeys].sort(),
        )}`;

        if (visitedTargets.has(visitKey)) {
          return;
        }

        const nextVisitedTargets = new Set(visitedTargets);

        nextVisitedTargets.add(visitKey);

        for (const relation of table.getChildren()) {
          const parentKeyValues = targets
            .map((record) => record[relation.parentKey])
            .filter((value) => value !== null && value !== undefined);

          if (parentKeyValues.length === 0) {
            continue;
          }

          const childTable = relation.childTable;

          const childTableKey = `${childTable.dbId}:${childTable.name}`;

          const childRecords = currentRecords.get(childTableKey) ?? [];

          const relatedChildren = childRecords.filter((record) =>
            parentKeyValues.includes(record[relation.childKey]),
          );

          if (relatedChildren.length === 0) {
            continue;
          }

          if (relation.onDelete === "restrict") {
            throw new Error(
              `Delete restricted by relation '${childTable.name}.${relation.childKey}'.`,
            );
          }

          if (relation.onDelete === "cascade") {
            this.authorization.ensureDelete(
              childTable as SheetTable<any, any>,
              relatedChildren,
            );

            deleteRecords(childTable, relatedChildren, nextVisitedTargets);

            continue;
          }

          if (relation.onDelete === "set null") {
            const nextRelatedChildren = relatedChildren.map((record) => ({
              ...record,
              [relation.childKey]: null,
            }));

            this.authorization.ensureUpdate(
              childTable as SheetTable<any, any>,
              relatedChildren,
              nextRelatedChildren,
            );

            let changes = updatedRecords.get(childTableKey);

            if (!changes) {
              changes = new Map();

              updatedRecords.set(childTableKey, changes);
            }

            for (const record of nextRelatedChildren) {
              changes.set(record[childTable.primaryKey as string], record);
            }

            const nextByPrimaryKey = new Map(
              nextRelatedChildren.map((record) => [
                record[childTable.primaryKey as string],
                record,
              ]),
            );

            currentRecords.set(
              childTableKey,
              childRecords.map((record) => {
                const next = nextByPrimaryKey.get(
                  record[childTable.primaryKey as string],
                );

                return next ?? record;
              }),
            );
          }
        }

        let deleted = deletedPrimaryKeys.get(tableKey);

        if (!deleted) {
          deleted = new Set();

          deletedPrimaryKeys.set(tableKey, deleted);
        }

        targetPrimaryKeys.forEach((primaryKey) => deleted!.add(primaryKey));

        const latestRecords = currentRecords.get(tableKey) ?? [];

        currentRecords.set(
          tableKey,
          latestRecords.filter(
            (record) =>
              !targetPrimaryKeys.includes(record[table.primaryKey as string]),
          ),
        );
      };

      deleteRecords(this.table, targetRecords, new Set());

      for (const table of orderedTables) {
        const tableKey = `${table.dbId}:${table.name}`;

        const sheetTable = table as SheetTable<any, any>;

        const located = locatedRecords.get(tableKey)!;

        const deleted = deletedPrimaryKeys.get(tableKey) ?? new Set<any>();

        const changes = updatedRecords.get(tableKey);

        if (changes !== undefined && changes.size > 0) {
          const survivingUpdates = Array.from(changes.values()).filter(
            (record) => !deleted.has(record[sheetTable.primaryKey as string]),
          );

          if (survivingUpdates.length > 0) {
            this.gateway.table(table.name, table.dbId);

            this.gateway.update(
              survivingUpdates,
              located,
              sheetTable.primaryKey as string,
            );
          }
        }

        if (deleted.size > 0) {
          this.gateway.table(table.name, table.dbId);

          this.gateway.delete(
            Array.from(deleted),
            located,
            sheetTable.primaryKey as string,
          );
        }
      }
    } finally {
      orderedTables
        .slice()
        .reverse()
        .forEach((table) => table.releaseLock());
    }
  }
}
