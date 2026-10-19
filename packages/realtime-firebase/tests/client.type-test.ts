import { defineTable } from "@gasboost/table";
import { z } from "zod";
import { versionPath } from "../src/client";

const table = defineTable({ name: "products", schema: z.object({ id: z.string() }) });
versionPath(table);
// @ts-expect-error The Frontend API requires a shared TableDefinition.
versionPath("products");
// @ts-expect-error A name alone is not a TableDefinition.
versionPath({ name: "products" });
