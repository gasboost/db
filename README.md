# SheetORM

SheetORM is a type-safe Record-oriented ORM for Google Apps Script and Google Sheets.

It treats Google Sheets as tables and rows as plain JavaScript objects. Domain entities, aggregates, and repositories stay outside SheetORM; SheetORM does not require inheritance from an ORM base class and does not construct domain objects.

## Install

```bash
pnpm add @gasboost/sheetorm zod
```

SheetORM is designed for Google Apps Script. `SheetGateway` uses `SpreadsheetApp`, and production use should pass GAS `CacheService` and `Utilities` to `SheetDB` so locking and UUID generation use the GAS runtime.

## Define tables with Zod

```ts
import { z } from "zod";
import { SheetDB, SheetGateway, SheetTable } from "@gasboost/sheetorm";

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().meta({ unique: true }),
});

const postSchema = z.object({
  id: z.string(),
  userId: z.number(),
  title: z.string(),
});

const users = new SheetTable(
  "SPREADSHEET_ID",
  "users",
  userSchema,
  "id",
  true,
);

const posts = new SheetTable(
  "SPREADSHEET_ID",
  "posts",
  postSchema,
  "id",
  true,
  { autoNumberingMode: "uuid" },
);

posts.reference("userId", users, "id", "cascade");

const gateway = new SheetGateway(SpreadsheetApp);
const db = new SheetDB(
  [users, posts] as const,
  gateway,
  CacheService,
  Utilities,
);
```

`SheetTable` is database metadata. Records are inferred from the Zod schema and remain plain objects.

## Migrate, seed, and protect

`migrate()` writes the Zod schema keys to row 1 of every configured Sheet.

```ts
db.migrate();
```

`seed()` inserts initial records only when the target table is empty. It returns `true` when records were inserted and `false` when the table already contained data.

```ts
db.seed("users", [
  { id: 1, name: "Alice", email: "alice@example.com" },
]);
```

`protect()` applies Sheet protection to every configured table.

```ts
db.protect();
```

## CRUD

```ts
const [created] = db.table("users").create([
  { name: "Alice", email: "alice@example.com" },
]);

const usersFound = db.table("users").find();

db.table("users").update([
  { ...created, name: "Alicia" },
]);

db.table("users").upsert([
  { ...created, name: "Alice" },
]);

db.table("users").delete([created.id]);
```

For auto-increment tables the numeric primary key can be omitted from `create()`. UUID tables use `Utilities.getUuid()`.

## Query and JOIN

```ts
const postQuery = db.query("posts").orderBy("title", "asc");

const query = db
  .query("users")
  .and("name", "=", ["Alice"])
  .join("id", "posts", "userId", postQuery);

const result = db.find(query);
```

JOIN results are typed plain objects. The joined table is added as an array under its table name:

```ts
{
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  posts: [
    { id: "post-1", userId: 1, title: "Hello" },
  ],
}
```

JOIN never creates a domain entity.

## Relations and referential integrity

Relations describe table/column constraints only.

```ts
posts.reference("userId", users, "id", "cascade");
```

Supported delete actions are:

- `cascade`: delete referencing child records
- `set null`: set the child foreign key to `null`; the child column must be nullable
- `restrict`: reject deletion while child records reference the parent

Foreign-key column types are checked at compile time, and create/update/upsert validate that referenced parent records exist.

## Nested Create

```ts
const [user] = db.table("users").createNested([
  {
    record: {
      name: "Alice",
      email: "alice@example.com",
    },
    relations: {
      posts: [
        {
          record: { title: "First post" },
        },
      ],
    },
  },
]);
```

The created parent key is copied into the child foreign key automatically. Nested Create can recurse through multiple relation levels and works with auto-increment and UUID primary keys.

## Transaction

```ts
db.transaction(() => {
  db.table("users").create([
    { name: "Alice", email: "alice@example.com" },
  ]);

  db.table("posts").create([
    { userId: 1, title: "Hello" },
  ]);
});
```

Writes are buffered and committed together. If the callback throws, the transaction is aborted. Table locks protect the transaction from concurrent writes.

## Repository and Domain boundary

SheetORM owns persistence concerns:

- Spreadsheet / Sheet access
- table and column metadata
- Record validation
- CRUD
- Query / JOIN
- foreign-key constraints
- transactions

Your application owns domain concerns:

- Domain Entity / Aggregate classes
- invariants that are not database constraints
- Repository interfaces
- mapping between Records and Domain objects

A repository can restore a domain object explicitly:

```ts
class UserRepository {
  constructor(private readonly db: typeof db) {}

  findById(id: number): User | null {
    const record = this.db
      .find(this.db.query("users").and("id", "=", [id]))[0];

    return record ? User.restore(record) : null;
  }
}
```

The dependency direction is `Repository -> SheetORM`. SheetORM never depends on the application's Domain Entity or Repository implementation.
