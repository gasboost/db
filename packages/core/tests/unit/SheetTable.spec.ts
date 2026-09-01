import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SheetTable } from "../../src/SheetTable";

describe("SheetTable", () => {
  it("プライマリーキーをIDと指定する", () => {
    const userSchema = z.object({
      ID: z.number().meta({ primary: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    const userTable = new SheetTable(
      "your-db-id",
      "ユーザー",
      userSchema,
      "ID",
      true,
    );

    expect(userTable.primaryKey).toBe("ID");
  });
  it("自動採番を無効にする", () => {
    const userSchema = z.object({
      ID: z.number().meta({ primary: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });

    const userTable = new SheetTable(
      "your-db-id",
      "ユーザー",
      userSchema,
      "ID",
      false,
    );
    expect(userTable.autoIncrement).toBe(false);
  });

  it("自動採番を有効にする", () => {
    const userSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string().min(1).max(100),
      email: z.string(),
    });

    const userTable = new SheetTable(
      "your-db-id",
      "ユーザー",
      userSchema,
      "id",
      true,
    );
    expect(userTable.autoIncrement).toBe(true);
  });

  it("プライマリキーが文字列の場合は、自動採番できない", () => {
    const invalidSchema = z.object({
      ID: z.string().meta({ primary: true, autoIncrement: true }),
      名前: z.string(),
      メール: z.string().meta({ unique: true }),
    });
    expect(
      () => new SheetTable("your-db-id", "ユーザー", invalidSchema, "ID", true),
    ).toThrow(`Primary key field 'ID' must be a number to use auto-increment.`);
  });

  it("uuid 自動採番は文字列のプライマリキーを許可する", () => {
    const userSchema = z.object({
      ID: z.string().meta({ primary: true, autoIncrement: true }),
      名前: z.string().min(1).max(100),
      メール: z.string(),
    });

    const userTable = new SheetTable(
      "your-db-id",
      "ユーザー",
      userSchema,
      "ID",
      true,
      { autoNumberingMode: "uuid" },
    );

    expect(userTable.autoNumberingMode).toBe("uuid");
  });
});

describe("SheetTable lock/release", () => {
  it("lock がキャッシュにキーを設定する", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);
    const cache = new InMemoryCacheService().getScriptCache();
    const utilities = new NodeUtilities();

    table.lock(cache, utilities);
    expect(cache.get("db:users")).not.toBeNull();
    table.releaseLock();
  });

  it("lock を二重に呼んでもエラーにならない", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);
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
    const table = new SheetTable("db", "users", schema, "id", false);

    expect(() => table.releaseLock()).not.toThrow();
  });
});

describe("SheetTable validate/getUniqueColumns", () => {
  it("validate はスキーマ違反でエラー", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);

    expect(() => table.validate({ id: "1" })).toThrow(
      "Schema validation failed",
    );
  });

  it("validate はスキーマ検証のみ", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);

    expect(() => table.validate({ id: 1 })).not.toThrow();
  });

  it("getUniqueColumns はユニーク列を返す", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      email: z.string().meta({ unique: true }),
      name: z.string(),
    });
    const table = new SheetTable("db", "users", schema, "id", false);

    expect(table.getUniqueColumns()).toEqual(["email"]);
  });
});
