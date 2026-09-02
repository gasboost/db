import { z, ZodObject, ZodRawShape } from "zod";
import { SheetCache } from "../storage/SheetCache";
import { Relationable } from "./Relationable";
import { OnDeleteAction, SheetRelation } from "./SheetRelation";

export type AutoNumberingMode = "increment" | "uuid";

export type Columns<Z extends ZodObject<any>> = keyof z.infer<Z>;

export class SheetTable<
  N extends string,
  Z extends ZodObject<ZodRawShape>,
> implements Relationable<Z> {
  public readonly autoIncrement: boolean;
  public readonly autoNumberingMode: AutoNumberingMode | null = null;
  public readonly cache: SheetCache;
  private lockToken: string | null = null;
  private lockHeld = false;
  private lockKey: string | null = null;
  private cacheRef: GoogleAppsScript.Cache.Cache | null = null;
  public readonly versionColumn: Columns<Z> | null = null;
  constructor(
    public readonly dbId: string,
    public readonly name: N,
    public readonly schema: Z,
    public readonly primaryKey: Columns<Z>,
    autoIncrement: boolean,
    options?: {
      versionColumn?: Columns<Z>;
      autoNumberingMode?: AutoNumberingMode;
    },
    private relations: SheetRelation[] = [],
  ) {
    const pkField = this.schema.shape[primaryKey as string];
    const isNumber = pkField._zod.def.type === "number";
    const isString = pkField._zod.def.type === "string";
    const autoNumberingMode = options?.autoNumberingMode ?? "increment";
    if (!autoIncrement && options?.autoNumberingMode) {
      throw new Error(
        `Auto numbering mode '${options.autoNumberingMode}' requires autoIncrement to be enabled.`,
      );
    }
    if (autoIncrement && autoNumberingMode === "increment" && !isNumber) {
      throw new Error(
        `Primary key field '${primaryKey as string}' must be a number to use auto-increment.`,
      );
    }
    if (autoIncrement && autoNumberingMode === "uuid" && !isString) {
      throw new Error(
        `Primary key field '${primaryKey as string}' must be a string to use uuid auto-numbering.`,
      );
    }
    this.autoIncrement = autoIncrement;
    this.autoNumberingMode = autoIncrement ? autoNumberingMode : null;
    this.cache = new SheetCache();
    if (options?.versionColumn) {
      const versionField = this.schema.shape[options.versionColumn as string];
      if (!versionField) {
        throw new Error(
          `Version column '${options.versionColumn as string}' does not exist in schema.`,
        );
      }
      if (versionField._zod.def.type !== "number") {
        throw new Error(
          `Version column '${options.versionColumn as string}' must be a number.`,
        );
      }
      this.versionColumn = options.versionColumn;
    }
  }

  setDbId(dbId: string) {
    (this as any).dbId = dbId;
  }

  reference<K extends keyof z.infer<Z>, L extends ZodObject<ZodRawShape>>(
    foreignKey: K,
    referenceTable: SheetTable<any, L>,
    referenceColumn: Columns<L>,
    onDelete: OnDeleteAction,
  ): this {
    referenceTable.addRelation(
      new SheetRelation(
        referenceColumn as string,
        this,
        foreignKey as string,
        onDelete,
      ),
    );
    return this;
  }

  private addRelation(relation: SheetRelation) {
    this.relations.push(relation);
  }

  getRelationTree(visited = new Set<SheetTable<any, any>>()): SheetRelation[] {
    if (visited.has(this)) return [];
    visited.add(this);

    const result: SheetRelation[] = [];

    for (const rel of this.relations) {
      result.push(rel);

      const child = rel.childTable;
      result.push(...child.getRelationTree(visited));
    }

    return result;
  }

  getChildren(): readonly SheetRelation[] {
    return this.relations;
  }

  lock(
    cache: GoogleAppsScript.Cache.Cache,
    utilities: GoogleAppsScript.Utilities.Utilities,
  ): void {
    const lockKey = `${this.dbId}:${this.name}`;
    const waitTimeoutMs = 300000;
    const pollIntervalMs = 200;
    const start = Date.now();
    if (this.lockHeld && this.lockToken && this.cacheRef && this.lockKey) {
      const existing = this.cacheRef.get(this.lockKey);
      if (existing === this.lockToken) {
        return;
      }
      this.lockToken = null;
      this.lockHeld = false;
      this.lockKey = null;
      this.cacheRef = null;
    }

    const ownerToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    while (true) {
      const lock = cache.get(lockKey);
      if (!lock) {
        cache.put(lockKey, ownerToken, 300);
        const confirmed = cache.get(lockKey);
        if (confirmed === ownerToken) break;
      }

      if (Date.now() - start > waitTimeoutMs) {
        throw new Error(`${this.name} cache lock timeout (${waitTimeoutMs}ms)`);
      }

      utilities.sleep(pollIntervalMs);
    }

    this.lockHeld = true;
    this.lockToken = ownerToken;
    this.lockKey = lockKey;
    this.cacheRef = cache;
  }

  releaseLock(): void {
    if (!this.lockHeld) return;

    if (
      this.lockToken &&
      this.cacheRef &&
      this.lockKey &&
      this.cacheRef.get(this.lockKey) === this.lockToken
    ) {
      this.cacheRef.remove(this.lockKey);
    }
    this.lockToken = null;
    this.lockHeld = false;
    this.lockKey = null;
    this.cacheRef = null;
  }

  validate(record: Record<string, any>) {
    const parsed = this.schema.safeParse(record);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${parsed.error.message}`);
    }
  }

  getUniqueColumns() {
    const uniqueColmuns: string[] = [];
    Object.entries(this.schema.shape).forEach(([key, field]) => {
      const meta = z.globalRegistry.get(field);
      if (meta?.unique === true) {
        uniqueColmuns.push(key);
      }
    });
    return uniqueColmuns;
  }

  hasOptimisticLock(): boolean {
    return this.versionColumn !== null;
  }
}
