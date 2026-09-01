import { z, ZodObject, ZodRawShape } from "zod";
import { CacheLike, UtilitiesLike } from "./RuntimeTypes";
import {
  OnDeleteAction,
  registerRelation,
  SheetRelation,
} from "./SheetRelation";

export type AutoNumberingMode = "increment" | "uuid";

export type Columns<Z extends ZodObject<any>> = keyof z.infer<Z>;

type CompatibleColumns<
  Z extends ZodObject<any>,
  Value,
> = {
  [K in Columns<Z>]: [NonNullable<z.infer<Z>[K]>] extends [NonNullable<Value>]
    ? [NonNullable<Value>] extends [NonNullable<z.infer<Z>[K]>]
      ? K
      : never
    : never;
}[Columns<Z>];

type NullableColumns<Z extends ZodObject<any>> = {
  [K in Columns<Z>]: null extends z.infer<Z>[K] ? K : never;
}[Columns<Z>];

export class SheetTable<N extends string, Z extends ZodObject<ZodRawShape>> {
  public readonly autoIncrement: boolean;
  public readonly autoNumberingMode: AutoNumberingMode | null = null;

  private lockToken: string | null = null;
  private lockHeld = false;
  private lockDepth = 0;
  private lockKey: string | null = null;
  private cacheRef: CacheLike | null = null;
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

  reference<
    K extends Columns<Z>,
    RN extends string,
    RZ extends ZodObject<ZodRawShape>,
  >(
    foreignKey: K,
    referenceTable: SheetTable<RN, RZ>,
    referenceColumn: CompatibleColumns<RZ, z.infer<Z>[K]>,
    onDelete: Exclude<OnDeleteAction, "set null">,
  ): this;
  reference<
    K extends NullableColumns<Z>,
    RN extends string,
    RZ extends ZodObject<ZodRawShape>,
  >(
    foreignKey: K,
    referenceTable: SheetTable<RN, RZ>,
    referenceColumn: CompatibleColumns<RZ, z.infer<Z>[K]>,
    onDelete: "set null",
  ): this;
  reference<
    RN extends string,
    RZ extends ZodObject<ZodRawShape>,
  >(
    foreignKey: Columns<Z>,
    referenceTable: SheetTable<RN, RZ>,
    referenceColumn: Columns<RZ>,
    onDelete: OnDeleteAction,
  ): this {
    registerRelation(
      new SheetRelation(
        this as SheetTable<string, any>,
        foreignKey as string,
        referenceTable as SheetTable<string, any>,
        referenceColumn as string,
        onDelete,
      ),
    );
    return this;
  }

  lock(cache: CacheLike, utilities: UtilitiesLike): void {
    const lockKey = `${this.dbId}:${this.name}`;
    const waitTimeoutMs = 300000;
    const pollIntervalMs = 200;
    const start = Date.now();
    if (this.lockHeld && this.lockToken && this.cacheRef && this.lockKey) {
      const existing = this.cacheRef.get(this.lockKey);
      if (existing === this.lockToken) {
        this.lockDepth += 1;
        return;
      }
      this.lockToken = null;
      this.lockHeld = false;
      this.lockDepth = 0;
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
    this.lockDepth = 1;
    this.lockToken = ownerToken;
    this.lockKey = lockKey;
    this.cacheRef = cache;
  }

  releaseLock(): void {
    if (!this.lockHeld) return;
    if (this.lockDepth > 1) {
      this.lockDepth -= 1;
      return;
    }

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
    this.lockDepth = 0;
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
