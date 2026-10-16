# @gasboost/table

Storage / runtime に依存しない、Gasboost 共通の論理 Table 定義パッケージです。

```ts
import { defineTable } from "@gasboost/table";
import { z } from "zod";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

export const users = defineTable({
  name: "users",
  schema: userSchema,
  primaryKey: "id",
});
```

`primaryKey` には schema に存在する key だけを指定できます。

```ts
export const tables = [users] as const;
```

この `tables` を `@gasboost/replica`、`@gasboost/rls`、`@gasboost/realtime-firebase`、`@gasboost/sheetorm` で共有できます。

## コミット済みの変更情報

`TableChange<T>` はストレージに依存しない Create / Update / Delete の共通契約です。
テーブルの Union を渡すと、`table` とレコード型の対応が保持されます。

```ts
import type { TableChange } from "@gasboost/table";

const change: TableChange<typeof users> = {
  table: "users",
  before: null,
  after: { id: "u1", name: "田中", active: true },
};
```

Create は `before: null`、Delete は `after: null`、Update は両方を持ちます。
`null / null` は許可されません。発行元は変更前後の独立した完全なスナップショットを提供します。
同期用 version や送信先固有の情報は含みません。
