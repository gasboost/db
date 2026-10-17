import { z } from "zod";
import { SheetRecords } from "../core/SheetRecords";
import { SheetTable } from "../core/SheetTable";
import { AccessableDataStore } from "../gateway/AccessableDataStore";
import type { WriteAuthorization } from "./WriteCommand";
import { WriteCommand } from "./WriteCommand";

export class UpdateCommand<Z extends z.ZodObject<any>> extends WriteCommand {
  constructor(
    table: SheetTable<any, Z>,
    gateway: AccessableDataStore,
    CacheService: GoogleAppsScript.Cache.CacheService,
    Utilities: GoogleAppsScript.Utilities.Utilities,
    private records: z.output<Z>[],
    authorization: WriteAuthorization,
  ) {
    super(gateway, table, CacheService, Utilities, authorization);
  }

  preview(exsist: SheetRecords): z.output<Z>[] {
    const uniqueValues = exsist.uniqueValues(this.table.getUniqueColumns());

    const updatedRecords = this.records.map((record) => ({
      ...record,
    }));

    updatedRecords.forEach((record) => {
      this.table.validate(record);

      uniqueValues.forEach((uniqueMap, columnName) => {
        uniqueMap.delete(record[this.table.primaryKey as string]);

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

        uniqueMap.set(
          record[this.table.primaryKey as string],
          record[columnName],
        );
      });

      if (this.table.hasOptimisticLock()) {
        const versionColumn = this.table.versionColumn as string;

        const previous = exsist.getRecord(
          record[this.table.primaryKey as string],
        );

        if (!previous) {
          throw new Error(
            `Record with primary key ${
              record[this.table.primaryKey as string]
            } does not exist for optimistic locking.`,
          );
        }

        const previousVersion = previous[versionColumn];

        if (record[versionColumn] !== previousVersion) {
          throw new Error(
            `Optimistic lock error: expected version ${previousVersion} but got ${record[versionColumn]}`,
          );
        }

        const currentRecord = record as Record<string, any>;

        currentRecord[versionColumn] = previousVersion + 1;
      }

      exsist.replace(record);
    });

    return updatedRecords;
  }

  public execute(exsist: SheetRecords): z.output<Z>[] {
    this.gateway.table(this.table.name, this.table.dbId);

    const release = this.table.holdLock(this.Cache, this.Utilities);

    try {
      const currentRecords = exsist.getValues();
      const beforeByKey = new Map(
        currentRecords.map((record) => [
          record[this.table.primaryKey as string],
          record,
        ]),
      );

      const updatedRecords = this.preview(exsist);

      this.authorization.ensureUpdate(
        this.table,
        currentRecords,
        updatedRecords,
      );

      this.gateway.update(
        updatedRecords,
        exsist,
        this.table.primaryKey as string,
      );

      for (const record of updatedRecords) {
        this.changed(
          this.table,
          beforeByKey.get(record[this.table.primaryKey as string]) ?? null,
          record,
        );
      }
      return updatedRecords;
    } finally {
      release();
    }
  }
}
