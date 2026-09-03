# SheetORM

Google Apps Script / Google Sheets 向けの、Zod ベースの型安全な ORM です。

SheetORM は Google Sheets の各シートをテーブルとして扱い、Zod Schema から推論された `Record` に対して CRUD、Query、Relation、Transaction などの操作を提供します。

```text
Google Sheets
    ↓
SheetGateway
    ↓
SheetDB
    ↓
Record<string, ...>
    ↓
Application / Repository / Domain
```

---

## Efficient Spreadsheet I/O

SheetORM は、Google Apps Script から Google Sheets への I/O 回数を抑えることを重要な設計方針としています。

Record ごとに Spreadsheet API を呼び出すのではなく、可能な限り Table 単位でデータをまとめて取得し、Filter、Sort、Relation、JOIN などの処理をメモリ上で行ったうえで、変更結果をまとめて書き戻します。

```text
避ける

Record
  ↓ API
Record
  ↓ API
Record
  ↓ API

採用

Table
  ↓ read
Records
  ↓ memory processing
Records
  ↓ write
Table
```

これにより、不要な Spreadsheet API 呼び出しを避け、GAS の実行時間と外部 I/O の削減を図ります。

---

## Features

- Zod Schema による型安全な Record
- Create / Find / Update / Upsert / Delete
- 数値 Auto Increment
- UUID Auto Numbering
- Unique Constraint
- Optimistic Lock
- AND / OR Filter
- Order By
- Limit / Offset
- JOIN
- Recursive JOIN
- Relation
- Cascade / Set Null / Restrict
- Nested Create
- Transaction
- Commit / Rollback
- Migration
- Seed
- Sheet Protection

---

# Installation

```bash
pnpm add @gasboost/sheetorm zod
```

npm の場合:

```bash
npm install @gasboost/sheetorm zod
```

## Requirements

SheetORM は Google Apps Script 環境での利用を前提としています。

以下の GAS Built-in API を利用します。

- `SpreadsheetApp`
- `CacheService`
- `Utilities`

TypeScript で GAS を開発する場合は、必要に応じて型定義も追加してください。

```bash
pnpm add -D @types/google-apps-script
```

---

# Quick Start

まず Zod Schema と `SheetTable` を定義します。

```ts
import { z } from "zod";
import { SheetDB, SheetGateway, SheetTable } from "@gasboost/sheetorm";

const userSchema = z.object({
  id: z.number().meta({
    primary: true,
    autoIncrement: true,
  }),
  name: z.string(),
  email: z.string().meta({
    unique: true,
  }),
});

const userTable = new SheetTable(
  "SPREADSHEET_ID",
  "users",
  userSchema,
  "id",
  true,
);

const db = new SheetDB(
  [userTable] as const,
  new SheetGateway(SpreadsheetApp),
  CacheService,
  Utilities,
);
```

Google Sheets 側には `users` シートを用意します。

```text
id | name | email
```

Record を作成します。

```ts
const users = db.table("users").create([
  {
    name: "Alice",
    email: "alice@example.com",
  },
]);
```

取得します。

```ts
const users = db.table("users").find();
```

Zod Schema から Record の型が推論されるため、利用側で `SheetEntity` を定義する必要はありません。

---

# Table

## SheetTable

テーブルは `SheetTable` と Zod Schema で定義します。

```ts
const userSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const userTable = new SheetTable(
  "SPREADSHEET_ID",
  "users",
  userSchema,
  "id",
  false,
);
```

基本形は以下です。

```ts
new SheetTable(
  spreadsheetId,
  tableName,
  schema,
  primaryKey,
  autoIncrement,
  options?,
);
```

---

# Primary Key

Primary Key は `SheetTable` のコンストラクタで指定します。

```ts
const schema = z.object({
  id: z.number().meta({
    primary: true,
  }),
  name: z.string(),
});

const table = new SheetTable("SPREADSHEET_ID", "users", schema, "id", false);
```

---

# Auto Increment

数値 Primary Key を自動採番できます。

```ts
const schema = z.object({
  id: z.number().meta({
    primary: true,
    autoIncrement: true,
  }),
  name: z.string(),
});

const table = new SheetTable("SPREADSHEET_ID", "users", schema, "id", true);
```

Create 時には Primary Key を省略できます。

```ts
db.table("users").create([
  {
    name: "Alice",
  },
  {
    name: "Bob",
  },
]);
```

例えば現在の最大 ID が `10` の場合、

```text
Alice -> 11
Bob   -> 12
```

のように採番されます。

採番時には Cache と Lock を使用し、同時実行による番号重複を防止します。

---

# UUID Auto Numbering

文字列 Primary Key には UUID 自動採番を利用できます。

```ts
const schema = z.object({
  id: z.string().meta({
    primary: true,
    autoIncrement: true,
  }),
  name: z.string(),
});

const table = new SheetTable("SPREADSHEET_ID", "users", schema, "id", true, {
  autoNumberingMode: "uuid",
});
```

```ts
db.table("users").create([
  {
    name: "Alice",
  },
]);
```

UUID は GAS の `Utilities.getUuid()` から生成されます。

---

# Unique Constraint

Zod field の metadata に `unique: true` を指定します。

```ts
const schema = z.object({
  id: z.number().meta({
    primary: true,
  }),
  email: z.string().meta({
    unique: true,
  }),
});
```

同じ値を持つ Record を Create / Update しようとするとエラーになります。

```ts
db.table("users").create([
  {
    id: 1,
    email: "alice@example.com",
  },
]);

db.table("users").create([
  {
    id: 2,
    email: "alice@example.com",
  },
]);
```

後者は Unique Constraint Violation になります。

---

# Optimistic Lock

Version Column を指定すると Optimistic Lock を有効にできます。

```ts
const schema = z.object({
  id: z.number().meta({
    primary: true,
  }),
  name: z.string(),
  version: z.number(),
});

const table = new SheetTable("SPREADSHEET_ID", "users", schema, "id", false, {
  versionColumn: "version",
});
```

更新時には現在の Version と一致する値を渡す必要があります。

```ts
db.table("users").update([
  {
    id: 1,
    name: "Alice Updated",
    version: 1,
  },
]);
```

現在の Version が `1` なら、更新成功後は `2` になります。

別処理によって Version がすでに更新されている場合は Optimistic Lock Error になります。

---

# CRUD

## Create

```ts
const created = db.table("users").create([
  {
    name: "Alice",
    email: "alice@example.com",
  },
]);
```

Create は作成された Record を返します。

```ts
created[0].name;
```

Auto Increment / UUID が有効な場合は、採番後の Primary Key を含む Record が返ります。

---

# Find

テーブル内の Record をすべて取得します。

```ts
const users = db.table("users").find();
```

戻り値は Schema から推論された Record 配列です。

```ts
users[0].id;
users[0].name;
users[0].email;
```

---

# Update

Record を更新します。

```ts
const updated = db.table("users").update([
  {
    id: 1,
    name: "Alice Updated",
    email: "alice@example.com",
  },
]);
```

Primary Key を使って既存 Record を特定します。

Optimistic Lock が設定されている場合は Version も必要です。

---

# Upsert

Primary Key の存在状態によって Create / Update を自動的に振り分けます。

```ts
const records = db.table("users").upsert([
  {
    id: 1,
    name: "Existing User",
    email: "existing@example.com",
  },
  {
    name: "New User",
    email: "new@example.com",
  },
]);
```

既存 Primary Key が存在する Record は Update されます。

Primary Key が空で Auto Increment が有効な場合は Create されます。

Primary Key が存在しない Record についても、Auto Increment が有効なら新しい Primary Key が採番されます。

---

# Delete

Primary Key を指定して削除します。

```ts
db.table("users").delete([1]);
```

複数削除も可能です。

```ts
db.table("users").delete([1, 2, 3]);
```

Relation が設定されている場合は、Relation の `onDelete` 設定に従って関連 Record も処理されます。

---

# Query

`SheetDB.query()` から Query を作成します。

```ts
const query = db.query("users").and("name", "=", ["Alice"]);

const users = db.find(query);
```

Query の column と値は Zod Schema から型推論されます。

---

# Filter

## AND

`.and()` に指定された条件はすべて満たす必要があります。

```ts
const query = db
  .query("users")
  .and("age", ">=", [20])
  .and("active", "=", [true]);
```

---

## OR

複数の `.or()` が指定された場合、そのうち1つ以上を満たす Record が取得されます。

```ts
const query = db
  .query("users")
  .or("name", "=", ["Alice"])
  .or("name", "=", ["Bob"]);
```

AND と OR は組み合わせられます。

```ts
const query = db
  .query("users")
  .and("active", "=", [true])
  .or("name", "=", ["Alice"])
  .or("name", "=", ["Bob"]);
```

この場合、

- `active === true`
- `name === "Alice"` または `name === "Bob"`

の両方を満たす Record が対象になります。

---

# Filter Operators

利用可能な Operand は以下です。

| Operand | 意味               |
| ------- | ------------------ |
| `=`     | 等しい             |
| `!=`    | 等しくない         |
| `<`     | より小さい         |
| `>`     | より大きい         |
| `<=`    | 以下               |
| `>=`    | 以上               |
| `*`     | 文字列を含む       |
| `!*`    | 文字列を含まない   |
| `^*`    | 指定文字列で始まる |
| `*$`    | 指定文字列で終わる |

例:

```ts
db.query("users").and("name", "*", ["Ali"]);
```

---

# Order By

```ts
const query = db.query("users").orderBy("name", "asc");
```

降順:

```ts
const query = db.query("users").orderBy("name", "desc");
```

---

# Limit

```ts
const query = db.query("users").limit(10);
```

---

# Offset

```ts
const query = db.query("users").offset(10).limit(10);
```

---

# JOIN

JOIN された Record は `relations` に格納されます。

例えば以下の2テーブルがあるとします。

```text
users
id | name

posts
id | userId | title
```

Schema:

```ts
const userSchema = z.object({
  id: z.number().meta({
    primary: true,
  }),
  name: z.string(),
});

const postSchema = z.object({
  id: z.number().meta({
    primary: true,
  }),
  userId: z.number(),
  title: z.string(),
});
```

Query:

```ts
const query = db.query("users").join("id", "posts", "userId");

const users = db.find(query);
```

結果は次の形になります。

```ts
[
  {
    id: 1,
    name: "Alice",
    relations: {
      posts: [
        {
          id: 10,
          userId: 1,
          title: "Hello",
        },
      ],
    },
  },
];
```

`join()` の引数は以下です。

```ts
join(
  thisTableColumn,
  referenceTableName,
  referenceTableColumn,
  query?,
)
```

---

# Recursive JOIN

JOIN 先の Query にさらに JOIN を設定できます。

例えば、

```text
users
  ↓
posts
  ↓
comments
```

という構造なら、

```ts
const postQuery = db.query("posts").join("id", "comments", "postId");

const userQuery = db.query("users").join("id", "posts", "userId", postQuery);

const users = db.find(userQuery);
```

結果は入れ子の `relations` として取得されます。

```ts
[
  {
    id: 1,
    name: "Alice",
    relations: {
      posts: [
        {
          id: 10,
          userId: 1,
          title: "Hello",
          relations: {
            comments: [
              {
                id: 100,
                postId: 10,
                body: "Comment",
              },
            ],
          },
        },
      ],
    },
  },
];
```

---

# Relation

Relation は子テーブル側から `reference()` で定義します。

```ts
postTable.reference("userId", userTable, "id", "cascade");
```

これは、

```text
posts.userId
    ↓
users.id
```

という参照を表します。

`reference()` は以下の形式です。

```ts
childTable.reference(foreignKey, parentTable, parentKey, onDelete);
```

---

# Cascade

親 Record が削除された時、関連する子 Record も削除します。

```ts
postTable.reference("userId", userTable, "id", "cascade");
```

```text
users.id = 1 DELETE
        ↓
posts.userId = 1 DELETE
```

Cascade は子・孫・それ以降にも再帰的に適用されます。

```text
users
  ↓ cascade
posts
  ↓ cascade
comments
```

`users` を削除すると、対象となる `posts` と `comments` も削除されます。

---

# Set Null

親 Record が削除された時、子 Record の Foreign Key を `null` にします。

```ts
postTable.reference("userId", userTable, "id", "set null");
```

```text
before

posts.userId = 1

after parent delete

posts.userId = null
```

Schema 側でも `null` を許容してください。

```ts
const postSchema = z.object({
  id: z.number(),
  userId: z.number().nullable(),
});
```

---

# Restrict

参照している子 Record が存在する場合、親 Record の削除を拒否します。

```ts
postTable.reference("userId", userTable, "id", "restrict");
```

```text
users.id = 1
    ↑
posts.userId = 1
```

この状態で `users.id = 1` を削除するとエラーになります。

Cascade の途中で Restrict が見つかった場合も、削除全体が失敗します。

```text
A
↓ cascade
B
↓ restrict
C
```

`A` を削除しようとしても `C` が `B` を参照しているため、`A` / `B` / `C` は変更されません。

---

# Relation Tree

`SheetTable` は自身から到達可能な Relation Tree を保持します。

```ts
table.getRelationTree();
```

Relation Tree は子孫 Relation を再帰的に取得します。

循環 Relation が存在する場合は visited 制御によって無限再帰を防止します。

---

# Nested Create

Create 時に `relations` を指定すると、親と子をまとめて作成できます。

```ts
const created = db.table("users").create([
  {
    name: "Alice",
    relations: {
      posts: [
        {
          title: "First Post",
        },
        {
          title: "Second Post",
        },
      ],
    },
  },
]);
```

Relation:

```ts
postTable.reference("userId", userTable, "id", "cascade");
```

親の Primary Key が自動採番された場合、その値が子 Record の Foreign Key に伝播されます。

```text
users.id = 1
      ↓
posts.userId = 1
```

---

# Multi-level Nested Create

Nested Create は複数階層に対応します。

```ts
db.table("users").create([
  {
    name: "Alice",
    relations: {
      posts: [
        {
          title: "First Post",
          relations: {
            comments: [
              {
                body: "Hello",
              },
            ],
          },
        },
      ],
    },
  },
]);
```

Relation を、

```text
users
  ↓
posts
  ↓
comments
```

と定義していれば、

```text
user PK
↓
post FK

post PK
↓
comment FK
```

のように各階層で親 Key が子 Foreign Key に伝播されます。

---

# Transaction

複数の書き込み操作を Transaction として実行できます。

```ts
db.transaction(() => {
  db.table("users").create([
    {
      name: "Alice",
      email: "alice@example.com",
    },
  ]);

  db.table("posts").create([
    {
      userId: 1,
      title: "Hello",
    },
  ]);
});
```

Transaction 内の Write Command は各 Table の `SheetCache` に保持され、commit 時に実行されます。

---

# Commit

Transaction が正常終了すると、各 Table に保持された Command が commit されます。

概念的には、

```text
transaction
    ↓
SheetCache
    ↓
Create / Update / Delete Commands
    ↓
commit
    ↓
Google Sheets
```

という流れになります。

---

# Rollback

Transaction の commit 中にエラーが発生した場合、変更前 Snapshot を使って rollback します。

```ts
try {
  db.transaction(() => {
    // operations
  });
} catch (error) {
  // Transactionはrollback済み
}
```

Cascade Delete や Set Null により複数 Table が変更された場合も、Transaction の rollback 対象になります。

---

# SheetCache

`SheetCache` は Transaction 内で、

- Write Command
- Transaction 開始前の Record Snapshot

を保持します。

利用側から通常直接操作する必要はありません。

---

# Migrate

Zod Schema の column 定義を Google Sheets に反映します。

```ts
db.migrate();
```

登録されている各 `SheetTable` が対象になります。

例えば、

```ts
const schema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});
```

なら、

```text
id | name | email
```

という column 構成を Sheet に設定します。

Migration 中は対象 Table ごとに Lock が取得されます。

---

# Seed

空の Table に初期データを投入します。

```ts
db.seed("users", [
  {
    id: 1,
    name: "Admin",
    email: "admin@example.com",
  },
]);
```

対象 Table が空でない場合は Seed されません。

空判定と Insert は同一 Lock 内で実行されるため、同時実行による二重投入を防止します。

---

# Protect

登録されている Sheet を保護します。

```ts
db.protect();
```

各 Table に対応する Sheet に対して Gateway の Protection 処理が実行されます。

---

# Complete Example

```ts
import { z } from "zod";
import { SheetDB, SheetGateway, SheetTable } from "@gasboost/sheetorm";

const userSchema = z.object({
  id: z.string().meta({
    primary: true,
    autoIncrement: true,
  }),
  name: z.string(),
  email: z.string().meta({
    unique: true,
  }),
  version: z.number(),
});

const postSchema = z.object({
  id: z.string().meta({
    primary: true,
    autoIncrement: true,
  }),
  userId: z.string(),
  title: z.string(),
});

const commentSchema = z.object({
  id: z.string().meta({
    primary: true,
    autoIncrement: true,
  }),
  postId: z.string(),
  body: z.string(),
});

const userTable = new SheetTable(
  "SPREADSHEET_ID",
  "users",
  userSchema,
  "id",
  true,
  {
    autoNumberingMode: "uuid",
    versionColumn: "version",
  },
);

const postTable = new SheetTable(
  "SPREADSHEET_ID",
  "posts",
  postSchema,
  "id",
  true,
  {
    autoNumberingMode: "uuid",
  },
);

const commentTable = new SheetTable(
  "SPREADSHEET_ID",
  "comments",
  commentSchema,
  "id",
  true,
  {
    autoNumberingMode: "uuid",
  },
);

postTable.reference("userId", userTable, "id", "cascade");

commentTable.reference("postId", postTable, "id", "cascade");

const db = new SheetDB(
  [userTable, postTable, commentTable] as const,
  new SheetGateway(SpreadsheetApp),
  CacheService,
  Utilities,
);

db.migrate();

const [user] = db.table("users").create([
  {
    name: "Alice",
    email: "alice@example.com",
    version: 1,
    relations: {
      posts: [
        {
          title: "First Post",
          relations: {
            comments: [
              {
                body: "Hello",
              },
            ],
          },
        },
      ],
    },
  },
]);

const postQuery = db.query("posts").join("id", "comments", "postId");

const userQuery = db
  .query("users")
  .and("name", "=", ["Alice"])
  .join("id", "posts", "userId", postQuery);

const users = db.find(userQuery);

console.log(users);

db.transaction(() => {
  db.table("users").update([
    {
      ...user,
      name: "Alice Updated",
    },
  ]);
});
```

---

# Responsibility Boundary

SheetORM が扱う範囲は **Record まで**です。

```text
Google Sheets
     ↓
SheetORM
     ↓
Record
     ↓
Application Repository
     ↓
Domain Entity
```

SheetORM 内では Domain Entity を生成しません。

例えば Domain Model がある場合、

```ts
class User {
  constructor(
    public readonly id: string,
    public readonly name: string,
  ) {}
}
```

SheetORM から取得した Record を Domain Entity に変換する責務は、利用側 Repository に置きます。

```ts
class UserRepository {
  constructor(private db: typeof db) {}

  findAll(): User[] {
    return this.db
      .table("users")
      .find()
      .map((record) => new User(record.id, record.name));
  }
}
```

逆方向も同様です。

```ts
class UserRepository {
  save(user: User): void {
    this.db.table("users").upsert([
      {
        id: user.id,
        name: user.name,
      },
    ]);
  }
}
```

ORM と Domain の責務を分離することで、SheetORM は特定の Domain Model に依存しません。

---

# Migration from old SheetORM

旧 SheetORM では ORM が `SheetEntity` に依存し、Record と Entity の変換を内部で行っていました。

現在の SheetORM ではこの依存を削除しています。

不要になったもの:

```text
SheetEntity
serialize()
deserialize()
entity.pkValue
entity.addRelation()
```

現在は、

```text
Google Sheets
↓
Record
```

を直接扱います。

Relation / JOIN の結果も Entity に格納するのではなく、

```ts
{
  ...record,
  relations: {
    childTable: [
      // child records
    ],
  },
}
```

という Record 構造で返されます。

Domain Entity が必要な場合は、利用側の Repository などで変換してください。

---

# Design Principle

SheetORM の責務は、

> Google Sheets を型安全な Record Store として扱うこと

です。

Domain Model の構築や Business Logic は SheetORM の責務ではありません。

これにより、

- ORM と Domain の疎結合化
- SheetEntity 継承の排除
- Zod Schema を Single Source of Truth とした型推論
- Repository 層での自由な Domain Mapping

を可能にしています。

また、Google Sheets との I/O は可能な限り Table 単位に集約し、取得後の処理をメモリ上で行うことで、Spreadsheet API 呼び出し回数の最小化を図ります。
