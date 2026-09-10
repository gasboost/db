import { z } from "zod";
import { createReplica } from "../src";

const schema = z.object({
  id: z.string(),
  name: z.string(),
});

createReplica({
  name: "valid",
  tables: [
    {
      name: "users",
      schema,
      primaryKey: "id",
    },
  ] as const,
});

const invalidTables = [
  {
    name: "users",
    schema,
    primaryKey: "missing",
  },
] as const;

createReplica({
  name: "invalid",
  // @ts-expect-error primaryKey "missing" does not exist in schema
  tables: invalidTables,
});
