import { ZodObject } from "zod";
import { SheetRelation } from "./SheetRelation";
import { Columns, SheetTable } from "./SheetTable";

export interface Relationable<Z extends ZodObject<any>> {
  readonly dbId: string;
  readonly name: string;
  readonly schema: Z;
  readonly primaryKey: Columns<Z>;
  lock(
    cache: GoogleAppsScript.Cache.Cache,
    utilities: GoogleAppsScript.Utilities.Utilities,
  ): void;
  releaseLock(): void;
  getRelationTree(visited?: Set<SheetTable<any, any>>): SheetRelation[];
}
