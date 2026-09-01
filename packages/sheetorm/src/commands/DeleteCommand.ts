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
    if (!exsist) {
      throw new Error("Exsist data is required for delete");
    }
    this.gateway.table(this.table.name, this.table.dbId);
    const previousRecords = exsist.getValues();
    this.pkValues.forEach((pkValue) => exsist.remove(pkValue));
    this.table.lock(this.Cache, this.Utilities);
    this.gateway.rewrite(exsist.getValues(), previousRecords);
    const relations = this.table.getRelationTree();
    if (relations.length === 0) {
      this.table.releaseLock();
      return;
    }

    const uniqueChildren = new Map<string, Relationable<any>>();
    relations.forEach((relation) => {
      const key = `${relation.childTable.dbId}:${relation.childTable.name}`;
      if (!uniqueChildren.has(key)) {
        uniqueChildren.set(key, relation.childTable);
      }
    });

    const orderedChildren = Array.from(uniqueChildren.values()).sort((a, b) => {
      const aKey = `${a.dbId}:${a.name}`;
      const bKey = `${b.dbId}:${b.name}`;
      return aKey.localeCompare(bKey);
    });

    orderedChildren.forEach((table) => table.lock(this.Cache, this.Utilities));

    try {
      for (const relation of relations) {
        this.gateway.table(relation.childTable.name, relation.childTable.dbId);
        const childRecords = this.gateway.read();
        const deletedChildRecords = relation.delete(
          childRecords,
          this.pkValues,
        );
        this.gateway.rewrite(deletedChildRecords, childRecords);
      }
    } finally {
      orderedChildren
        .slice()
        .reverse()
        .forEach((table) => table.releaseLock());
    }
  }
}
