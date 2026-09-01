import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CacheLike, CacheServiceLike, UtilitiesLike } from "../../src/RuntimeTypes";
import { SheetDB } from "../../src/SheetDB";
import { SheetTable } from "../../src/SheetTable";
import { InMemoryDataStore } from "../doubles/InMemoryDataStore";
import { InMemoryGateway } from "../doubles/InMemoryGateway";

class MemoryCache implements CacheLike {
  private values = new Map<string, string>();
  get(key: string) { return this.values.get(key) ?? null; }
  put(key: string, value: string) { this.values.set(key, value); }
  remove(key: string) { this.values.delete(key); }
}

const runtime = () => {
  const cache = new MemoryCache();
  let uuid = 0;
  const CacheService: CacheServiceLike = { getScriptCache: () => cache };
  const Utilities: UtilitiesLike = {
    getUuid: () => `uuid-${++uuid}`,
    sleep: () => undefined,
  };
  return { cache, CacheService, Utilities };
};

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().meta({ unique: true }),
  version: z.number(),
});

const createUsersDb = (rows: any[][] = []) => {
  const store = new InMemoryDataStore(
    new Map([["db:users", [["id", "name", "email", "version"], ...rows]]]),
  );
  const gateway = new InMemoryGateway(store);
  const users = new SheetTable("db", "users", userSchema, "id", true, {
    versionColumn: "version",
  });
  const { cache, CacheService, Utilities } = runtime();
  return {
    db: new SheetDB([users] as const, gateway, CacheService, Utilities),
    store,
    users,
    cache,
  };
};

describe("DB features", () => {
  it("unique columnの重複createを拒否する", () => {
    const { db } = createUsersDb([[1, "Alice", "a@example.com", 1]]);
    expect(() =>
      db.table("users").create([
        { name: "Other", email: "a@example.com", version: 1 },
      ]),
    ).toThrow("Unique constraint violation: email=a@example.com");
  });

  it("incrementでprimary keyを自動採番する", () => {
    const { db } = createUsersDb([[3, "Alice", "a@example.com", 1]]);
    const created = db.table("users").create([
      { name: "Bob", email: "b@example.com", version: 1 },
      { name: "Carol", email: "c@example.com", version: 1 },
    ]);
    expect(created.map((record) => record.id)).toEqual([4, 5]);
  });

  it("UUIDでprimary keyを自動採番する", () => {
    const schema = z.object({ id: z.string(), name: z.string() });
    const store = new InMemoryDataStore(
      new Map([["db:tokens", [["id", "name"]]]]),
    );
    const gateway = new InMemoryGateway(store);
    const tokens = new SheetTable("db", "tokens", schema, "id", true, {
      autoNumberingMode: "uuid",
    });
    const { CacheService, Utilities } = runtime();
    const db = new SheetDB([tokens] as const, gateway, CacheService, Utilities);

    expect(db.table("tokens").create([{ name: "one" }])).toEqual([
      { id: "uuid-1", name: "one" },
    ]);
  });

  it("versionColumnで楽観ロックする", () => {
    const { db } = createUsersDb([[1, "Alice", "a@example.com", 1]]);
    expect(
      db.table("users").update([
        { id: 1, name: "Alicia", email: "a@example.com", version: 1 },
      ]),
    ).toEqual([
      { id: 1, name: "Alicia", email: "a@example.com", version: 2 },
    ]);

    expect(() =>
      db.table("users").update([
        { id: 1, name: "Again", email: "a@example.com", version: 1 },
      ]),
    ).toThrow("Optimistic lock error: expected version 2 but got 1");
  });

  it("transaction中の複数操作をcommitする", () => {
    const { db } = createUsersDb([[1, "Alice", "a@example.com", 1]]);
    db.transaction(() => {
      db.table("users").create([
        { name: "Bob", email: "b@example.com", version: 1 },
      ]);
      db.table("users").update([
        { id: 1, name: "Alicia", email: "a@example.com", version: 1 },
      ]);
      expect(db.table("users").find()).toHaveLength(2);
    });

    expect(db.table("users").find()).toEqual([
      { id: 1, name: "Alicia", email: "a@example.com", version: 2 },
      { id: 2, name: "Bob", email: "b@example.com", version: 1 },
    ]);
  });

  it("transaction中は対象tableのlockを保持しcommit後に解放する", () => {
    const { db, cache } = createUsersDb([[1, "Alice", "a@example.com", 1]]);
    const competingTable = new SheetTable("db", "users", userSchema, "id", true, {
      versionColumn: "version",
    });

    db.transaction(() => {
      db.table("users").update([
        { id: 1, name: "Alicia", email: "a@example.com", version: 1 },
      ]);

      expect(cache.get("db:users")).not.toBeNull();
      expect(() =>
        competingTable.lock(cache, {
          getUuid: () => "unused",
          sleep: () => {
            throw new Error("blocked by transaction lock");
          },
        }),
      ).toThrow("blocked by transaction lock");
    });

    expect(cache.get("db:users")).toBeNull();
  });

  it("transaction callbackで例外が発生したら変更しない", () => {
    const { db, cache } = createUsersDb([[1, "Alice", "a@example.com", 1]]);
    expect(() =>
      db.transaction(() => {
        db.table("users").create([
          { name: "Bob", email: "b@example.com", version: 1 },
        ]);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(cache.get("db:users")).toBeNull();
    expect(db.table("users").find()).toEqual([
      { id: 1, name: "Alice", email: "a@example.com", version: 1 },
    ]);
  });

  it("SheetTableはCommandBufferを所有しない", () => {
    const { users } = createUsersDb();
    expect("cache" in users).toBe(false);
    expect("commandBuffer" in users).toBe(false);
  });
});
