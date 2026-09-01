import { describe, expect, it } from "vitest";
import { SheetOrderBy } from "../../../src/query/SheetOrderBy";

describe("SheetOrderBy", () => {
  it("年齢で昇順", () => {
    const orderByAgeAsc = new SheetOrderBy("年齢", "asc");
    const sampleA = { 名前: "太郎", 年齢: 30 };
    const sampleB = { 名前: "花子", 年齢: 25 };
    expect(orderByAgeAsc.sort(sampleA, sampleB)).toBeGreaterThan(0);
    expect(orderByAgeAsc.sort(sampleB, sampleA)).toBeLessThan(0);
  });

  it("年齢で降順", () => {
    const orderByAgeDesc = new SheetOrderBy("年齢", "desc");
    const sampleA = { 名前: "太郎", 年齢: 30 };
    const sampleB = { 名前: "花子", 年齢: 25 };
    expect(orderByAgeDesc.sort(sampleA, sampleB)).toBeLessThan(0);
    expect(orderByAgeDesc.sort(sampleB, sampleA)).toBeGreaterThan(0);
  });

  it("同じ年齢は０を返す", () => {
    const orderByAgeAsc = new SheetOrderBy("年齢", "asc");
    const sampleA = { 名前: "太郎", 年齢: 30 };
    const sampleB = { 名前: "次郎", 年齢: 30 };
    expect(orderByAgeAsc.sort(sampleA, sampleB)).toBe(0);
    expect(orderByAgeAsc.sort(sampleB, sampleA)).toBe(0);
  });

  it("名前で昇順", () => {
    const orderByNameAsc = new SheetOrderBy("名前", "asc");
    const sampleA = { 名前: "apple", 年齢: 30 };
    const sampleB = { 名前: "banana", 年齢: 25 };
    expect(orderByNameAsc.sort(sampleA, sampleB)).toBeLessThan(0);
    expect(orderByNameAsc.sort(sampleB, sampleA)).toBeGreaterThan(0);
  });

  it("名前で降順", () => {
    const orderByNameDesc = new SheetOrderBy("名前", "desc");
    const sampleA = { 名前: "apple", 年齢: 30 };
    const sampleB = { 名前: "banana", 年齢: 25 };
    expect(orderByNameDesc.sort(sampleA, sampleB)).toBeGreaterThan(0);
    expect(orderByNameDesc.sort(sampleB, sampleA)).toBeLessThan(0);
  });

  it("不正な方向はエラー", () => {
    const orderByInvalid = new SheetOrderBy("名前", "invalid" as any);
    const sampleA = { 名前: "apple", 年齢: 30 };
    const sampleB = { 名前: "banana", 年齢: 25 };
    expect(() => orderByInvalid.sort(sampleA, sampleB)).toThrowError(
      "Invalid sort direction: invalid",
    );
  });
});
