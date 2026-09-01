"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SheetTable = void 0;
const zod_1 = require("zod");
class SheetTable {
    dbId;
    name;
    schema;
    primaryKey;
    autoIncrement;
    autoNumberingMode = null;
    lockToken = null;
    lockHeld = false;
    lockKey = null;
    cacheRef = null;
    versionColumn = null;
    constructor(dbId, name, schema, primaryKey, autoIncrement, options) {
        this.dbId = dbId;
        this.name = name;
        this.schema = schema;
        this.primaryKey = primaryKey;
        const pkField = this.schema.shape[primaryKey];
        const isNumber = pkField._zod.def.type === "number";
        const isString = pkField._zod.def.type === "string";
        const autoNumberingMode = options?.autoNumberingMode ?? "increment";
        if (!autoIncrement && options?.autoNumberingMode) {
            throw new Error(`Auto numbering mode '${options.autoNumberingMode}' requires autoIncrement to be enabled.`);
        }
        if (autoIncrement && autoNumberingMode === "increment" && !isNumber) {
            throw new Error(`Primary key field '${primaryKey}' must be a number to use auto-increment.`);
        }
        if (autoIncrement && autoNumberingMode === "uuid" && !isString) {
            throw new Error(`Primary key field '${primaryKey}' must be a string to use uuid auto-numbering.`);
        }
        this.autoIncrement = autoIncrement;
        this.autoNumberingMode = autoIncrement ? autoNumberingMode : null;
        if (options?.versionColumn) {
            const versionField = this.schema.shape[options.versionColumn];
            if (!versionField) {
                throw new Error(`Version column '${options.versionColumn}' does not exist in schema.`);
            }
            if (versionField._zod.def.type !== "number") {
                throw new Error(`Version column '${options.versionColumn}' must be a number.`);
            }
            this.versionColumn = options.versionColumn;
        }
    }
    setDbId(dbId) {
        this.dbId = dbId;
    }
    lock(cache, utilities) {
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
                if (confirmed === ownerToken)
                    break;
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
    releaseLock() {
        if (!this.lockHeld)
            return;
        if (this.lockToken &&
            this.cacheRef &&
            this.lockKey &&
            this.cacheRef.get(this.lockKey) === this.lockToken) {
            this.cacheRef.remove(this.lockKey);
        }
        this.lockToken = null;
        this.lockHeld = false;
        this.lockKey = null;
        this.cacheRef = null;
    }
    validate(record) {
        const parsed = this.schema.safeParse(record);
        if (!parsed.success) {
            throw new Error(`Schema validation failed: ${parsed.error.message}`);
        }
    }
    getUniqueColumns() {
        const uniqueColmuns = [];
        Object.entries(this.schema.shape).forEach(([key, field]) => {
            const meta = zod_1.z.globalRegistry.get(field);
            if (meta?.unique === true) {
                uniqueColmuns.push(key);
            }
        });
        return uniqueColmuns;
    }
    hasOptimisticLock() {
        return this.versionColumn !== null;
    }
}
exports.SheetTable = SheetTable;
