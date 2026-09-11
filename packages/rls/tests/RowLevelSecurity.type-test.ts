import { z } from "zod";
import { column, eq, principal } from "../src";

const DealSchema = z.object({
  id: z.string(),
  salesPersonId: z.string(),
  amount: z.number(),
});

const deals = {
  name: "deals",
  schema: DealSchema,
} as const;

const principalSchema = z.object({
  userId: z.string(),
  role: z.enum(["sales", "manager"]),
});

column(deals, "salesPersonId");

// @ts-expect-error unknown column
column(deals, "unknown");

principal(principalSchema, "userId");

// @ts-expect-error unknown principal key
principal(principalSchema, "unknown");

eq(column(deals, "salesPersonId"), principal(principalSchema, "userId"));

// @ts-expect-error string !== number
eq(column(deals, "amount"), principal(principalSchema, "userId"));
