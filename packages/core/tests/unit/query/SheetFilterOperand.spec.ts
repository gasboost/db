import { describe, expect, it } from "vitest";
import { SheetFilterOperand } from "../../../src/query/SheetFilterOperand";

const date1 = new Date(2024, 0, 1).getTime(); // 2024-01-01
const date2 = new Date(2024, 1, 1).getTime(); // 2024-02-01
const date3 = new Date(2024, 2, 1).getTime(); // 2024-03-01
describe("日付の等価判定", () => {
  it("2024-01-01 と 2024-01-01を比較する場合はtrue", () => {
    const operand = new SheetFilterOperand("=");
    expect(operand.compareNumber(date1, [date1])).toBe(true);
  });

  it("2024-01-01 と 2024-02-01を比較する場合はfalse", () => {
    const operand = new SheetFilterOperand("=");
    expect(operand.compareNumber(date1, [date2])).toBe(false);
  });

  it("2024-01-01 と 2024-01-01, 2024-02-01を比較する場合はtrue", () => {
    const operand = new SheetFilterOperand("=");
    expect(operand.compareNumber(date1, [date1, date2])).toBe(true);
  });

  it("2024-01-01 と 2024-01-01 10:00:00を比較する場合はfalse", () => {
    const operand = new SheetFilterOperand("=");
    const dateWithTime = new Date(2024, 0, 1, 10, 0, 0).getTime();
    expect(operand.compareNumber(date1, [dateWithTime])).toBe(false);
  });
});

describe("日付の未満判定", () => {
  it("2024-01-01は2024-02-01未満であるは真", () => {
    const operand = new SheetFilterOperand("<");
    expect(operand.compareNumber(date1, [date2])).toBe(true);
  });

  it("2024-02-01は2024-01-01未満であるは偽", () => {
    const operand = new SheetFilterOperand("<");
    expect(operand.compareNumber(date2, [date1])).toBe(false);
  });

  it("2024-01-01 10:00:00は2024-01-01未満であるは偽", () => {
    const operand = new SheetFilterOperand("<");
    const dateWithTime = new Date(2024, 0, 1, 10, 0, 0).getTime();
    expect(operand.compareNumber(dateWithTime, [date1])).toBe(false);
  });

  it("2024-03-01は2024-02-01未満であるは偽", () => {
    const operand = new SheetFilterOperand("<");
    expect(operand.compareNumber(date3, [date2])).toBe(false);
  });
});

describe("日付の超過比較", () => {
  it("2024-01-01は2024-02-01を超過するは真", () => {
    const operand = new SheetFilterOperand(">");
    expect(operand.compareNumber(date3, [date2])).toBe(true);
  });

  it("2024-02-01は2024-03-01を超過するは偽", () => {
    const operand = new SheetFilterOperand(">");
    expect(operand.compareNumber(date2, [date3])).toBe(false);
  });

  it("以下の場合", () => {
    const operand = new SheetFilterOperand("<=");
    expect(operand.compareNumber(date1, [date2])).toBe(true);
    expect(operand.compareNumber(date2, [date2])).toBe(true);
    expect(operand.compareNumber(date3, [date2])).toBe(false);
  });

  it("以上の場合", () => {
    const operand = new SheetFilterOperand(">=");
    expect(operand.compareNumber(date3, [date2])).toBe(true);
    expect(operand.compareNumber(date2, [date2])).toBe(true);
    expect(operand.compareNumber(date1, [date2])).toBe(false);
  });

  it("等しくない場合", () => {
    const operand = new SheetFilterOperand("!=");
    expect(operand.compareNumber(date1, [date2])).toBe(true);
    expect(operand.compareNumber(date1, [date1])).toBe(false);
  });
});

describe("一般の比較", () => {
  it("等しい場合", () => {
    const operand = new SheetFilterOperand("=");
    expect(operand.compare("test", ["test", "example"])).toBe(true);
    expect(operand.compare("test", ["example"])).toBe(false);
  });

  it("より小さい場合", () => {
    const operand = new SheetFilterOperand("<");
    expect(operand.compareNumber(5, [10])).toBe(true);
    expect(operand.compareNumber(10, [5])).toBe(false);
  });

  it("より大きい場合", () => {
    const operand = new SheetFilterOperand(">");
    expect(operand.compareNumber(10, [5])).toBe(true);
    expect(operand.compareNumber(5, [10])).toBe(false);
  });

  it("以下の場合", () => {
    const operand = new SheetFilterOperand("<=");
    expect(operand.compareNumber(5, [10])).toBe(true);
    expect(operand.compareNumber(10, [10])).toBe(true);
    expect(operand.compareNumber(15, [10])).toBe(false);
  });

  it("以上の場合", () => {
    const operand = new SheetFilterOperand(">=");
    expect(operand.compareNumber(15, [10])).toBe(true);
    expect(operand.compareNumber(10, [10])).toBe(true);
    expect(operand.compareNumber(5, [10])).toBe(false);
  });

  it("等しくない場合", () => {
    const operand = new SheetFilterOperand("!=");
    expect(operand.compare("test", ["example"])).toBe(true);
    expect(operand.compare("test", ["test"])).toBe(false);
  });

  it("文字列の大なり比較はエラー", () => {
    const operand = new SheetFilterOperand(">");
    expect(() => operand.compare("a", ["b"])).toThrowError();
  });
});

describe("例外ケース", () => {
  it("数値比較で文字列演算子はエラー", () => {
    const operand = new SheetFilterOperand("*");
    expect(() => operand.compareNumber(1, [1])).toThrowError();
  });

  it("文字列比較で数値演算子はエラー", () => {
    const operand = new SheetFilterOperand(">");
    expect(() => operand.compareString("a", ["b"])).toThrowError();
  });

  it("一般比較で非対応演算子はエラー", () => {
    const operand = new SheetFilterOperand("<");
    expect(() => operand.compare("a", ["a"])).toThrowError();
  });
});

describe("演算子判定", () => {
  it("isMoreThanOrLessThan は大小比較演算子で true", () => {
    expect(new SheetFilterOperand("<").isMoreThanOrLessThan()).toBe(true);
    expect(new SheetFilterOperand(">=").isMoreThanOrLessThan()).toBe(true);
  });

  it("isMoreThanOrLessThan は等価演算子で false", () => {
    expect(new SheetFilterOperand("=").isMoreThanOrLessThan()).toBe(false);
  });

  it("isStringOperator は文字列演算子で true", () => {
    expect(new SheetFilterOperand("*").isStringOperator()).toBe(true);
    expect(new SheetFilterOperand("*$").isStringOperator()).toBe(true);
  });

  it("isStringOperator は非文字列演算子で false", () => {
    expect(new SheetFilterOperand("=").isStringOperator()).toBe(false);
  });

  it("isEqualityOperator は等価演算子で true", () => {
    expect(new SheetFilterOperand("=").isEqualityOperator()).toBe(true);
    expect(new SheetFilterOperand("!=").isEqualityOperator()).toBe(true);
  });

  it("isEqualityOperator は非等価演算子で false", () => {
    expect(new SheetFilterOperand(">=").isEqualityOperator()).toBe(false);
  });
});
