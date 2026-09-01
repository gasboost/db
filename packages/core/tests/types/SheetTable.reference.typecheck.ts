import { z } from "zod";
import { SheetTable } from "../../src/SheetTable";

const users = new SheetTable(
  "db",
  "users",
  z.object({ id: z.number() }),
  "id",
  false,
);

const nullablePosts = new SheetTable(
  "db",
  "nullablePosts",
  z.object({ id: z.number(), userId: z.number().nullable() }),
  "id",
  false,
);

const requiredPosts = new SheetTable(
  "db",
  "requiredPosts",
  z.object({ id: z.number(), userId: z.number() }),
  "id",
  false,
);

const stringPosts = new SheetTable(
  "db",
  "stringPosts",
  z.object({ id: z.number(), userId: z.string() }),
  "id",
  false,
);

nullablePosts.reference("userId", users, "id", "cascade");
nullablePosts.reference("userId", users, "id", "set null");
requiredPosts.reference("userId", users, "id", "restrict");

// @ts-expect-error child/parent column types must match
stringPosts.reference("userId", users, "id", "cascade");

// @ts-expect-error set null requires a nullable child column
requiredPosts.reference("userId", users, "id", "set null");
