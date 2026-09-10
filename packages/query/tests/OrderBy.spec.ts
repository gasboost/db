import { describe, expect, it } from "vitest";
import { OrderBy } from "../src/OrderBy";

describe("OrderBy", () => {
  it("numberを昇順に比較できる", () => {
    const orderBy = new OrderBy("age", "asc");

    expect(orderBy.sort({ age: 10 }, { age: 20 })).toBeLessThan(0);
    expect(orderBy.sort({ age: 20 }, { age: 10 })).toBeGreaterThan(0);
    expect(orderBy.sort({ age: 10 }, { age: 10 })).toBe(0);
  });

  it("numberを降順に比較できる", () => {
    const orderBy = new OrderBy("age", "desc");

    expect(orderBy.sort({ age: 10 }, { age: 20 })).toBeGreaterThan(0);
    expect(orderBy.sort({ age: 20 }, { age: 10 })).toBeLessThan(0);
  });

  it("stringを昇順に比較できる", () => {
    const records = [{ name: "Charlie" }, { name: "Alice" }, { name: "Bob" }];

    const orderBy = new OrderBy("name", "asc");

    records.sort((a, b) => orderBy.sort(a, b));

    expect(records.map((record) => record.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("Dateを昇順に比較できる", () => {
    const records = [
      { date: new Date("2026-01-03") },
      { date: new Date("2026-01-01") },
      { date: new Date("2026-01-02") },
    ];

    const orderBy = new OrderBy("date", "asc");

    records.sort((a, b) => orderBy.sort(a, b));

    expect(records.map((record) => record.date.getDate())).toEqual([1, 2, 3]);
  });
});
