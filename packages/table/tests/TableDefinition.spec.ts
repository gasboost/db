import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTable } from "../src";

describe("defineTable", () => {
  it("returns the table definition unchanged", () => {
    const schema = z.object({
      id: z.string(),
      name: z.string(),
    });

    const table = {
      name: "users",
      schema,
      primaryKey: "id",
    } as const;

    expect(defineTable(table)).toBe(table);
  });
});
