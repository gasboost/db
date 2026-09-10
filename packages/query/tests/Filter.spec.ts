import { describe, expect, it } from "vitest";
import { Filter } from "../src/Filter";

describe("Filter", () => {
  it("numberを等価比較できる", () => {
    const filter = new Filter("age", "=", [20]);

    expect(filter.isFullfiled({ age: 20 })).toBe(true);
    expect(filter.isFullfiled({ age: 21 })).toBe(false);
  });

  it("numberを大小比較できる", () => {
    const filter = new Filter("age", ">=", [20]);

    expect(filter.isFullfiled({ age: 20 })).toBe(true);
    expect(filter.isFullfiled({ age: 19 })).toBe(false);
  });

  it("stringを等価比較できる", () => {
    const filter = new Filter("name", "=", ["Taro"]);

    expect(filter.isFullfiled({ name: "Taro" })).toBe(true);
    expect(filter.isFullfiled({ name: "Jiro" })).toBe(false);
  });

  it("stringを部分一致で比較できる", () => {
    const filter = new Filter("name", "*", ["aro"]);

    expect(filter.isFullfiled({ name: "Taro" })).toBe(true);
  });

  it("booleanを比較できる", () => {
    const filter = new Filter("active", "=", [true]);

    expect(filter.isFullfiled({ active: true })).toBe(true);
    expect(filter.isFullfiled({ active: false })).toBe(false);
  });

  it("Dateを比較できる", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const filter = new Filter("createdAt", "=", [date]);

    expect(
      filter.isFullfiled({
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe(true);
  });

  it("stringに大小比較を指定するとエラーになる", () => {
    expect(() => new Filter("name", ">", ["Taro"])).toThrow();
  });

  it("booleanに大小比較を指定するとエラーになる", () => {
    expect(() => new Filter("active", ">", [true])).toThrow();
  });

  it("numberに文字列演算子を指定するとエラーになる", () => {
    expect(() => new Filter("age", "*", [20])).toThrow();
  });

  it("Recordの値の型が異なる場合はfalseになる", () => {
    const filter = new Filter("name", "=", ["Taro"]);

    expect(filter.isFullfiled({ name: 123 })).toBe(false);
  });
});
