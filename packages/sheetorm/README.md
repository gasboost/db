# @gasboost/sheetorm

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

## Public API

現在 `@gasboost/sheetorm` から公開している主要 API は以下です。

- `SheetDB` — Table 選択、CRUD、Query、Transaction、Migration、Seed、Protection を扱うエントリーポイント
- `SheetTable` — Zod Schema、Primary Key、採番、Optimistic Lock、Relation を定義する Table
- `SheetGateway` — Google Sheets への読み書きを担当する Gateway

```ts
import { SheetDB, SheetGateway, SheetTable } from "@gasboost/sheetorm";
```

内部の Command、Query 実装、Cache などは package の public entry point からは公開していません。

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
- Row Level Security
- Principal-based Authorization

---

# Installation

```bash
pnpm add @gasboost/sheetorm @gasboost/table zod

# Row Level Securityを利用する場合
pnpm add @gasboost/rls
```

npm の場合:

```bash
npm install @gasboost/sheetorm @gasboost/table zod

# Row Level Securityを利用する場合
npm install @gasboost/rls
```

## Requirements

SheetORM は Google Apps Script 環境での利用を前提としています。

以下の GAS Built-in API を利用します。

- `CacheService`
- `Utilities`

また、Google Sheets API v4 の高度なサービスを利用します。

- `Sheets`

`Sheets` を利用するため、`appsscript.json` で高度なサービスを有効化してください。

```json id="xxi3gg"
{
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Sheets",
        "version": "v4",
        "serviceId": "sheets"
      }
    ]
  }
}
```

TypeScript で GAS を開発する場合は、必要に応じて型定義も追加してください。

```bash
pnpm add -D @types/google-apps-script
```

---

## Google Sheets API

`@gasboost/sheetorm` v2 では、スプレッドシートへのアクセスに `SpreadsheetApp` ではなく Google Sheets API v4 を使用します。

`appsscript.json` で Google Sheets の高度なサービスを有効化してください。

```json
{
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Sheets",
        "version": "v4",
        "serviceId": "sheets"
      }
    ]
  }
}
```

そのうえで、`SheetGateway` に `Sheets` を渡します。

```ts
import { SheetDB, SheetGateway } from "@gasboost/sheetorm";

const db = new SheetDB({
  tables,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,
});
```

各 `SheetTable` には、対象スプレッドシートの ID を `dbId` として指定します。

```ts
const users = new SheetTable({
  name: "users",
  dbId: "SPREADSHEET_ID",
  schema: userSchema,
});
```

### ローカル環境

Apps Script の高度なサービスを利用できないローカル環境向けに、`@gasboost/sheetorm` は `SheetsStub` を提供します。

```ts
import { SheetGateway, SheetsStub } from "@gasboost/sheetorm";

const gateway = new SheetGateway(SheetsStub);
```

`SheetsStub` は `SheetGateway` が必要とする最小限の Sheets API インターフェースのみを提供します。

Google Sheets のデータストア自体を再現するものではありません。

## v1 から v2 への移行

v2 では `SheetGateway` の生成方法が変更されています。

v1:

```ts
const gateway = new SheetGateway(SpreadsheetApp);
```

v2:

```ts
const gateway = new SheetGateway(Sheets!);
```

あわせて、`appsscript.json` で Google Sheets の高度なサービスを有効化してください。

`SheetDB` の CRUD API や Query API に変更はありません。

内部実装では、`SpreadsheetApp` から Google Sheets API v4 へ移行し、スプレッドシート I/O を次のように最適化しています。

- 複数テーブルの読み込みを `spreadsheets.values.batchGet` でまとめて取得
- insert は append による追記
- update はテーブル全体を書き直さず、変更対象行だけを書き込み
- delete は対象行だけを削除
- 全件 rewrite は rollback など必要なケースに限定

これにより、特に複数テーブルを参照する Query や Relation において、Apps Script から Google Sheets へのアクセス回数と書き込み範囲を削減できます。

---

# Quick Start

まず Zod Schema と `SheetTable` を定義します。

```ts
import { z } from "zod";
import { defineTable } from "@gasboost/table";
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

const userDefinition = defineTable({
  name: "users",
  schema: userSchema,
  primaryKey: "id",
});

const userTable = new SheetTable({
  ...userDefinition,
  dbId: "SPREADSHEET_ID",
  autoNumbering: "increment",
});

const db = new SheetDB({
  tables: [userTable] as const,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,
});
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

# Table Definition

`SheetDB.definition(name)` で、`SheetDB` が保持している `SheetTable` 定義を取得できます。

```ts
const userTable = db.definition("users");
```

`name` は `SheetDB` に渡した tables の table name に制限され、戻り値は対応する `SheetTable` 型に絞り込まれます。

`db.table(name)` は操作対象テーブルを切り替える API ですが、`definition(name)` は定義を読み取るだけで現在の操作対象テーブルを変更しません。

---

# Table

## SheetTable

テーブルは `SheetTable` と Zod Schema で定義します。

```ts
const userSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const userTable = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "users",
  schema: userSchema,
  primaryKey: "id",
});
```

基本形は以下です。

```ts
new SheetTable({
  dbId,
  name,
  schema,
  primaryKey,
  autoNumbering?,
  versionColumn?,
});
```

---

# Primary Key

Primary Key は `SheetTable` の `primaryKey` プロパティで指定します。

`schema` の metadata だけで Primary Key が決まるわけではなく、Table として利用する Primary Key は `primaryKey` が基準です。

```ts
const schema = z.object({
  id: z.number().meta({
    primary: true,
  }),
  name: z.string(),
});

const table = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "users",
  schema,
  primaryKey: "id",
});
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

const table = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "users",
  schema,
  primaryKey: "id",
  autoNumbering: "increment",
});
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

const table = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "users",
  schema,
  primaryKey: "id",
  autoNumbering: "uuid",
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

const table = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "users",
  schema,
  primaryKey: "id",
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

Auto Numbering が有効な場合は、採番後の Primary Key を含む Record が返ります。

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

## 複数テーブルの一括取得

`findMany()` は登録済みテーブル名の配列を受け取り、テーブル名をキー、Schema から
推論した Record 配列を値とするオブジェクトを返します。Query / JOIN は実行しません。

```ts
const result = db.findMany(["stores", "products", "orders", "orderItems"] as const);
// result.stores / result.products / result.orders / result.orderItems
```

各テーブルには `find()` と同じ RLS `select` ポリシーが適用されます。
`exists()` 等で必要になる関連テーブルも読み込みますが、結果に含めるのは指定テーブルだけです。
RLS 未設定のテーブルは全件、RLS 設定済みで `select` 未定義のテーブルは空配列を返します。

同じ `dbId` のテーブルと RLS 依存テーブルは、1 回の `Values.batchGet` にまとめます。
複数の `dbId` がある場合はスプレッドシートごとに呼び出します。
空の入力は `{}`、空のテーブルは `[]` を返し、重複するテーブル名は一度だけ読み込みます。
選択中のテーブルは変更しません。

Consumer の初回フル同期用 RPC は、例えば次のように実装できます。
`createDbForPrincipal` は、認証済みユーザーから生成した `principal` と RLS を設定し、
上記 4 テーブルを登録した `SheetDB` を返すアプリケーション側の関数です。

```ts
// GAS 側: 認証・principal の構築はサーバー側で行う
function fullSync() {
  const db = createDbForPrincipal();
  return db.findMany(["stores", "products", "orders", "orderItems"] as const);
}

// Consumer 側: 1 回の RPC で RLS 適用済みの各テーブルを受け取る
google.script.run
  .withSuccessHandler((result) => {
    replaceLocalTables(result); // Consumer 側のローカルデータを置き換える処理
  })
  .withFailureHandler((error) => console.error(error))
  .fullSync();
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

Primary Key が空で Auto Numbering が有効な場合は Create されます。

Primary Key が存在しない Record についても、Auto Numbering が有効なら新しい Primary Key が採番されます。

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

# Row Level Security

SheetORM は `@gasboost/rls` を利用した Row Level Security をサポートします。

Row Level Security を使用すると、現在操作している Principal に応じて Record 単位で `select / insert / update / delete` を制御できます。

```bash
pnpm add @gasboost/rls
```

## Define Principal

Principal は現在操作を要求している主体を表します。

```ts
import { z } from "zod";

const principalSchema = z.object({
  userId: z.string(),
});
```

Authentication の実装には依存しません。

アプリケーション側で認証済みユーザーなどから Principal を生成します。

```ts
const currentPrincipal = {
  userId: "user-1",
};
```

## Define Policy

例えば、自分が所有する Record だけ操作できる Policy は次のように定義できます。

```ts
import { column, eq, principal, RowLevelSecurity } from "@gasboost/rls";

const dealSecurity = new RowLevelSecurity({
  table: dealTable,

  select: {
    using: eq(
      column(dealTable, "ownerId"),
      principal(principalSchema, "userId"),
    ),
  },

  insert: {
    check: eq(
      column(dealTable, "ownerId"),
      principal(principalSchema, "userId"),
    ),
  },

  update: {
    using: eq(
      column(dealTable, "ownerId"),
      principal(principalSchema, "userId"),
    ),
    check: eq(
      column(dealTable, "ownerId"),
      principal(principalSchema, "userId"),
    ),
  },

  delete: {
    using: eq(
      column(dealTable, "ownerId"),
      principal(principalSchema, "userId"),
    ),
  },
});
```

各 Policy の意味は以下です。

| Policy         | 評価対象                  |
| -------------- | ------------------------- |
| `select.using` | 読み込み対象の既存 Record |
| `insert.check` | 新しく作成される Record   |
| `update.using` | 更新前の既存 Record       |
| `update.check` | 更新後の Record           |
| `delete.using` | 削除対象の既存 Record     |

## Configure SheetDB

Principal と Row Level Security を `SheetDB` に渡します。

```ts
const db = new SheetDB({
  tables: [dealTable] as const,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,

  principal: {
    userId: "user-1",
  },

  rowLevelSecurity: [dealSecurity],
});
```

以降は通常どおり `SheetDB` を操作します。

```ts
const deals = db.table("deals").find();
```

RLS の条件を満たさない Record は返されません。

認証がインスタンス生成後に完了する場合は、同じ `SheetDB` に Principal を設定できます。

```ts
db.setPrincipal({ userId: "user-1" });
const deals = db.table("deals").find();

// Principal をクリアする場合
db.setPrincipal({});
```

`setPrincipal(principal: Record<string, unknown>): void` は Principal の全キーを置き換えます。
以前のキーは残らず、オブジェクトの参照を維持するため、既存の RLS 評価器と以後の読み書きに反映されます。
コンストラクタの `principal` オプションも引き続き利用できます。

## Default Policy

RLS の設定状態によって動作が異なります。

```text
RLS未設定
→ unrestricted

RLS設定あり + operationのPolicyなし
→ deny

RLS設定あり + allow()
→ explicitly allow
```

つまり、RLS を設定していない既存 Table の動作は変わりません。

一方、RLS を有効にした Table では Policy が明示されていない操作は許可されません。

認可条件を必要としない操作は `allow()` で明示できます。

```ts
import { allow, RowLevelSecurity } from "@gasboost/rls";

const security = new RowLevelSecurity({
  table: masterTable,

  select: {
    using: allow(),
  },
});
```

## Query Evaluation Order

Query と RLS を同時に使用する場合、SheetORM は **RLS を先に評価します**。

```text
load
↓
RLS
↓
authorized records
↓
Query
↓
result
```

例えば100件のRecordのうち20件だけアクセス可能な場合、

```ts
const query = db.query("deals").orderBy("createdAt", "desc").limit(10);

const deals = db.find(query);
```

は次の順序で処理されます。

```text
100 Records
↓ RLS
20 authorized Records
↓ orderBy
20 Records
↓ limit
10 Records
```

`limit` や `offset` が RLS より先に適用されることはありません。

これにより、認可されていない Record が Query のページングや件数制限に影響することを防ぎます。

## Write Authorization

RLS は Read だけでなく Write にも適用されます。

```text
create
→ insert.check

update
→ update.using
→ update.check

delete
→ delete.using

upsert
→ existing Record: update policy
→ new Record: insert policy
```

RLS によって拒否された Record は Storage に書き込まれません。

## Relation Writes

Relation によって発生する派生 Write にも RLS が適用されます。

```text
Nested Create
→ child insert.check

Cascade Delete
→ child delete.using

Set Null
→ child update.using
→ child update.check
```

例えば Parent の削除自体が許可されていても、Cascade 対象 Child の `delete.using` が拒否した場合は削除されません。

同様に `set null` による Foreign Key 更新も Child Table の Update Policy を通過する必要があります。

Nested Create では Parent / Child を含む Write 対象全体の Validation と Authorization が成功した後に Write が実行されます。

そのため Child Record の `insert.check` が拒否された場合に Parent Record だけが作成されることはありません。

## Transaction

Transaction 内でも RLS は適用されます。

```ts
db.transaction(() => {
  db.table("deals").update([
    {
      id: 1,
      ownerId: "user-1",
      name: "Updated",
    },
  ]);
});
```

Transaction を利用しても RLS を迂回することはできません。

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

オブジェクト引数形式も利用できます。`table` は JOIN 先、`on.local` は親の列、
`on.reference` は JOIN 先の列、`query?` は JOIN 先に適用する型安全なサブ Query です。
`type?` は `"left"`（省略時）または `"inner"` を指定します。
位置引数形式は引き続き LEFT JOIN として利用できます。

例えば `employees` に `userId` / `departmentId`、`users` に `id` / `name`、
`departments` に `id` を定義している場合、ユーザー名で従業員を絞り込めます。

```ts
const usersQuery = db.query("users").and("name", "*", ["田中"]);
const query = db.query("employees")
  .join({
    table: "users",
    on: { local: "userId", reference: "id" },
    query: usersQuery,
    type: "inner",
  })
  .join({
    table: "departments",
    on: { local: "departmentId", reference: "id" },
    type: "left",
  })
  .orderBy("userId", "asc")
  .offset(0)
  .limit(20);

const employees = db.find(query);
// employees[n].relations.users: 名前条件に一致する User の配列
// employees[n].relations.departments: 一致する部署の配列（0件なら []）
```

LEFT は子が0件でも親を残し、INNER は子が0件なら親を除外します。
子が複数一致しても親は1件だけ返り、子は `relations[table]` の配列に格納されます。
JOIN は指定順に評価され、INNER で除外した親は後続の LEFT で復活しません。
JOIN 先とネストした JOIN 先にも select RLS を適用し、許可された子だけで結合します。

INNER を直接含む Query は Filter → JOIN → Sort → Offset → Limit の順で評価します。
JOIN なし・LEFT のみの Query（位置引数形式を含む）は従来の
Filter → Sort → Offset → Limit → JOIN の順序を維持します。
サブ Query ごとに同じルールを適用し、ネストした INNER の有無はそのサブ Query の評価順を決めます。

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

const userTable = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "users",
  schema: userSchema,
  primaryKey: "id",
  autoNumbering: "uuid",
  versionColumn: "version",
});

const postTable = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "posts",
  schema: postSchema,
  primaryKey: "id",
  autoNumbering: "uuid",
});

const commentTable = new SheetTable({
  dbId: "SPREADSHEET_ID",
  name: "comments",
  schema: commentSchema,
  primaryKey: "id",
  autoNumbering: "uuid",
});

postTable.reference("userId", userTable, "id", "cascade");
commentTable.reference("postId", postTable, "id", "cascade");

const db = new SheetDB({
  tables: [userTable, postTable, commentTable] as const,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,
});

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

### SpreadsheetApp Stub

Node/Vite 上で GAS の entry module を評価する場合、`SpreadsheetApp` は利用できません。

`SpreadsheetAppStub` は、コンテナバインドされた Spreadsheet ID を参照する初期化コードを成立させるための最小 Stub です。

```ts
import { SpreadsheetAppStub } from "@gasboost/sheetorm";

const databaseId = SpreadsheetAppStub.getActive().getId();
```

`getActive().getId()` は固定の ID を返します。

この Stub は Spreadsheet の読み書きを再現する Fake / emulator ではありません。
`getRange()`, `getValues()`, `setValue()` などの Spreadsheet 操作 API は提供しません。

実際のデータ操作を含むテストでは、用途に応じて SheetORM の InMemory 実装を使用してください。

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

---

# License

MIT

## 書き込み成功後の Hook（3.3.0〜）

`SheetDBConfig.afterCommit` に同期 Hook を設定すると、通常の `create / update / upsert / delete`
が成功した後に、ストレージ非依存の `TableChange[]` を受け取れます。

```ts
import type { AfterCommitHook } from "@gasboost/sheetorm";

const afterCommit: AfterCommitHook<typeof tables> = (changes) => {
  for (const change of changes) {
    console.log(change.table, change.before, change.after);
  }
};

const db = new SheetDB({
  tables,
  gateway,
  cacheService: CacheService,
  utilities: Utilities,
  afterCommit,
});
```

- 通常の論理操作ごとに 1 回、Transaction は全シートのコミット成功後にまとめて 1 回呼びます。
- 同一レコードの複数変更は最初の `before` と最後の `after` に集約します。Create → Delete や元に戻った変更は除き、変更がなければ呼びません。
- Nested Create / Cascade Delete / Set Null による別テーブルの変更も、完全なスナップショットとして含みます。
- 既存の `commit(table)` 経由でも通知します。Transaction 内で明示的に commit しても、通知は Transaction の成功後に集約されます。
- Hook 完了まで既存テーブルロックを保持します。ロック順序を揃えるため、通常操作は対象とその子孫テーブル、Transaction は登録テーブルとその子孫を事前に順序付けして取得します。既存 CacheService ロックの制約・有効期限は同じです。
- シートの書き込み失敗時は Hook を呼びません。Transaction のシート書き込み失敗は関連テーブルも含めて Rollback します。
- **Hook の例外は呼び出し元へ伝播しますが、コミット済みシートは Rollback しません。** 外部送信に失敗した場合は、その変更情報を再送するか全同期してください。CRUD 自体をそのまま再実行すると重複作成等の原因になります。
- Hook は同期関数にしてください。`seed / migrate` は対象外です。

`afterCommit: changes => rtdb.publish(changes)` で `@gasboost/realtime-firebase` に接続できます。
SheetORM 自体は Firebase や同期用 version に依存しません。`versionColumn` による楽観的ロックは従来どおりです。
