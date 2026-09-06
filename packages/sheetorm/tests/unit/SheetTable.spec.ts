import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SheetTable } from "../../src/core/SheetTable";

describe("SheetTable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("primaryKey = ID", () => {
    const userSchema = z.object({
      ID: z.number().meta({ primary: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    const userTable = new SheetTable({
      dbId: "your-db-id",
      name: "ユーザー",
      schema: userSchema,
      primaryKey: "ID",
      autoNumbering: "increment",
    });

    expect(userTable.primaryKey).toBe("ID");
  });

  it("autoNumbering is undefined", () => {
    const userSchema = z.object({
      ID: z.number().meta({ primary: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    const userTable = new SheetTable({
      dbId: "your-db-id",
      name: "ユーザー",
      schema: userSchema,
      primaryKey: "ID",
    });

    expect(userTable.autoNumbering).toBeUndefined();
  });

  it("autoNumbering = increment", () => {
    const userSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string().min(1).max(100),
      email: z.string(),
    });

    const userTable = new SheetTable({
      dbId: "your-db-id",
      name: "ユーザー",
      schema: userSchema,
      primaryKey: "id",
      autoNumbering: "increment",
    });

    expect(userTable.autoNumbering).toBe("increment");
  });

  it("increment auto-numbering with non-number type error", () => {
    const invalidSchema = z.object({
      ID: z.string().meta({ primary: true, autoIncrement: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    expect(
      () =>
        new SheetTable({
          dbId: "your-db-id",
          name: "ユーザー",
          schema: invalidSchema,
          primaryKey: "ID",
          autoNumbering: "increment",
        }),
    ).toThrow(`Primary key field 'ID' must be a number to use auto-increment.`);
  });

  it("uuid auto-numbering allows string primary keys", () => {
    const userSchema = z.object({
      ID: z.string().meta({ primary: true, autoIncrement: true }),
      名前: z.string().min(1).max(100),
      メール: z.string(),
    });

    const userTable = new SheetTable({
      dbId: "your-db-id",
      name: "ユーザー",
      schema: userSchema,
      primaryKey: "ID",
      autoNumbering: "uuid",
    });

    expect(userTable.autoNumbering).toBe("uuid");
  });
});

describe("関連テーブルの取得", () => {
  it("投稿を持つユーザーテーブルの場合は投稿が取得できる", () => {
    const userSchema = z.object({
      ID: z.number().meta({ primary: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    const userTable = new SheetTable({
      dbId: "your-db-id",
      name: "ユーザー",
      schema: userSchema,
      primaryKey: "ID",
      autoNumbering: "increment",
    });

    const postSchema = z.object({
      ID: z.number().meta({ primary: true }),
      タイトル: z.string(),
      コンテンツ: z.string(),
      著者ID: z.number().meta({ ref: userSchema }),
    });

    const postTable = new SheetTable({
      dbId: "your-db-id",
      name: "投稿",
      schema: postSchema,
      primaryKey: "ID",
      autoNumbering: "increment",
    });

    postTable.reference("著者ID", userTable, "ID", "cascade");
    const relations = userTable.getRelationTree();
    expect(relations.length).toBe(1);
    expect(relations[0].childTable.name).toBe("投稿");
  });

  it("ユーザー→投稿→コメントの場合、投稿とそれに紐づくコメントが取得できる", () => {
    const userSchema = z.object({
      ID: z.number().meta({ primary: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    const userTable = new SheetTable({
      dbId: "your-db-id",
      name: "ユーザー",
      schema: userSchema,
      primaryKey: "ID",
      autoNumbering: "increment",
    });

    const postSchema = z.object({
      ID: z.number().meta({ primary: true }),
      タイトル: z.string(),
      コンテンツ: z.string(),
      著者ID: z.number().meta({ ref: userSchema }),
    });

    const postTable = new SheetTable({
      dbId: "your-db-id",
      name: "投稿",
      schema: postSchema,
      primaryKey: "ID",
      autoNumbering: "increment",
    });

    postTable.reference("著者ID", userTable, "ID", "cascade");

    const commentSchema = z.object({
      ID: z.number().meta({ primary: true }),
      コンテンツ: z.string(),
      投稿ID: z.number().meta({ ref: postSchema }),
    });

    const commentTable = new SheetTable({
      dbId: "your-db-id",
      name: "コメント",
      schema: commentSchema,
      primaryKey: "ID",
      autoNumbering: "increment",
    });

    commentTable.reference("投稿ID", postTable, "ID", "cascade");

    const relations = userTable.getRelationTree();
    expect(relations.length).toBe(2);
    expect(relations[0].childTable.name).toBe("投稿");
    expect(relations[1].childTable.name).toBe("コメント");
  });

  it("循環参照があっても無限ループにならない", () => {
    const userSchema = z.object({
      ID: z.number().meta({ primary: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    const userTable = new SheetTable({
      dbId: "your-db-id",
      name: "ユーザー",
      schema: userSchema,
      primaryKey: "ID",
      autoNumbering: "increment",
    });

    userTable.reference("ID", userTable, "ID", "cascade");
    const relations = userTable.getRelationTree();
    expect(relations.length).toBe(1);
    expect(relations[0].childTable.name).toBe("ユーザー");
  });
});

describe("SheetTable lock/release", () => {
  it("lock がキャッシュにキーを設定する", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });
    const cache = new InMemoryCacheService().getScriptCache();
    const utilities = new NodeUtilities();

    table.lock(cache, utilities);
    expect(cache.get("db:users")).not.toBeNull();
    table.releaseLock();
  });

  it("lock を二重に呼んでもエラーにならない", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });
    const cache = new InMemoryCacheService().getScriptCache();
    const utilities = new NodeUtilities();

    table.lock(cache, utilities);
    const firstToken = cache.get("db:users");
    table.lock(cache, utilities);
    const secondToken = cache.get("db:users");
    expect(secondToken).toBe(firstToken);
    table.releaseLock();
  });

  it("releaseLock は未ロック時に何もしない", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    expect(() => table.releaseLock()).not.toThrow();
  });

  it("同一プロセス内では同じロックを再利用する", () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const cacheService = new InMemoryCacheService();
    const cache = cacheService.getScriptCache();
    const utilities = new NodeUtilities();

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema: z.object({ id: z.number() }),
      primaryKey: "id",
    });

    table.lock(cache, utilities);
    const firstToken = cache.get("db:users");

    table.lock(cache, utilities);
    const secondToken = cache.get("db:users");

    expect(secondToken).toBe(firstToken);
    expect(randomSpy).toHaveBeenCalledTimes(1);

    table.releaseLock();
  });

  it("キャッシュのトークンが一致しない場合に再取得する", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const cacheService = new InMemoryCacheService();
    const cache = cacheService.getScriptCache();
    const utilities = new NodeUtilities();

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema: z.object({ id: z.number() }),
      primaryKey: "id",
    });

    table.lock(cache, utilities);
    cache.put("db:users", "other", 300);

    const originalGet = cache.get.bind(cache);

    vi.spyOn(cache, "get")
      .mockReturnValueOnce("other")
      .mockReturnValueOnce(null)
      .mockImplementation((key) => originalGet(key));

    expect(() => table.lock(cache, utilities)).not.toThrow();
    expect(cache.get("db:users")).not.toBe("other");

    table.releaseLock();

    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("トークンが一致しない場合にロックを削除しない", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockImplementation(() => 0);
    const cacheService = new InMemoryCacheService();
    const cache = cacheService.getScriptCache();
    const utilities = new NodeUtilities();

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema: z.object({ id: z.number() }),
      primaryKey: "id",
    });

    table.lock(cache, utilities);
    cache.put("db:users", "other", 300);

    table.releaseLock();
    expect(cache.get("db:users")).toBe("other");
    nowSpy.mockRestore();
  });

  it("ロック取得のタイムアウト時に例外を投げる", () => {
    const nowSpy = vi.spyOn(Date, "now");
    let now = 0;
    nowSpy.mockImplementation(() => now);
    const cacheService = new InMemoryCacheService();
    const cache = cacheService.getScriptCache();
    cache.put("db:users", "locked");

    const utilities = new NodeUtilities();
    vi.spyOn(utilities, "sleep").mockImplementation(() => {
      now += 200;
    });

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema: z.object({ id: z.number() }),
      primaryKey: "id",
    });

    expect(() => table.lock(cache, utilities)).toThrow("cache lock timeout");
    nowSpy.mockRestore();
  });

  it("ロック取得後の確認に失敗したら再試行する", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    let getCount = 0;

    const cacheService = new InMemoryCacheService();
    const cache = cacheService.getScriptCache();

    const ownerToken = `1000-${(0.5).toString(36).slice(2)}`;

    vi.spyOn(cache, "get").mockImplementation(() => {
      getCount += 1;
      if (getCount === 1) return null;
      if (getCount === 2) return "other";
      if (getCount === 3) return null;
      return ownerToken;
    });

    const utilities = new NodeUtilities();
    vi.spyOn(utilities, "sleep").mockImplementation(() => undefined);

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema: z.object({ id: z.number() }),
      primaryKey: "id",
    });

    expect(() => table.lock(cache, utilities)).not.toThrow();
    expect(getCount).toBe(4);

    table.releaseLock();
  });

  it("ロックされていない場合は解放しない", () => {
    const cacheService = new InMemoryCacheService();
    const cache = cacheService.getScriptCache();
    const utilities = new NodeUtilities();

    vi.spyOn(utilities, "sleep").mockImplementation(() => undefined);

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema: z.object({ id: z.number() }),
      primaryKey: "id",
    });

    table.releaseLock();
    table.lock(cache, utilities);
    table.releaseLock();
    table.releaseLock();
  });
});

describe("SheetTable validate/getUniqueColumns", () => {
  it("validate はスキーマ違反でエラー", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    expect(() => table.validate({ id: "1" })).toThrow(
      "Schema validation failed",
    );
  });

  it("validate はスキーマ検証のみ", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    expect(() => table.validate({ id: 1 })).not.toThrow();
  });

  it("getUniqueColumns はユニーク列を返す", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      email: z.string().meta({ unique: true }),
      name: z.string(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    expect(table.getUniqueColumns()).toEqual(["email"]);
  });
});
