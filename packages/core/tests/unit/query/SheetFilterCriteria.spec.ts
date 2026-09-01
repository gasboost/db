import { describe, expect, it } from "vitest";
import { SheetFilterCriteria } from "../../../src/query/SheetFilterCriteria";

describe("初期化", () => {
  it("文字列2個の配列で初期化", () => {
    new SheetFilterCriteria(["test1", "test2"]);
  });

  it("文字列一個の配列で初期化", () => {
    new SheetFilterCriteria(["test"]);
  });

  it("数字の配列で初期化", () => {
    new SheetFilterCriteria([123, 456]);
  });

  it("日付の配列で初期化", () => {
    const date1 = new Date(2024, 1, 1);
    const date2 = new Date(2024, 2, 1);
    new SheetFilterCriteria([date1, date2]);
  });

  it("booleanの配列で初期化", () => {
    new SheetFilterCriteria([true, false, true]);
  });

  it("boolean一個の配列で初期化", () => {
    new SheetFilterCriteria([true]);
  });

  it("混在した配列で初期化", () => {
    const date = new Date(2024, 1, 1);
    expect(() => new SheetFilterCriteria(["test", 123, date])).toThrowError(
      `values must be all the same type`,
    );
  });

  it("空の配列で初期化", () => {
    expect(() => new SheetFilterCriteria([])).toThrowError(
      `values must not be empty`,
    );
  });
});

describe("日付判定", () => {
  it("日付の配列はtrueを返す", () => {
    const date1 = new Date(2024, 1, 1);
    const date2 = new Date(2024, 2, 1);
    const criteria = new SheetFilterCriteria([date1, date2]);
    expect(criteria.isDate()).toBe(true);
  });

  it("日付以外の配列はfalseを返す", () => {
    const criteria1 = new SheetFilterCriteria(["test1", "test2"]);
    expect(criteria1.isDate()).toBe(false);

    const criteria2 = new SheetFilterCriteria([123, 456]);
    expect(criteria2.isDate()).toBe(false);

    const criteria3 = new SheetFilterCriteria([true, false]);
    expect(criteria3.isDate()).toBe(false);
  });
});

describe("ミリ秒の取得", () => {
  it("DateのgetTimeと同じ値を返す", () => {
    const date1 = new Date(2024, 0, 1);
    const criteria = new SheetFilterCriteria([date1]);
    const times = criteria.getTimes();
    expect(times).toEqual([date1.getTime()]);
  });

  it("文字列の配列の場合はエラーを投げる", () => {
    const criteria = new SheetFilterCriteria(["test1", "test2"]);
    expect(() => criteria.getTimes()).toThrowError(`values are not Date type`);
  });

  it("数字の配列の場合はエラーを投げる", () => {
    const criteria = new SheetFilterCriteria([123, 456]);
    expect(() => criteria.getTimes()).toThrowError(`values are not Date type`);
  });
});
