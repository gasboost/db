import { describe, expect, it } from "vitest";
import { SheetRelation } from "../../src/core/SheetRelation";

describe("cascade削除", () => {
  it("userId=1の親が削除された時、cascadeに設定していれば、userId=1のレコードが削除される", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "cascade");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ];

    expect(relation.delete(records, [1])).toEqual([{ id: 2, userId: 2 }]);
  });

  it("userId=1の親が削除された時、cascadeに設定していなければ、userId=1のレコードは全て削除される", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "cascade");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
      { id: 3, userId: 1 },
      { id: 4, userId: 2 },
      { id: 5, userId: 1 },
    ];

    expect(relation.delete(records, [1])).toEqual([
      { id: 2, userId: 2 },
      { id: 4, userId: 2 },
    ]);
  });

  it("userId=3が削除された時、cascadeに設定しているが、userId=3のレコードが存在しなければ、元のレコードがそのまま返る", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "cascade");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ];

    expect(relation.delete(records, [3])).toEqual([
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ]);
  });
});

describe("set null削除", () => {
  it("userId=1の親が削除された時、set nullに設定していれば、userIdがnullになる", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "set null");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ];

    expect(relation.delete(records, [1])).toEqual([
      { id: 1, userId: null },
      { id: 2, userId: 2 },
    ]);
  });

  it("userId=1の親が削除された時、set nullに設定していれば、userIdがnullになる（複数レコード）", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "set null");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
      { id: 3, userId: 1 },
      { id: 4, userId: 2 },
      { id: 5, userId: 1 },
    ];

    expect(relation.delete(records, [1])).toEqual([
      { id: 1, userId: null },
      { id: 2, userId: 2 },
      { id: 3, userId: null },
      { id: 4, userId: 2 },
      { id: 5, userId: null },
    ]);
  });

  it("userId=3の親が削除された時、set nullに設定しているが、userId=3のレコードなければそのまま返す", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "set null");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ];

    expect(relation.delete(records, [3])).toEqual([
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ]);
  });
});

describe("restrict削除", () => {
  it("削除対象の親を参照するレコードが存在する場合は削除を拒否する", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "restrict");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ];

    expect(() => relation.delete(records, [1])).toThrow();
  });

  it("削除対象の親を参照するレコードが複数存在する場合も削除を拒否する", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "restrict");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
      { id: 3, userId: 1 },
      { id: 4, userId: 2 },
      { id: 5, userId: 1 },
    ];

    expect(() => relation.delete(records, [1])).toThrow();
  });

  it("削除対象の親を参照するレコードが存在しなければ元のレコードを返す", () => {
    const relation = new SheetRelation("id", {} as any, "userId", "restrict");

    const records = [
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ];

    expect(relation.delete(records, [3])).toEqual([
      { id: 1, userId: 1 },
      { id: 2, userId: 2 },
    ]);
  });
});
