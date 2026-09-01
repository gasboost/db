import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/SheetDB";
import { SheetTable } from "../../src/SheetTable";
import { InMemoryDataStore } from "../doubles/InMemoryDataStore";
import { InMemoryGateway } from "../doubles/InMemoryGateway";

class SetupGateway extends InMemoryGateway {
  protectCalls = 0;

  override protect(): void {
    this.protectCalls += 1;
  }
}

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const postSchema = z.object({
  id: z.string(),
  userId: z.number(),
  title: z.string(),
});

const setup = () => {
  const store = new InMemoryDataStore(
    new Map([
      ["db:users", [["legacy"]]],
      ["db:posts", [["legacy"]]],
    ]),
  );
  const gateway = new SetupGateway(store);
  const users = new SheetTable("db", "users", userSchema, "id", false);
  const posts = new SheetTable("db", "posts", postSchema, "id", false);
  const db = new SheetDB([users, posts] as const, gateway);
  return { store, gateway, db };
};

describe("setup", () => {
  it("migrateはZod schemaのキーをcolumnsにする", () => {
    const { store, db } = setup();

    db.migrate();

    expect(store.get("db:users").headers).toEqual(["id", "name"]);
    expect(store.get("db:posts").headers).toEqual([
      "id",
      "userId",
      "title",
    ]);
  });

  it("seedは空テーブルに初期Recordを投入する", () => {
    const { db } = setup();
    db.migrate();

    expect(db.seed("users", [{ id: 1, name: "Alice" }])).toBe(true);
    expect(db.table("users").find()).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("seedはデータが存在するテーブルを変更しない", () => {
    const { db } = setup();
    db.migrate();
    db.seed("users", [{ id: 1, name: "Alice" }]);

    expect(db.seed("users", [{ id: 2, name: "Bob" }])).toBe(false);
    expect(db.table("users").find()).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("seedはZod schemaに違反するRecordを拒否する", () => {
    const { db } = setup();
    db.migrate();

    expect(() =>
      db.seed("users", [{ id: 1, name: 123 } as any]),
    ).toThrow("Schema validation failed");
  });

  it("protectは全Tableを保護する", () => {
    const { gateway, db } = setup();

    db.protect();

    expect(gateway.protectCalls).toBe(2);
  });
});
