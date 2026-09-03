import { Relationable } from "../core/Relationable";
import { SheetRecords } from "../core/SheetRecords";
import { SheetTable } from "../core/SheetTable";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
import { WriteCommand } from "./WriteCommand";

export class DeleteCommand extends WriteCommand {
  constructor(
    table: SheetTable<any, any>,
    gateway: AccessableDataStore,
    CacheService: GoogleAppsScript.Cache.CacheService,
    Utilities: GoogleAppsScript.Utilities.Utilities,
    private pkValues: any[],
    private transactionEnabled = false,
  ) {
    super(gateway, table, CacheService, Utilities);
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

    const orderedTables = Array.from(affectedTables.values()).sort((a, b) => {
      const aKey = `${a.dbId}:${a.name}`;
      const bKey = `${b.dbId}:${b.name}`;

      return aKey.localeCompare(bKey);
    });

    orderedTables.forEach((table) => table.lock(this.Cache, this.Utilities));

    try {
      const originalRecords = new Map<string, Record<string, any>[]>();
      const currentRecords = new Map<string, Record<string, any>[]>();

      for (const table of orderedTables) {
        const tableKey = `${table.dbId}:${table.name}`;

        this.gateway.table(table.name, table.dbId);

        const records = this.gateway.read();

        originalRecords.set(tableKey, records);
        currentRecords.set(tableKey, records);

        if (this.transactionEnabled) {
          const sheetTable = table as SheetTable<any, any>;

          if (!sheetTable.cache.hasExsist()) {
            sheetTable.cache.setExsist(
              new SheetRecords(records, sheetTable.primaryKey as string),
            );
          }
        }
      }

      const rootKey = `${this.table.dbId}:${this.table.name}`;
      const rootRecords = currentRecords.get(rootKey)!;

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
          const childRecords = currentRecords.get(childTableKey)!;

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
            deleteRecords(childTable, relatedChildren, nextVisitedTargets);
            continue;
          }

          if (relation.onDelete === "set null") {
            currentRecords.set(
              childTableKey,
              childRecords.map((record) => {
                if (!parentKeyValues.includes(record[relation.childKey])) {
                  return record;
                }

                return {
                  ...record,
                  [relation.childKey]: null,
                };
              }),
            );
          }
        }

        const latestRecords = currentRecords.get(tableKey)!;

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

        const previous = originalRecords.get(tableKey)!;
        const next = currentRecords.get(tableKey)!;

        this.gateway.table(table.name, table.dbId);
        this.gateway.rewrite(next, previous);
      }
    } finally {
      orderedTables
        .slice()
        .reverse()
        .forEach((table) => table.releaseLock());
    }
  }
}
