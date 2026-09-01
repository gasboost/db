import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WriteCommand } from "../../src/commands/WriteCommand";
import { SheetRecords } from "../../src/core/SheetRecords";
import { SheetTable } from "../../src/core/SheetTable";
import { SheetCache } from "../../src/storage/SheetCache";

describe("SheetCache", () => {
  it("add/hasNext/next が順序通りに動作する", () => {
    const cache = new SheetCache();
    const cmd1 = { execute: () => {} } as unknown as WriteCommand;
    const cmd2 = { execute: () => {} } as unknown as WriteCommand;

    cache.add(cmd1);
    cache.add(cmd2);

    expect(cache.hasNext()).toBe(true);
    expect(cache.next()).toBe(cmd1);
    expect(cache.hasNext()).toBe(true);
    expect(cache.next()).toBe(cmd2);
    expect(cache.hasNext()).toBe(false);
  });

  it("clear で状態が初期化される", () => {
    const cache = new SheetCache();
    const cmd = { execute: () => {} } as unknown as WriteCommand;

    cache.add(cmd);
    expect(cache.hasNext()).toBe(true);
    cache.clear();
    expect(cache.hasNext()).toBe(false);
  });

  it("setExsist/getExsist が値を保持する", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);
    const records = new SheetRecords(
      [{ id: 1 }, { id: 2 }],
      table.primaryKey as string,
    );
    const cache = new SheetCache();

    cache.setExsist(records);
    expect(cache.getExsist()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("getExsist は未設定時に空配列を返す", () => {
    const cache = new SheetCache();
    expect(cache.getExsist()).toEqual([]);
  });
});
