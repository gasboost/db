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
  ) {
    super(gateway, table, CacheService, Utilities);
  }

  execute(exsist: SheetRecords): void {
    const originalRecords = new Map<string, Record<string, any>[]>();
    const currentRecords = new Map<string, Record<string, any>[]>();
    const affectedTables = new Map<string, Relationable<any>>();

    const rootKey = `${this.table.dbId}:${this.table.name}`;
    const rootRecords = exsist.getValues();

    originalRecords.set(rootKey, rootRecords);
    currentRecords.set(rootKey, rootRecords);
    affectedTables.set(rootKey, this.table);

    const deleteRecords = (
      table: Relationable<any>,
      targets: Record<string, any>[],
      visited: Set<string>,
    ): void => {
      const tableKey = `${table.dbId}:${table.name}`;

      if (visited.has(tableKey)) {
        return;
      }

      const nextVisited = new Set(visited);
      nextVisited.add(tableKey);

      affectedTables.set(tableKey, table);

      for (const relation of table.getChildren()) {
        const parentKeyValues = targets
          .map((record) => record[relation.parentKey])
          .filter((value) => value !== null && value !== undefined);

        if (parentKeyValues.length === 0) {
          continue;
        }

        const childTable = relation.childTable;
        const childTableKey = `${childTable.dbId}:${childTable.name}`;

        affectedTables.set(childTableKey, childTable);

        if (!currentRecords.has(childTableKey)) {
          this.gateway.table(childTable.name, childTable.dbId);

          const records = this.gateway.read();

          originalRecords.set(childTableKey, records);
          currentRecords.set(childTableKey, records);
        }

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
          deleteRecords(childTable, relatedChildren, nextVisited);
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

      const targetPrimaryKeys = targets.map(
        (record) => record[table.primaryKey as string],
      );

      currentRecords.set(
        tableKey,
        latestRecords.filter(
          (record) =>
            !targetPrimaryKeys.includes(record[table.primaryKey as string]),
        ),
      );
    };

    const targetRecords = rootRecords.filter((record) =>
      this.pkValues.includes(record[this.table.primaryKey as string]),
    );

    deleteRecords(this.table, targetRecords, new Set());

    const orderedTables = Array.from(affectedTables.values()).sort((a, b) => {
      const aKey = `${a.dbId}:${a.name}`;
      const bKey = `${b.dbId}:${b.name}`;

      return aKey.localeCompare(bKey);
    });

    orderedTables.forEach((table) => table.lock(this.Cache, this.Utilities));

    try {
      for (const table of orderedTables) {
        const tableKey = `${table.dbId}:${table.name}`;

        const previous = originalRecords.get(tableKey);
        const next = currentRecords.get(tableKey);

        if (!previous || !next) {
          continue;
        }

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
