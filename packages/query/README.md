````markdown
# @gasboost/query

Zod Schema を利用した、型安全でストレージ非依存の Query Engine です。

`@gasboost/query` は、問い合わせを定義する `Query` と、その Query を Record に対して評価・解決する `QueryEvaluation` を提供します。

Google Sheets、IndexedDB、その他のデータストアには依存しません。

```text
Query
  ↓
QueryEvaluation
  ├─ Loader
  └─ JoinResolver
       ↓
  ┌────┴─────┐
SheetORM   Replica
   ↓          ↓
Sheets    IndexedDB
```

## Features

- Zod Schema による型安全な Query
- 型安全な Table 選択
- 型安全な Column / Operand
- AND / OR Filter
- Order By
- Limit / Offset
- JOIN
- Nested JOIN
- Recursive Query Resolution
- JOIN の出力形式をストレージ側で定義可能
- Storage Agnostic
- Async Loader
- Google Apps Script / Dexie / IndexedDB 非依存

---

# Installation

```bash
pnpm add @gasboost/query zod
```

npm の場合:

```bash
npm install @gasboost/query zod
```

---

# Table Definition

Query が必要とする Table 定義は `name` と Zod Schema だけです。

```ts
import { z } from "zod";
import type { TableDefinition } from "@gasboost/query";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
});

const ReservationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  staffId: z.string(),
});

const StaffSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const tables = [
  {
    name: "users",
    schema: UserSchema,
  },
  {
    name: "reservations",
    schema: ReservationSchema,
  },
  {
    name: "staffs",
    schema: StaffSchema,
  },
] as const satisfies readonly TableDefinition[];
```

`primaryKey`、Database ID、IndexedDB index などのストレージ固有情報は `TableDefinition` に含みません。

---

# Query

`Query` は問い合わせそのものを表現する DSL です。

```ts
import { Query } from "@gasboost/query";

const query = new Query<typeof tables, "users">("users");
```

Query の対象 Table は型として保持されます。

そのため、Query で利用できる Column は対象 Table の Zod Schema から推論されます。

`Query` 自身は Record の評価やストレージ I/O を行いません。

```text
Query
  = 問い合わせの定義
```

---

# Filter

## AND

```ts
const query = new Query<typeof tables, "users">("users")
  .and("active", "=", [true])
  .and("age", ">=", [20]);
```

すべての AND 条件を満たす Record が対象になります。

## OR

```ts
const query = new Query<typeof tables, "users">("users")
  .or("name", "=", ["Alice"])
  .or("name", "=", ["Bob"]);
```

OR 条件のうち1つ以上を満たす Record が対象になります。

AND と OR は組み合わせられます。

```ts
const query = new Query<typeof tables, "users">("users")
  .and("active", "=", [true])
  .or("name", "=", ["Alice"])
  .or("name", "=", ["Bob"]);
```

---

# Filter Operators

利用可能な Operator は以下です。

| Operator | 意味               |
| -------- | ------------------ |
| `=`      | 等しい             |
| `!=`     | 等しくない         |
| `<`      | より小さい         |
| `>`      | より大きい         |
| `<=`     | 以下               |
| `>=`     | 以上               |
| `*`      | 文字列を含む       |
| `!*`     | 文字列を含まない   |
| `^*`     | 指定文字列で始まる |
| `*$`     | 指定文字列で終わる |

```ts
query.and("age", ">=", [20]);

query.and("name", "*", ["Ali"]);
```

Column と値の型は対象 Table の Zod Schema から推論されます。

---

# Order By

```ts
const query = new Query<typeof tables, "users">("users").orderBy("name", "asc");
```

降順:

```ts
query.orderBy("name", "desc");
```

---

# Limit / Offset

```ts
const query = new Query<typeof tables, "users">("users").offset(20).limit(10);
```

Query は評価時に次の順番で Record へ適用されます。

```text
Filter
  ↓
Order By
  ↓
Offset
  ↓
Limit
```

---

# QueryEvaluation

`QueryEvaluation` は `Query` を Record に対して評価・解決する責務を持ちます。

```ts
import { Query, QueryEvaluation } from "@gasboost/query";

const query = new Query<typeof tables, "users">("users").and("active", "=", [
  true,
]);

const evaluation = new QueryEvaluation(query, load, joinResolver);
```

責務は次のように分離されています。

```text
Query
  = 問い合わせ定義

QueryEvaluation
  = 問い合わせの評価・解決
```

---

# Apply

取得済みの Record 配列へ Query を適用する場合は `QueryEvaluation.apply()` を利用します。

```ts
const query = new Query<typeof tables, "users">("users").and("active", "=", [
  true,
]);

const evaluation = new QueryEvaluation(query, load, joinResolver);

const result = evaluation.apply(records);
```

`apply()` はストレージ I/O を行いません。

Record 配列に対して次の処理を行います。

```text
Filter
  ↓
Sort
  ↓
Offset
  ↓
Limit
```

---

# Loader

`QueryEvaluation` は Record の取得方法を知りません。

代わりに、Table 名を受け取って Record を返す Loader を渡します。

```ts
const load = async (tableName: string): Promise<Record<string, unknown>[]> => {
  // 任意の storage から Record を取得
};
```

例えば Google Sheets、IndexedDB、In-Memory Store など、任意のストレージへ接続できます。

```text
QueryEvaluation
      ↓
    Loader
   ↙     ↘
Sheets   IndexedDB
```

---

# JOIN

異なる Table の Record を型安全に JOIN できます。

```ts
const query = new Query<typeof tables, "users">("users").join(
  "id",
  "reservations",
  "userId",
);
```

この Query は、

```text
users.id
    ↓
reservations.userId
```

で Record を関連付けます。

`Query` は JOIN の関係だけを定義します。

JOIN 後の Record をどのような形にするかは `@gasboost/query` では決定しません。

---

# JoinResolver

JOIN の出力形式は `QueryEvaluation` に渡す `JoinResolver` が決定します。

JoinResolver には次の情報が渡されます。

```ts
{
  parent,
  table,
  children,
}
```

例えば JOIN 先 Table 名をそのまま property として利用する場合:

```ts
const joinResolver = ({
  parent,
  table,
  children,
}: {
  parent: Record<string, unknown>;
  table: string;
  children: Record<string, unknown>[];
}) => ({
  ...parent,
  [table]: children,
});
```

結果:

```ts
{
  id: "user-1",
  name: "Alice",
  reservations: [
    {
      id: "reservation-1",
      userId: "user-1",
    },
  ],
}
```

一方、`relations` 配下へ格納することもできます。

```ts
const joinResolver = ({
  parent,
  table,
  children,
}: {
  parent: Record<string, unknown>;
  table: string;
  children: Record<string, unknown>[];
}) => ({
  ...parent,
  relations: {
    ...(typeof parent.relations === "object" &&
    parent.relations !== null &&
    !Array.isArray(parent.relations)
      ? parent.relations
      : {}),
    [table]: children,
  },
});
```

結果:

```ts
{
  id: "user-1",
  name: "Alice",
  relations: {
    reservations: [
      {
        id: "reservation-1",
        userId: "user-1",
      },
    ],
  },
}
```

このため `@gasboost/query` は特定の JOIN Record 表現に依存しません。

---

# Nested JOIN

JOIN 先には別の Query を指定できます。

```ts
const staffs = new Query<typeof tables, "staffs">("staffs");

const reservations = new Query<typeof tables, "reservations">(
  "reservations",
).join("staffId", "staffs", "id", staffs);

const users = new Query<typeof tables, "users">("users").join(
  "id",
  "reservations",
  "userId",
  reservations,
);
```

Query 自身が JOIN の木構造を保持します。

```text
users
└─ reservations
   └─ staffs
```

Table Definition 側に Relation Tree を持たせる必要はありません。

---

# Resolve

データ取得から Query 適用、再帰 JOIN までを解決する場合は `QueryEvaluation.resolve()` を利用します。

```ts
const evaluation = new QueryEvaluation(users, load, joinResolver);

const result = await evaluation.resolve();
```

Nested JOIN は bottom-up に解決されます。

```text
users
└─ reservations
   └─ staffs
```

の場合、概念的には次の順番になります。

```text
staffs
  ↓ JOIN
reservations
  ↓ JOIN
users
```

下位 JOIN に対する `JoinResolver` の結果が、そのまま上位 JOIN の child Record として利用されます。

---

# Example

```ts
import { Query, QueryEvaluation } from "@gasboost/query";

const reservations = new Query<typeof tables, "reservations">(
  "reservations",
).and("staffId", "=", ["staff-1"]);

const users = new Query<typeof tables, "users">("users")
  .and("active", "=", [true])
  .orderBy("name", "asc")
  .join("id", "reservations", "userId", reservations);

const evaluation = new QueryEvaluation(
  users,
  async (tableName) => {
    return storage.read(tableName);
  },
  ({ parent, table, children }) => ({
    ...parent,
    relations: {
      ...(typeof parent.relations === "object" &&
      parent.relations !== null &&
      !Array.isArray(parent.relations)
        ? parent.relations
        : {}),
      [table]: children,
    },
  }),
);

const result = await evaluation.resolve();
```

---

# Storage Agnostic

`@gasboost/query` は Record の取得元も、JOIN 結果の保存形式も知りません。

ストレージ adapter 側が、

- Loader
- JoinResolver

を提供します。

```text
                 Query
                   ↓
           QueryEvaluation
              ↙         ↘
          Loader      JoinResolver
             ↓             ↓
       Data Source     Result Shape
```

例えば SheetORM では、

```text
Loader
  → Google Sheets

JoinResolver
  → relations
```

Replica では、

```text
Loader
  → IndexedDB

JoinResolver
  → Replica が必要とする Record Shape
```

という構成にできます。

同じ `Query` を複数のストレージ実装で共有できます。

---

# Architecture

`@gasboost/query` の中心となる責務は明確に分離されています。

```text
Query
  ├─ Filter Definition
  ├─ Order Definition
  ├─ Limit / Offset Definition
  └─ Join Definition

QueryEvaluation
  ├─ Filter Evaluation
  ├─ Sort
  ├─ Offset
  ├─ Limit
  └─ Recursive Join Resolution

Join
  └─ Parent / Child Matching

Loader
  └─ Record Loading

JoinResolver
  └─ Joined Record Representation
```

`Query` はストレージや Record の出力形式を知りません。

`QueryEvaluation` は Query を評価しますが、データの取得方法や JOIN 結果の表現方法は外部から受け取ります。

```text
@gasboost/query
  - Query DSL
  - Query Evaluation
  - Join Matching
  - Recursive Resolution

@gasboost/sheetorm
  - Google Sheets I/O
  - SheetORM JOIN Representation

@gasboost/replica
  - IndexedDB I/O
  - Replica JOIN Representation
```

この分離により、問い合わせ定義、評価ロジック、ストレージ I/O、JOIN 表現を独立して扱えます。

---

# Public API

`@gasboost/query` の公開 API は次の通りです。

```ts
import { Query, QueryEvaluation } from "@gasboost/query";

import type { TableDefinition } from "@gasboost/query";
```

Filter、Join、OrderBy などは Query Engine の内部実装です。

通常の利用者は `Query` と `QueryEvaluation` を通して利用します。

---

# License

MIT
````
