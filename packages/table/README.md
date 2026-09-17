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
