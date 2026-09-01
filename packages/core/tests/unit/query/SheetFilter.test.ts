import { describe, expect, it } from "vitest";
import { SheetFilter } from "../../../src/query/SheetFilter";

describe("等価判定", () => {
  it("比較条件がAliceで値もAliceの場合はtrue", () => {
    const filter = new SheetFilter("name", "=", ["Alice"]);
    const record = { name: "Alice" };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が20で値も20の場合はtrue", () => {
    const filter = new SheetFilter("age", "=", [20]);
    const record = { age: 20 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件がtrueで値もtrueの場合はtrue", () => {
    const filter = new SheetFilter("isActive", "=", [true]);
    const record = { isActive: true };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が2024-01-01で値も2024-01-01の場合はtrue", () => {
    const filter = new SheetFilter("createdAt", "=", [new Date(2024, 0, 1)]);
    const record = { createdAt: new Date(2024, 0, 1) };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が20,30,40で値が30の場合はtrue", () => {
    const filter = new SheetFilter("age", "=", [20, 30, 40]);
    const record = { age: 30 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件がAliceで値がBobの場合はfalse", () => {
    const filter = new SheetFilter("name", "=", ["Alice"]);
    const record = { name: "Bob" };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件が20で値が30の場合はfalse", () => {
    const filter = new SheetFilter("age", "=", [20]);
    const record = { age: 30 };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件がtrueで値がfalseの場合はfalse", () => {
    const filter = new SheetFilter("isActive", "=", [true]);
    const record = { isActive: false };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件が2024-01-01で値が2024-02-01の場合はfalse", () => {
    const filter = new SheetFilter("createdAt", "=", [new Date(2024, 0, 1)]);
    const record = { createdAt: new Date(2024, 1, 1) };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件が2024-01-01で値が'2024-01-01'の場合はfalse", () => {
    const filter = new SheetFilter("createdAt", "=", [new Date(2024, 0, 1)]);
    const record = { createdAt: "2024-01-01" };
    expect(filter.isFullfiled(record)).toBe(false);
  });
});

describe("以上判定", () => {
  it("比較条件が20で値が30の場合はtrue", () => {
    const filter = new SheetFilter("age", ">=", [20]);
    const record = { age: 30 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が20,40で値が40の場合はtrue", () => {
    const filter = new SheetFilter("age", ">=", [20, 40]);
    const record = { age: 40 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が40,20で値が40の場合はtrue", () => {
    const filter = new SheetFilter("age", ">=", [40, 20]);
    const record = { age: 40 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が20で値が10の場合はfalse", () => {
    const filter = new SheetFilter("age", ">=", [20]);
    const record = { age: 10 };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件が20,40で値が20の場合はfalse", () => {
    const filter = new SheetFilter("age", ">=", [20, 40]);
    const record = { age: 20 };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件が40,20で値が20の場合はfalse", () => {
    const filter = new SheetFilter("age", ">=", [40, 20]);
    const record = { age: 20 };
    expect(filter.isFullfiled(record)).toBe(false);
  });
});

describe("以下判定", () => {
  it("比較条件が30で値が20の場合はtrue", () => {
    const filter = new SheetFilter("age", "<=", [30]);
    const record = { age: 20 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が40,20で値が20の場合はtrue", () => {
    const filter = new SheetFilter("age", "<=", [40, 20]);
    const record = { age: 20 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が20,40で値が20の場合はtrue", () => {
    const filter = new SheetFilter("age", "<=", [20, 40]);
    const record = { age: 20 };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("比較条件が30で値が40の場合はfalse", () => {
    const filter = new SheetFilter("age", "<=", [30]);
    const record = { age: 40 };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件が40,20で値が40の場合はfalse", () => {
    const filter = new SheetFilter("age", "<=", [40, 20]);
    const record = { age: 40 };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("比較条件が20,40で値が40の場合はfalse", () => {
    const filter = new SheetFilter("age", "<=", [20, 40]);
    const record = { age: 40 };
    expect(filter.isFullfiled(record)).toBe(false);
  });
});

describe("文字列判定", () => {
  it("containsで部分一致ならtrue", () => {
    const filter = new SheetFilter("title", "*", ["hello"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("containsで部分一致がなければfalse", () => {
    const filter = new SheetFilter("title", "*", ["bye"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("not_containsで部分一致がなければtrue", () => {
    const filter = new SheetFilter("title", "!*", ["bye"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("not_containsで部分一致があればfalse", () => {
    const filter = new SheetFilter("title", "!*", ["hello"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("starts_withで前方一致ならtrue", () => {
    const filter = new SheetFilter("title", "^*", ["hello"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("starts_withで前方一致でなければfalse", () => {
    const filter = new SheetFilter("title", "^*", ["world"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("ends_withで後方一致ならtrue", () => {
    const filter = new SheetFilter("title", "*$", ["world"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("ends_withで後方一致でなければfalse", () => {
    const filter = new SheetFilter("title", "*$", ["hello"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(false);
  });

  it("!= で一致しなければtrue", () => {
    const filter = new SheetFilter("title", "!=", ["hello"]);
    const record = { title: "hello world" };
    expect(filter.isFullfiled(record)).toBe(true);
  });

  it("文字列条件で値が文字列以外ならfalse", () => {
    const filter = new SheetFilter("title", "*", ["hello"]);
    const record = { title: 123 };
    expect(filter.isFullfiled(record)).toBe(false);
  });
});

describe("初期化", () => {
  it("日付に大なりを設定してもエラーにならない", () => {
    expect(
      () => new SheetFilter("createdAt", ">", [new Date(2024, 0, 1)]),
    ).not.toThrowError();
  });

  it("数値に大なりを設定してもエラーにならない", () => {
    expect(() => new SheetFilter("age", ">", [20])).not.toThrowError();
  });

  it("文字列に大なりを設定するとエラー", () => {
    expect(() => new SheetFilter("name", ">", ["Alice"])).toThrowError();
  });

  it("文字列に小なりを設定するとエラー", () => {
    expect(() => new SheetFilter("name", "<", ["Alice"])).toThrowError();
  });

  it("booleanに大なりを設定するとエラー", () => {
    expect(() => new SheetFilter("isActive", ">", [true])).toThrowError();
  });

  it("booleanに小なりを設定するとエラー", () => {
    expect(() => new SheetFilter("isActive", "<", [true])).toThrowError();
  });

  it("文字列にcontainsを設定してもエラーにならない", () => {
    expect(() => new SheetFilter("name", "*", ["Ali"])).not.toThrowError();
  });

  it("booleanにcontainsを設定するとエラー", () => {
    expect(() => new SheetFilter("isActive", "*", [true])).toThrowError();
  });

  it("数値にstarts_withを設定するとエラー", () => {
    expect(() => new SheetFilter("age", "^*", [1])).toThrowError();
  });

  it("booleanに未定義の演算子を設定するとエラー", () => {
    expect(
      () => new SheetFilter("isActive", "in" as any, [true]),
    ).toThrowError();
  });
});
