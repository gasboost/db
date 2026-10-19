import { defineTable } from "@gasboost/table";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { versionPath } from "../src/client";
import { FirebaseRtdb } from "../src";

const productsTable = defineTable({
  name: "products",
  schema: z.object({ id: z.string() }),
  primaryKey: "id",
});

describe("browser client", () => {
  it.each([
    [productsTable, "/syncVersions/products"],
    [{ ...productsTable, name: "items" }, "/syncVersions/items"],
    [{ ...productsTable, name: "sales.2026" }, "/syncVersions/sales2026"],
    [{ ...productsTable, name: "a.#$[]/\u0000\u001f\u007f\u009fb" }, "/syncVersions/ab"],
    [{ ...productsTable, name: "売上 2026" }, "/syncVersions/売上 2026"],
  ])("uses the shared definition for %j", (table, expectedPath) => {
    const patch = vi.fn();
    const next = vi.fn(() => 42);
    const rtdb = new FirebaseRtdb({ versionStore: { next }, transport: { patch } });
    expect(versionPath(table)).toBe(expectedPath);
    rtdb.publish([{ table: table.name }]);
    expect(next).toHaveBeenCalledExactlyOnceWith(table.name);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      [expectedPath.slice(1)]: 42,
    });
  });

  it.each(["", ".#$[]/\u0000\u001f\u007f\u009f"])(
    "rejects an empty normalized destination (%j) before any side effects",
    (name) => {
      const table = { ...productsTable, name };
      const next = vi.fn();
      const patch = vi.fn();
      const rtdb = new FirebaseRtdb({ versionStore: { next }, transport: { patch } });
      expect(() => versionPath(table)).toThrow("empty after RTDB path normalization");
      expect(() => rtdb.publish([{ table: "products" }, { table: name }])).toThrow(
        "empty after RTDB path normalization",
      );
      expect(next).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["sales.2026", "sales2026"],
    ["sales2026", "sales.2026"],
  ])("rejects colliding destinations in either order: %s / %s", (first, second) => {
    const next = vi.fn();
    const patch = vi.fn();
    const rtdb = new FirebaseRtdb({ versionStore: { next }, transport: { patch } });
    expect(() => rtdb.publish([{ table: first }, { table: second }])).toThrow(
      "notification path collision",
    );
    expect(next).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    // Failed validation must not reserve any destinations.
    rtdb.publish([{ table: second }]);
    expect(next).toHaveBeenCalledExactlyOnceWith(second);
  });

  it("remembers destinations across commits in the same backend instance", () => {
    const next = vi.fn(() => 1);
    const patch = vi.fn();
    const rtdb = new FirebaseRtdb({ versionStore: { next }, transport: { patch } });
    rtdb.publish([{ table: "sales.2026" }, { table: "sales.2026" }]);
    next.mockClear();
    patch.mockClear();
    expect(() => rtdb.publish([{ table: "sales2026" }])).toThrow(
      "notification path collision",
    );
    expect(next).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
