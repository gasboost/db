import { z } from "zod";
import { defineTable, type TableChange } from "../src";
const users = defineTable({
  name: "users",
  primaryKey: "id",
  schema: z.object({ id: z.string(), name: z.string() }),
});
const items = defineTable({
  name: "items",
  primaryKey: "id",
  schema: z.object({ id: z.number(), price: z.number() }),
});
type Change = TableChange<typeof users | typeof items>;
const changes: Change[] = [
  { table: "users", before: null, after: { id: "1", name: "created" } },
  {
    table: "users",
    before: { id: "1", name: "created" },
    after: { id: "1", name: "updated" },
  },
  { table: "items", before: { id: 1, price: 10 }, after: null },
];
// @ts-expect-error null/null is not a change
const empty: Change = { table: "users", before: null, after: null };
const mismatch: Change = {
  table: "items",
  before: null,
  // @ts-expect-error table and record must correlate across the union
  after: { id: "1", name: "wrong" },
};
const unknown: Change = {
  // @ts-expect-error unknown table
  table: "missing",
  before: null,
  after: { id: "1", name: "wrong" },
};
// @ts-expect-error all record fields are required
const partial: Change = { table: "users", before: null, after: { id: "1" } };
for (const change of changes) {
  if (change.table === "items" && change.after) {
    const price: number = change.after.price;
    void price;
  }
}
void [empty, mismatch, unknown, partial];
