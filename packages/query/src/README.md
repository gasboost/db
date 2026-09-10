# @gasboost/query

Zod Schema を利用した、型安全でストレージ非依存の Query Engine です。

`@gasboost/query` は Query の構築、Filter、Sort、Offset、Limit、JOIN、および再帰的な JOIN 解決を提供します。

Google Sheets、IndexedDB、その他のデータストアには依存せず、テーブルから Record を取得する `Loader` を渡すことで同じ Query を異なるストレージに対して利用できます。

```text
@gasboost/query
       ↓
   Query / Join
       ↓
     Loader
    ↙      ↘
SheetORM   Replica
    ↓        ↓
Sheets   IndexedDB
```

---

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

```ts
import { Query } from "@gasboost/query";

const query = new Query<typeof tables, "users">({
  tableName: "users",
});
```

Query の対象 Table は型として保持されます。

そのため、Query で利用できる Column は対象 Table の Zod Schema から推論されます。

---

# Filter

## AND

```ts
const query = new Query<typeof tables, "users">({
  tableName: "users",
})
  .and("active", "=", [true])
  .and("age", ">=", [20]);
```

すべての AND 条件を満たす Record が対象になります。

## OR

```ts
const query = new Query<typeof tables, "users">({
  tableName: "users",
})
  .or("name", "=", ["Alice"])
  .or("name", "=", ["Bob"]);
```

OR 条件のうち1つ以上を満たす Record が対象になります。

AND と OR は組み合わせられます。

```ts
const query = new Query<typeof tables, "users">({
  tableName: "users",
})
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

Operator と Operand の組み合わせは実行時にも検証されます。

---

# Order By

```ts
const query = new Query<typeof tables, "users">({
  tableName: "users",
}).orderBy("name", "asc");
```

降順:

```ts
query.orderBy("name", "desc");
```

---

# Limit / Offset

```ts
const query = new Query<typeof tables, "users">({
  tableName: "users",
})
  .offset(20)
  .limit(10);
```

Query は次の順番で Record に適用されます。

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

# Apply

取得済みの Record 配列へ Query を直接適用できます。

```ts
const result = query.apply(records);
```

`apply()` はストレージ I/O を行いません。

Record 配列に対する純粋な Query 処理のみを行います。

---

# JOIN

異なる Table の Record を型安全に JOIN できます。

```ts
const query = new Query<typeof tables, "users">({
  tableName: "users",
}).join("id", "reservations", "userId");
```

この Query は、

```text
users.id
    ↓
reservations.userId
```

で Record を関連付けます。

JOIN 結果は JOIN 先 Table 名をプロパティとして持ちます。

```ts
{
  id: "user-1",
  name: "Alice",
  reservations: [
    {
      id: "reservation-1",
      userId: "user-1",
      staffId: "staff-1"
    }
  ]
}
```

`relations` などの特定の Record 表現には依存しません。

---

# Nested JOIN

JOIN 先には別の Query を指定できます。

```ts
const reservations = new Query<typeof tables, "reservations">({
  tableName: "reservations",
}).join("staffId", "staffs", "id");

const users = new Query<typeof tables, "users">({
  tableName: "users",
}).join("id", "reservations", "userId", reservations);
```

Query 自身が JOIN の木構造を保持します。

```text
users
└─ reservations
   └─ staffs
```

そのため、Table 側に Relation Tree を持たせなくても Query から必要な JOIN 構造を決定できます。

---

# Resolve

`resolve()` に Loader を渡すことで、データ取得から Query 適用、再帰 JOIN までを一度に解決できます。

```ts
const result = await users.resolve(load);
```

Loader は Table 名を受け取り、その Table の Record を返します。

```ts
const load = async (table: string): Promise<Record<string, unknown>[]> => {
  // 任意の storage から Record を取得
};
```

Query は JOIN を再帰的に解決します。

```text
users
└─ reservations
   └─ staffs
```

の場合、概念的には bottom-up に処理されます。

```text
staffs
  ↓ JOIN
reservations
  ↓ JOIN
users
```

これにより、深い JOIN を持つ Query でも呼び出し側では、

```ts
const result = await query.resolve(load);
```

だけで解決できます。

---

# Storage Agnostic

`@gasboost/query` は Record の取得元を知りません。

例えば SheetORM では Google Sheets から取得できます。

```ts
const result = await query.resolve(async (table) => {
  return sheetStorage.read(table);
});
```

Replica では IndexedDB から取得できます。

```ts
const result = await query.resolve(async (table) => {
  return replicaStorage.read(table);
});
```

Query の意味とストレージ I/O を分離することで、同じ Query を複数のデータストアで共有できます。

---

# Architecture

`@gasboost/query` の責務は、Record に対する問い合わせ処理です。

```text
Query
├─ Filter
│  ├─ FilterOperator
│  └─ FilterOperand
├─ OrderBy
├─ Join
└─ resolve()
```

ストレージ固有の責務は外部に残します。

```text
@gasboost/query
  - Filter
  - Sort
  - Offset
  - Limit
  - Join
  - Recursive resolution

@gasboost/sheetorm
  - Google Sheets I/O

@gasboost/replica
  - IndexedDB I/O
```

この分離により、Query の評価ロジックを各ストレージ実装で重複させずに利用できます。

---

# License

MIT
