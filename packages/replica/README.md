# @gasboost/replica

Dexie と Zod を利用した、ブラウザ向けの型安全な IndexedDB レプリカです。

`@gasboost/replica` は、Zod Schema で定義された Record を IndexedDB 上に保存し、ローカルレプリカとして扱うためのパッケージです。

Query 処理は `@gasboost/query` と連携して行うため、Filter、Sort、Pagination、JOIN、Nested JOIN のロジックを Replica 側で重複実装しません。

```text
Remote Data
   ↓
Full Sync
   ↓
@gasboost/replica
   ↓
IndexedDB / Dexie
   ↑
Loader
   ↑
@gasboost/query
```

---

## Features

- Dexie を利用した IndexedDB ストレージ
- Zod Schema からの型推論
- 型安全な Table 名
- 型安全な Primary Key
- `put`
- `bulkPut`
- `delete`
- `toArray`
- Full Sync
- Dexie Transaction による同期
- `@gasboost/query` との統合
- JOIN
- Nested JOIN
- Google Apps Script ランタイム非依存
- SheetORM ランタイム非依存

---

# Installation

```bash
pnpm add @gasboost/replica @gasboost/query dexie zod
```

npm の場合:

```bash
npm install @gasboost/replica @gasboost/query dexie zod
```

---

# Table Definition

Replica では以下を使って Table を定義します。

- Table 名
- Zod Schema
- Primary Key

```ts
import { z } from "zod";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

const ReservationSchema = z.object({
  id: z.string(),
  userId: z.string(),
});

const tables = [
  {
    name: "users",
    schema: UserSchema,
    primaryKey: "id",
  },
  {
    name: "reservations",
    schema: ReservationSchema,
    primaryKey: "id",
  },
] as const;
```

`primaryKey` には、対応する Zod Schema に存在する Column のみ指定できます。

---

# Replica の作成

```ts
import { createReplica } from "@gasboost/replica";

const replica = createReplica({
  name: "example-app",
  tables,
});
```

`name` は IndexedDB の Database 名として利用されます。

各 Table は、定義された `primaryKey` を使って Dexie に登録されます。

例えば、

```ts
{
  name: "users",
  primaryKey: "id",
}
```

は概念的に次の Dexie Schema として登録されます。

```text
users: "id"
```

---

# Table Access

`table()` で Replica 内の Table を参照します。

```ts
const users = replica.table("users");
```

Table 名は Table Definition から型推論されます。

```ts
replica.table("users"); // OK
replica.table("reservations"); // OK
```

定義されていない Table 名は TypeScript 上で拒否されます。

---

# Put

Record を追加または更新します。

```ts
await replica.table("users").put({
  id: "u1",
  name: "Alice",
  active: true,
});
```

Record 型は、選択した Table の Zod Schema から推論されます。

---

# Bulk Put

複数 Record をまとめて追加または更新します。

```ts
await replica.table("users").bulkPut([
  {
    id: "u1",
    name: "Alice",
    active: true,
  },
  {
    id: "u2",
    name: "Bob",
    active: false,
  },
]);
```

---

# Delete

Primary Key を指定して Record を削除します。

```ts
await replica.table("users").delete("u1");
```

Primary Key の型は、Table Definition の `primaryKey` Column から推論されます。

---

# To Array

Table 内の Record をすべて取得します。

```ts
const users = await replica.table("users").toArray();
```

戻り値の型は、対象 Table の Zod Schema から推論されます。

---

# Full Sync

リモート側から取得した完全な Table データを、ローカル Replica へ同期できます。

```ts
await replica.sync("users", remoteUsers);
```

同期時には、

- remote に存在する Record を local に反映
- remote に存在しない Record を local から削除
- 同期処理全体を Dexie Transaction 内で実行

します。

例えば、local に以下の Record があるとします。

```ts
await replica.table("users").bulkPut([
  {
    id: "u1",
    name: "Old Alice",
    active: true,
  },
  {
    id: "u2",
    name: "Deleted User",
    active: false,
  },
]);
```

remote の完全データが以下だった場合、

```ts
await replica.sync("users", [
  {
    id: "u1",
    name: "Alice",
    active: true,
  },
]);
```

同期後の local は次の状態になります。

```ts
[
  {
    id: "u1",
    name: "Alice",
    active: true,
  },
];
```

remote に存在しない `u2` は local から削除されます。

空配列を同期すると Table は空になります。

```ts
await replica.sync("users", []);
```

---

# Query Integration

`@gasboost/replica` は `@gasboost/query` と直接連携できます。

```ts
import { Query } from "@gasboost/query";

const query = new Query<typeof tables, "users">({
  tableName: "users",
})
  .and("active", "=", [true])
  .orderBy("name", "asc");
```

Replica に対して Query を実行します。

```ts
const users = await replica.find(query);
```

Replica 自身は Filter や Sort のロジックを持ちません。

内部では IndexedDB から Record を取得し、`Query.resolve()` に渡します。

```text
replica.find(query)
      ↓
query.resolve(loader)
      ↓
replica.table(name).toArray()
```

これにより、異なる Storage Adapter 間で Query semantics を共有できます。

---

# JOIN

JOIN の評価は `@gasboost/query` が担当します。

```ts
const query = new Query<typeof tables, "users">({
  tableName: "users",
}).join("id", "reservations", "userId");
```

```ts
const users = await replica.find(query);
```

結果:

```ts
[
  {
    id: "u1",
    name: "Alice",
    active: true,
    reservations: [
      {
        id: "r1",
        userId: "u1",
      },
    ],
  },
];
```

Replica 側に JOIN Engine は持ちません。

Replica は `@gasboost/query` に Record を提供するだけです。

---

# Nested JOIN

Nested JOIN も `@gasboost/query` によって解決されます。

```ts
const reservations = new Query<typeof tables, "reservations">({
  tableName: "reservations",
}).join("staffId", "staffs", "id");

const users = new Query<typeof tables, "users">({
  tableName: "users",
}).join("id", "reservations", "userId", reservations);
```

```ts
const result = await replica.find(users);
```

Nested JOIN は `Query.resolve()` によって bottom-up に解決されます。

```text
staffs
  ↓
reservations
  ↓
users
```

---

# Architecture

`@gasboost/replica` は Storage の責務だけを持ちます。

```text
@gasboost/replica
  - IndexedDB 初期化
  - Dexie Table
  - put
  - bulkPut
  - delete
  - toArray
  - Full Sync
  - Query Loader

@gasboost/query
  - Filter
  - Sort
  - Offset
  - Limit
  - JOIN
  - Nested JOIN
  - Query Resolution
```

この責務分離により、ローカル Storage とリモート Storage の間で Query 処理を重複実装せずに済みます。

---

# Shared Schemas

Server と Browser で同じ Table Definition を共有できます。

```ts
export const tables = [
  {
    name: "users",
    schema: UserSchema,
    primaryKey: "id",
  },
] as const;
```

```text
Server / GAS
     ↓
 shared tables
     ↑
Browser / Replica
```

Shared Schema を置く Module には、以下のような Runtime 固有依存を含めないことを推奨します。

- `SpreadsheetApp`
- `CacheService`
- GAS Handler
- Browser 固有の Application Code

これにより、Server Runtime が Frontend Bundle に混入することを防ぎます。

---

# 対象外

`@gasboost/replica` core では以下を扱いません。

- Firebase Realtime Database 同期
- 端末間リアルタイム同期
- Firebase Authentication
- Row Level Security
- Offline Mutation Queue
- Conflict Resolution
- Incremental Sync
- Secondary Index を利用した Query 最適化
- React Hooks

これらは Replica core の上に別レイヤーとして追加できます。

---

# License

MIT
