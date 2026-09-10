import { describe, expect, it } from "vitest";
import { FilterOperand } from "../src/FilterOperand";

describe("FilterOperand", () => {
  it("値を保持する", () => {
    const operand = new FilterOperand(["a", "b"]);

    expect(operand.getValue()).toEqual(["a", "b"]);
  });

  it("空配列を拒否する", () => {
    expect(() => new FilterOperand([])).toThrow("values must not be empty");
  });

  it("異なる型の値が混在している場合は拒否する", () => {
    expect(() => new FilterOperand(["a", 1])).toThrow(
      "values must be all the same type",
    );
  });

  it("stringを判定できる", () => {
    const operand = new FilterOperand(["a"]);

    expect(operand.isString()).toBe(true);
  });

  it("numberはstringではない", () => {
    const operand = new FilterOperand([1]);

    expect(operand.isString()).toBe(false);
  });

  it("stringをstringまたはbooleanとして判定できる", () => {
    const operand = new FilterOperand(["a"]);

    expect(operand.isStringOrBoolean()).toBe(true);
  });

  it("booleanをstringまたはbooleanとして判定できる", () => {
    const operand = new FilterOperand([true]);

    expect(operand.isStringOrBoolean()).toBe(true);
  });

  it("numberはstringまたはbooleanではない", () => {
    const operand = new FilterOperand([1]);

    expect(operand.isStringOrBoolean()).toBe(false);
  });

  it("Dateを判定できる", () => {
    const operand = new FilterOperand([new Date("2026-01-01T00:00:00Z")]);

    expect(operand.isDate()).toBe(true);
  });

  it("Dateをtimestampへ変換できる", () => {
    const first = new Date("2026-01-01T00:00:00Z");
    const second = new Date("2026-01-02T00:00:00Z");

    const operand = new FilterOperand([first, second]);

    expect(operand.getTimes()).toEqual([first.getTime(), second.getTime()]);
  });

  it("Date以外でgetTimesを呼ぶとエラーになる", () => {
    const operand = new FilterOperand([1]);

    expect(() => operand.getTimes()).toThrow("values are not Date type");
  });
});
