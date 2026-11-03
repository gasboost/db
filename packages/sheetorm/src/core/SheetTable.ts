import type { KeyedTableDefinition } from "@gasboost/table";
import { z, ZodObject, ZodRawShape } from "zod";
import { SheetCache } from "../storage/SheetCache";
import { Relationable } from "./Relationable";
import { OnDeleteAction, SheetRelation } from "./SheetRelation";

export type AutoNumberingMode = "increment" | "uuid";

export type Columns<Z extends ZodObject<any>> = Extract<
  keyof z.infer<Z>,
  string
>;

export type SheetTableConfig<
  N extends string,
  Z extends ZodObject<ZodRawShape>,
> = KeyedTableDefinition<N, Z> & {
  dbId: string;
  autoNumbering?: AutoNumberingMode;
  versionColumn?: Columns<Z>;
};

export class SheetTable<
  N extends string,
  Z extends ZodObject<ZodRawShape>,
> implements Relationable<Z> {
  public readonly dbId: string;
  public readonly name: N;
  public readonly schema: Z;
  public readonly primaryKey: Columns<Z>;
  public readonly autoNumbering: AutoNumberingMode | undefined;
  public readonly cache: SheetCache;
  private lockToken: string | null = null;
  private lockHeld = false;
  private lockKey: string | null = null;
  private cacheRef: GoogleAppsScript.Cache.Cache | null = null;
  private lockServiceRef: GoogleAppsScript.Lock.LockService | null = null;
  public readonly versionColumn: Columns<Z> | null = null;
  private relations: SheetRelation[] = [];

  constructor(config: SheetTableConfig<N, Z>) {
    this.dbId = config.dbId;
    this.name = config.name;
    this.schema = config.schema;
    this.primaryKey = config.primaryKey;
    this.autoNumbering = config.autoNumbering;

    const pkField = this.schema.shape[this.primaryKey as string];
    const isNumber = pkField._zod.def.type === "number";
    const isString = pkField._zod.def.type === "string";

    if (this.autoNumbering === "increment" && !isNumber) {
      throw new Error(
        `Primary key field '${this.primaryKey as string}' must be a number to use auto-increment.`,
      );
    }
    if (this.autoNumbering === "uuid" && !isString) {
      throw new Error(
        `Primary key field '${this.primaryKey as string}' must be a string to use uuid auto-numbering.`,
      );
    }

    this.cache = new SheetCache();
    if (config.versionColumn) {
      const versionField = this.schema.shape[config.versionColumn as string];
      if (!versionField) {
        throw new Error(
          `Version column '${config.versionColumn as string}' does not exist in schema.`,
        );
      }
      if (versionField._zod.def.type !== "number") {
        throw new Error(
          `Version column '${config.versionColumn as string}' must be a number.`,
        );
      }
      this.versionColumn = config.versionColumn;
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
    lockService: GoogleAppsScript.Lock.LockService,
  ): void {
    const lockKey = `${this.dbId}:${this.name}`;
    const waitTimeoutMs = 300000;
    const pollIntervalMs = 200;
    const deadline = Date.now() + waitTimeoutMs;
    let ownerToken: string | null = null;

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`${this.name} cache lock timeout (${waitTimeoutMs}ms)`);
      }

      const scriptLock = lockService.getScriptLock();
      try {
        if (scriptLock.tryLock(Math.min(pollIntervalMs, remaining))) {
          if (Date.now() >= deadline) {
            throw new Error(`${this.name} cache lock timeout (${waitTimeoutMs}ms)`);
          }
          if (this.lockHeld && this.lockToken && this.cacheRef && this.lockKey) {
            if (this.cacheRef.get(this.lockKey) === this.lockToken) return;
            this.clearLock();
          }

          ownerToken ??= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          if (!cache.get(lockKey)) {
            cache.put(lockKey, ownerToken, 300);
            if (cache.get(lockKey) === ownerToken) {
              this.lockHeld = true;
              this.lockToken = ownerToken;
              this.lockKey = lockKey;
              this.cacheRef = cache;
              this.lockServiceRef = lockService;
              return;
            }
          }
        }
      } finally {
        // Also handles a service throwing after it has acquired the lock.
        if (scriptLock.hasLock()) scriptLock.releaseLock();
      }

      const sleepMs = Math.min(pollIntervalMs, deadline - Date.now());
      if (sleepMs > 0) utilities.sleep(sleepMs);
    }
  }

  /** Borrow an existing lock; only the acquiring scope may release it. */
  holdLock(
    cache: GoogleAppsScript.Cache.Cache,
    utilities: GoogleAppsScript.Utilities.Utilities,
    lockService: GoogleAppsScript.Lock.LockService,
  ): () => void {
    const previousToken = this.lockToken;
    this.lock(cache, utilities, lockService);
    const token = this.lockToken;
    return previousToken === token
      ? () => {}
      : () => {
          if (this.lockToken === token) this.releaseLock();
        };
  }

  releaseLock(): void {
    if (!this.lockHeld || !this.lockServiceRef) return;

    let scriptLock: GoogleAppsScript.Lock.Lock | null = null;
    try {
      scriptLock = this.lockServiceRef.getScriptLock();
      scriptLock.waitLock(300000);
      if (
        this.lockToken &&
        this.cacheRef &&
        this.lockKey &&
        this.cacheRef.get(this.lockKey) === this.lockToken
      ) {
        this.cacheRef.remove(this.lockKey);
      }
    } finally {
      try {
        if (scriptLock?.hasLock()) scriptLock.releaseLock();
      } finally {
        this.clearLock();
      }
    }
  }

  private clearLock(): void {
    this.lockToken = null;
    this.lockHeld = false;
    this.lockKey = null;
    this.cacheRef = null;
    this.lockServiceRef = null;
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
