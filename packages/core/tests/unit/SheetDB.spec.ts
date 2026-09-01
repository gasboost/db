import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/SheetDB";
import { SheetTable } from "../../src/SheetTable";
import { InMemoryDataStore } from "../doubles/InMemoryDataStore";
import { InMemoryGateway } from "../doubles/InMemoryGateway";

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const postSchema = z.object({
  id: z.number(),
  title: z.string(),
});

const createDb = (rows: any[][] = []) => {
  const store = new InMemoryDataStore(
    new Map([["db:users", [["id", "name"], ...rows]]]),
  );
  const gateway = new InMemoryGateway(store);
  const users = new SheetTable("db", "users", userSchema, "id", false);
  return { db: new SheetDB([users] as const, gateway), store };
};

describe("SheetDB Record CRUD", () => {
  it("createはRecordを保存してRecordを返す", () => {
    const { db } = createDb();

    expect(db.table("users").create([{ id: 1, name: "Alice" }])).toEqual([
      { id: 1, name: "Alice" },
    ]);
    expect(db.table("users").find()).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("tableで取得したハンドルは別テーブル選択の影響を受けない", () => {
    const store = new InMemoryDataStore(
      new Map([
        ["db:users", [["id", "name"]]],
        ["db:posts", [["id", "title"]]],
      ]),
    );
    const gateway = new InMemoryGateway(store);
    const users = new SheetTable("db", "users", userSchema, "id", false);
    const posts = new SheetTable("db", "posts", postSchema, "id", false);
    const db = new SheetDB([users, posts] as const, gateway);

    const usersDb = db.table("users");
    const postsDb = db.table("posts");

    expect(usersDb).not.toBe(postsDb);
    usersDb.create([{ id: 1, name: "Alice" }]);
    postsDb.create([{ id: 10, title: "Hello" }]);

    expect(usersDb.find()).toEqual([{ id: 1, name: "Alice" }]);
    expect(postsDb.find()).toEqual([{ id: 10, title: "Hello" }]);
  });

  it("updateはprimary keyで既存Recordを更新する", () => {
    const { db } = createDb([[1, "Alice"]]);

    expect(db.table("users").update([{ id: 1, name: "Alicia" }])).toEqual([
      { id: 1, name: "Alicia" },
    ]);
    expect(db.table("users").find()).toEqual([{ id: 1, name: "Alicia" }]);
  });

  it("存在しないprimary keyのupdateは失敗する", () => {
    const { db } = createDb();

    expect(() =>
      db.table("users").update([{ id: 99, name: "Nobody" }]),
    ).toThrow("Record with primary key 99 does not exist for update.");
  });

  it("upsertはprimary keyの存在でcreateとupdateを振り分ける", () => {
    const { db } = createDb([[1, "Alice"]]);

    expect(
      db.table("users").upsert([
        { id: 1, name: "Alicia" },
        { id: 2, name: "Bob" },
      ]),
    ).toEqual([
      { id: 1, name: "Alicia" },
      { id: 2, name: "Bob" },
    ]);
    expect(db.table("users").find()).toEqual([
      { id: 1, name: "Alicia" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("deleteはprimary key値でRecordを削除する", () => {
    const { db } = createDb([
      [1, "Alice"],
      [2, "Bob"],
    ]);

    expect(db.table("users").delete([1])).toBe(true);
    expect(db.table("users").find()).toEqual([{ id: 2, name: "Bob" }]);
  });
});
