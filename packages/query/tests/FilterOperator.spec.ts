import { describe, expect, it } from "vitest";
import { FilterOperator } from "../src/FilterOperator";

describe("FilterOperator", () => {
  it.each(["<", ">", "<=", ">="] as const)(
    "%s は大小比較演算子である",
    (operator) => {
      expect(new FilterOperator(operator).isMoreThanOrLessThan()).toBe(true);
    },
  );

  it.each(["=", "!=", "*", "!*", "^*", "*$"] as const)(
    "%s は大小比較演算子ではない",
    (operator) => {
      expect(new FilterOperator(operator).isMoreThanOrLessThan()).toBe(false);
    },
  );

  it.each(["*", "!*", "^*", "*$"] as const)(
    "%s は文字列演算子である",
    (operator) => {
      expect(new FilterOperator(operator).isStringOperator()).toBe(true);
    },
  );

  it.each(["=", "!="] as const)("%s は等価比較演算子である", (operator) => {
    expect(new FilterOperator(operator).isEqualityOperator()).toBe(true);
  });

  it("numberを=で比較できる", () => {
    expect(new FilterOperator("=").compareNumber(10, [10])).toBe(true);
    expect(new FilterOperator("=").compareNumber(10, [20])).toBe(false);
  });

  it("numberを!=で比較できる", () => {
    expect(new FilterOperator("!=").compareNumber(10, [20])).toBe(true);
    expect(new FilterOperator("!=").compareNumber(10, [10])).toBe(false);
  });

  it("numberを<で比較できる", () => {
    expect(new FilterOperator("<").compareNumber(5, [10])).toBe(true);
    expect(new FilterOperator("<").compareNumber(10, [10])).toBe(false);
  });

  it("numberを<=で比較できる", () => {
    expect(new FilterOperator("<=").compareNumber(10, [10])).toBe(true);
    expect(new FilterOperator("<=").compareNumber(11, [10])).toBe(false);
  });

  it("numberを>で比較できる", () => {
    expect(new FilterOperator(">").compareNumber(11, [10])).toBe(true);
    expect(new FilterOperator(">").compareNumber(10, [10])).toBe(false);
  });

  it("numberを>=で比較できる", () => {
    expect(new FilterOperator(">=").compareNumber(10, [10])).toBe(true);
    expect(new FilterOperator(">=").compareNumber(9, [10])).toBe(false);
  });

  it("stringを=で比較できる", () => {
    expect(new FilterOperator("=").compareString("foo", ["foo"])).toBe(true);
  });

  it("stringを!=で比較できる", () => {
    expect(new FilterOperator("!=").compareString("foo", ["bar"])).toBe(true);
  });

  it("stringの部分一致を判定できる", () => {
    expect(new FilterOperator("*").compareString("foobar", ["oba"])).toBe(true);
  });

  it("stringの部分不一致を判定できる", () => {
    expect(new FilterOperator("!*").compareString("foobar", ["xyz"])).toBe(
      true,
    );
  });

  it("stringの前方一致を判定できる", () => {
    expect(new FilterOperator("^*").compareString("foobar", ["foo"])).toBe(
      true,
    );
  });

  it("stringの後方一致を判定できる", () => {
    expect(new FilterOperator("*$").compareString("foobar", ["bar"])).toBe(
      true,
    );
  });

  it("booleanを=で比較できる", () => {
    expect(new FilterOperator("=").compare(true, [true])).toBe(true);
  });

  it("booleanを!=で比較できる", () => {
    expect(new FilterOperator("!=").compare(true, [false])).toBe(true);
  });

  it("numberに文字列演算子を使うとエラーになる", () => {
    expect(() => new FilterOperator("*").compareNumber(10, [10])).toThrow();
  });

  it("booleanに大小比較演算子を使うとエラーになる", () => {
    expect(() => new FilterOperator(">").compare(true, [false])).toThrow();
  });
});
