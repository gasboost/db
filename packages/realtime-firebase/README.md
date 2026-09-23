# @gasboost/realtime-firebase

`@gasboost/rls` の Row Level Security 定義から Firebase Realtime Database 向けの認可レイアウト、型安全な runtime path、Firebase Security Rules を生成し、Firebase Authentication 向けの Custom Token generation を提供するパッケージです。

## 概要

`@gasboost/realtime-firebase` は、Gasboost の他のデータ層と同じ Row Level Security 定義を利用します。

```text
@gasboost/rls
  └─ 論理的な認可モデル
       ├─ @gasboost/sheetorm
       │    └─ runtime authorization
       │
       └─ @gasboost/realtime-firebase
            ├─ RTDB authorization layout
            ├─ 型安全な runtime path
            └─ Firebase Security Rules
```

Firebase Realtime Database は巨大な JSON tree としてデータを保持します。

RDB のように、同じ Table の中から Security Rules が許可された Record だけを filter して返すことはできません。

そのため RTDB では、認可境界そのものを物理的な path 構造として表現する必要があります。

`@gasboost/realtime-firebase` は、RLS からその物理レイアウトを決定的に導出します。

## インストール

```bash
pnpm add @gasboost/realtime-firebase @gasboost/rls @gasboost/table zod
```

## 基本的な使い方

まず Table と RLS を定義します。

```ts
import { column, eq, principal, RowLevelSecurity } from "@gasboost/rls";
import { FirebaseRtdb } from "@gasboost/realtime-firebase";
import { defineTable } from "@gasboost/table";
import { z } from "zod";

const principalSchema = z.object({
  userId: z.string(),
});

const dealSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
});

const deals = defineTable({
  name: "deals",
  schema: dealSchema,
  primaryKey: "id",
});

const dealSecurity = new RowLevelSecurity({
  table: deals,

  select: {
    using: eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  },

  insert: {
    check: eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  },

  update: {
    using: eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
    check: eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  },

  delete: {
    using: eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  },
});
```

この定義から RTDB 定義を生成します。

```ts
export const rtdb = FirebaseRtdb.generate({
  tables: [deals] as const,
  rowLevelSecurity: [dealSecurity],

  principal: {
    userId: "auth.uid",
  },
});
```

RLS で参照している Principal key は `rowLevelSecurity` から型推論されます。

そのため、例えば RLS が `principal(principalSchema, "userId")` を参照している場合、`principal` mapping の `userId` は必須です。

この `rtdb` は、runtime path と Security Rules の両方で同じ定義として利用されます。

## Runtime path

Table 名は型として保持されます。

```ts
rtdb.deals;
```

存在しない Table 名にはアクセスできません。

### Record path

```ts
const deal = {
  id: "deal-1",
  ownerId: "user-1",
  title: "Example",
};

const path = rtdb.deals.record(deal);
```

生成される path:

```text
/deals/__rls/ownerId/user-1/deal-1
```

生成した path は Firebase 公式 SDK にそのまま渡します。

```ts
import { ref, set } from "firebase/database";

await set(ref(database, rtdb.deals.record(deal)), deal);
```

`@gasboost/realtime-firebase` は Firebase SDK 自体をラップしません。

## Subscription scope

RLS から、購読可能な認可済み subtree も生成できます。

```ts
const scope = rtdb.deals.scope({
  userId: "user-1",
});
```

生成される path:

```text
/deals/__rls/ownerId/user-1
```

Firebase SDK では、その subtree を直接購読できます。

```ts
import { onValue, ref } from "firebase/database";

onValue(
  ref(
    database,
    rtdb.deals.scope({
      userId: "user-1",
    }),
  ),
  (snapshot) => {
    console.log(snapshot.val());
  },
);
```

利用側は RTDB の物理 path 構造を知る必要がありません。

## Authorization layout

例えば次の RLS があるとします。

```ts
eq(column(deals, "ownerId"), principal(principalSchema, "userId"));
```

この認可条件から、例えば次のような RTDB layout が生成されます。

```text
/deals
  /__rls
    /ownerId
      /user-1
        /deal-1
```

この path は application domain API ではありません。

Firebase 内部で認可境界を表現するための物理データ配置です。

重視するのは path の見た目ではなく、以下です。

- RLS から決定的に導出できる
- Firebase Security Rules で安全に強制できる
- frontend / backend で同じ layout を利用できる
- write / subscribe / Rules が同じ定義を参照する
- 利用側が RTDB path を手書きしない

## 複数の認可境界

`and()` に複数の条件が含まれる場合は、複数の partition を生成できます。

```ts
and(
  eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  eq(column(deals, "storeId"), principal(principalSchema, "storeId")),
);
```

例えば次のような構造になります。

```text
/deals
  /__rls
    /ownerId
      /user-1
        /storeId
          /store-1
            /deal-1
```

runtime では同じ定義から scope を取得します。

```ts
rtdb.deals.scope({
  userId: "user-1",
  storeId: "store-1",
});
```

## Literal による partition

固定値との比較も layout に利用できます。

```ts
and(
  eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  eq(column(deals, "status"), literal("open")),
);
```

生成される layout の例:

```text
/deals/__rls/ownerId/user-1/status/open/deal-1
```

Record の `status` が `"open"` でない場合は、path generation の時点で拒否されます。

## Firebase Security Rules

同じ RTDB 定義から、Firebase Realtime Database Security Rules を生成できます。

```ts
const rules = rtdb.rules();
```

返り値は JSON-compatible object です。

```ts
const json = JSON.stringify(rtdb.rules(), null, 2);
```

そのまま `database.rules.json` として出力できます。

将来的には `@gasboost/cli` がこの compiler API を利用して、例えば次のような command を提供します。

```bash
gasboost rtdb rules
```

`@gasboost/realtime-firebase` 自体は CLI や filesystem I/O を担当しません。

---

## Firebase Custom Token

`@gasboost/realtime-firebase` は、Firebase Authentication の Custom Token を生成できます。

Firebase Admin SDK や JWT library は利用せず、Google Apps Script 標準の `Utilities` を利用して RS256 署名を行います。

```ts
import { FirebaseCustomToken } from "@gasboost/realtime-firebase";

const token = FirebaseCustomToken.generate({
  uid: "user-1",

  claims: {
    storeId: "store-1",
  },

  serviceAccount: {
    email: "firebase-adminsdk@example.iam.gserviceaccount.com",
    privateKey,
  },

  utilities: Utilities,
});
```

生成される token は Firebase Authentication の Custom Token として利用できます。

```text
header.payload.signature
```

JWT header:

```json
{
  "alg": "RS256",
  "typ": "JWT"
}
```

payload には Firebase Custom Token に必要な以下の値が含まれます。

```text
iss
sub
aud
iat
exp
uid
claims
```

`iss` / `sub` には Service Account の email が設定されます。

`iat` は token 発行時刻、`exp` はその 1 時間後です。

### Custom claims

Firebase Authentication の custom claims は `claims` として指定します。

```ts
const token = FirebaseCustomToken.generate({
  uid: "user-1",

  claims: {
    storeId: "store-1",
    role: "manager",
  },

  serviceAccount: {
    email: serviceAccountEmail,
    privateKey,
  },

  utilities: Utilities,
});
```

例えば RTDB の Principal mapping で、

```ts
principal: {
  userId: "auth.uid",
  storeId: "auth.token.storeId",
},
```

と定義した場合、

```ts
claims: {
  storeId: "store-1",
}
```

として発行した値を、

```text
auth.token.storeId
```

として Firebase Security Rules から参照できます。

このため、

```text
Firebase Custom Token
        ↓
Firebase Authentication
        ↓
auth.uid / auth.token.*
        ↓
Firebase Security Rules
        ↓
RLS
```

という形で、Gasboost の Principal と Firebase Authentication を接続できます。

### UID

`uid` は Firebase Authentication 上の User ID です。

```ts
FirebaseCustomToken.generate({
  uid: "user-1",
  // ...
});
```

`uid` は 1〜128 文字である必要があります。

空文字や 128 文字を超える値は拒否されます。

### Reserved claims

Firebase / OpenID Connect が予約している claim は custom claims として利用できません。

例えば以下は拒否されます。

```ts
claims: {
  sub: "value",
}
```

予約済み claim には以下があります。

```text
acr
amr
at_hash
aud
auth_time
azp
cnf
c_hash
exp
iat
iss
jti
nbf
nonce
sub
firebase
user_id
```

### Service Account

Custom Token の署名には Firebase project に紐付いた Service Account の認証情報を使用します。

```ts
serviceAccount: {
  email: serviceAccountEmail,
  privateKey,
}
```

private key は application source code に直接埋め込まず、安全な credential storage から取得してください。

`@gasboost/realtime-firebase` は Service Account credential の保存や Secret Manager integration を担当しません。

### GAS Utilities

署名処理には Google Apps Script 標準の `Utilities` を使用します。

内部では、

```ts
Utilities.computeRsaSha256Signature(...)
```

による RSA SHA-256 署名と、

```ts
Utilities.base64EncodeWebSafe(...)
```

による base64url encoding を利用します。

そのため Firebase Admin SDK や JWT library は必要ありません。

### Client authentication

生成した Custom Token は frontend へ返し、Firebase 公式 SDK の `signInWithCustomToken()` に渡します。

```ts
import { getAuth, signInWithCustomToken } from "firebase/auth";

const auth = getAuth();

await signInWithCustomToken(auth, token);
```

`@gasboost/realtime-firebase` は Firebase Authentication client SDK をラップしません。

### Authentication package integration

`FirebaseCustomToken` は `@gasboost/auth` に依存しません。

```text
@gasboost/auth
      ↓
integration adapter
      ↓
@gasboost/realtime-firebase
      ↓
Firebase Custom Token
```

`FirebaseCustomToken` が扱うのは、

```text
uid
claims
Service Account
GAS Utilities
```

だけです。

Gasboost Auth の `User` / `Session` や認証 lifecycle は認識しません。

`@gasboost/auth` との接続は integration package の責務です。

---

## Principal mapping

RLS の Principal は Firebase Authentication 上の値へ明示的に対応付けます。

```ts
const rtdb = FirebaseRtdb.generate({
  tables,
  rowLevelSecurity,

  principal: {
    userId: "auth.uid",
    storeId: "auth.token.storeId",
  },
});
```

例えば、

```ts
principal(principalSchema, "userId");
```

は、

```text
auth.uid
```

に変換されます。

同様に、

```ts
principal(principalSchema, "storeId");
```

は、

```text
auth.token.storeId
```

に変換できます。

### Principal mapping の型推論

`FirebaseRtdb.generate()` は、`rowLevelSecurity` で参照されている Principal key を型レベルで追跡します。

例えば RLS が次の Principal を参照している場合、

```ts
const security = new RowLevelSecurity({
  table: deals,
  select: {
    using: eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  },
});
```

`principal` mapping には `userId` が必須になります。

```ts
FirebaseRtdb.generate({
  tables: [deals] as const,
  rowLevelSecurity: [security],

  principal: {
    userId: "auth.uid",
  },
});
```

必要な mapping を省略すると TypeScript error になります。

```ts
FirebaseRtdb.generate({
  tables: [deals] as const,
  rowLevelSecurity: [security],

  principal: {
    storeId: "auth.token.storeId",
    // error: userId is required
  },
});
```

複数の Principal key を RLS で利用する場合は、すべての key が必須になります。

```ts
const security = new RowLevelSecurity({
  table: deals,
  select: {
    using: and(
      eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
      eq(column(deals, "storeId"), principal(principalSchema, "storeId")),
    ),
  },
});

FirebaseRtdb.generate({
  tables: [deals] as const,
  rowLevelSecurity: [security],

  principal: {
    userId: "auth.uid",
    storeId: "auth.token.storeId",
  },
});
```

RLS で必要とされる key 以外の mapping を追加することもできます。

```ts
FirebaseRtdb.generate({
  tables: [deals] as const,
  rowLevelSecurity: [security],

  principal: {
    userId: "auth.uid",
    storeId: "auth.token.storeId",
    role: "auth.token.role",
  },
});
```

この型チェックは compile time の安全性を提供します。

同時に runtime でも Principal mapping を検証するため、型情報を失った JavaScript、型 assertion、外部入力などから不正な定義が渡された場合も missing mapping を拒否します。

すべての Principal を暗黙に `auth.uid` と扱うことはありません。

## RLS semantics

`@gasboost/rls` の semantics をそのまま維持します。

```text
RLS definition なし
→ unrestricted

RLS definition あり
+ 対象 operation の policy なし
→ deny

allow()
→ 明示的 allow
```

RTDB の write operation では `data` と `newData` を利用して CRUD を判定します。

```text
select.using
→ read authorization

insert.check
→ !data.exists()
   + newData.exists()
   + newData に対する check

update.using
→ data に対する authorization

update.check
→ newData に対する authorization

delete.using
→ data に対する authorization
   + !newData.exists()
```

さらに生成される Rules では、

- Record の primary key
- RLS partition の値

が物理 path と一致していることも検証します。

これにより、別の認可 subtree へ Record を不正に配置することを防ぎます。

## Projectability

すべての RLS を、RTDB の単一 subscription subtree に変換できるわけではありません。

`@gasboost/realtime-firebase` は認可 semantics を安全に保持できない場合、明示的に失敗します。

安全でない permissive fallback は行いません。

### Subscription scope に利用可能な式

現在、次の式から subscription scope を生成できます。

- `allow()`
- `eq()`
- `and()`
- `column()`
- `principal()`
- `literal()`

例えば、

```ts
eq(column(deals, "ownerId"), principal(principalSchema, "userId"));
```

であれば、単一の authorization partition に変換できます。

### `or()`

`or()` 自体は Record 単位の Security Rules では利用できます。

例えば、

```ts
or(
  eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
  eq(column(deals, "status"), literal("public")),
);
```

という条件は、1件の Record に対して評価できます。

しかし、

```text
自分がowner
OR
public
```

という条件は単一の RTDB subtree にはなりません。

複数の認可空間を横断する必要があるため、現在 `select.using` に `or()` が含まれる場合は projectability error とします。

## Relation-aware RLS

子 Table の認可条件が、親 Table の属性によって決まる場合があります。

例えば、次のような2つの Table があるとします。

```ts
import { defineTable } from "@gasboost/table";
import { z } from "zod";

const parents = defineTable({
  name: "parents",
  schema: z.object({
    id: z.string(),
    ownerId: z.string(),
    name: z.string(),
  }),
  primaryKey: "id",
});

const children = defineTable({
  name: "children",
  schema: z.object({
    id: z.string(),
    parentId: z.string(),
    value: z.string(),
  }),
  primaryKey: "id",
});
```

`children` 自体は `ownerId` を持ちません。

所有者は親 Record である `parents.ownerId` によって決まります。

```text
children.parentId
        ↓
parents.id
        ↓
parents.ownerId
        ↓
principal.userId
```

このような認可は `exists()` と `outerColumn()` を使って表現できます。

```ts
import {
  and,
  column,
  eq,
  exists,
  outerColumn,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { z } from "zod";

const principalSchema = z.object({
  userId: z.string(),
});

const childSecurity = new RowLevelSecurity({
  table: children,

  select: {
    using: exists(
      parents,
      and(
        eq(column(parents, "id"), outerColumn(children, "parentId")),
        eq(column(parents, "ownerId"), principal(principalSchema, "userId")),
      ),
    ),
  },
});
```

`outerColumn(children, "parentId")` は、`exists(parents, ...)` の外側にある現在の child Record の値を表します。

この定義から、`@gasboost/realtime-firebase` は single-hop relation を認可用の RTDB layout へ投影します。

```ts
const rtdb = FirebaseRtdb.generate({
  tables: [parents, children] as const,
  rowLevelSecurity: [childSecurity],

  principal: {
    userId: "auth.uid",
  },
});
```

### Record path

relation-aware な Table では、partition に必要な値が child Record 自体には存在しない場合があります。

その場合は、関連 Record を解決する resolver を `record()` に渡します。

```ts
const child = {
  id: "child-1",
  parentId: "parent-1",
  value: "example",
};

const path = rtdb.children.record(child, {
  resolve: ({ table, primaryKey, value }) => {
    if (
      table.name === "parents" &&
      primaryKey === "id" &&
      value === "parent-1"
    ) {
      return {
        id: "parent-1",
        ownerId: "user-1",
        name: "Parent",
      };
    }

    return null;
  },
});
```

例えば次の path が生成されます。

```text
/children/__rls/ownerId/user-1/child-1
```

resolver は storage-agnostic です。

`@gasboost/realtime-firebase` 自身は、SheetORM、Replica、Firebase SDK などから Record を取得しません。

関連 Record の取得方法は利用側が決定します。

```text
application
    ↓
resolver
    ↓
SheetORM / repository / cache / other storage
```

relation-aware policy が必要なのに resolver が指定されていない場合、または関連 Record が見つからない場合は明示的に失敗します。

### Subscription scope

subscription scope は child Record を必要としません。

Principal の値だけから生成できます。

```ts
const scope = rtdb.children.scope({
  userId: "user-1",
});
```

生成される scope:

```text
/children/__rls/ownerId/user-1
```

つまり、

```text
record path
= child relation を resolver で辿って partition を決定

scope path
= Principal から同じ partition を決定
```

となります。

両方とも同じ authorization layout metadata を利用します。

### Canonical Table schema

relation-aware RLS のためだけに、親の認可属性を child Table へ複製する必要はありません。

例えば、次のような schema にする必要はありません。

```ts
const children = defineTable({
  name: "children",
  schema: z.object({
    id: z.string(),
    parentId: z.string(),

    // RTDB authorization のためだけの重複 column
    ownerId: z.string(),

    value: z.string(),
  }),
  primaryKey: "id",
});
```

application の canonical schema は正規化したまま維持できます。

```text
Domain / canonical Table schema
!=
RTDB authorization layout
```

Firebase Realtime Database 固有の認可用非正規化は `@gasboost/realtime-firebase` が担当します。

### Projectable pattern

現在 relation-aware subscription scope として投影できるのは、single-hop で一意に解決できる relation です。

基本形は次の通りです。

```ts
exists(
  parentTable,
  and(
    eq(
      column(parentTable, parentPrimaryKey),
      outerColumn(childTable, childForeignKey),
    ),
    eq(
      column(parentTable, partitionColumn),
      principal(principalSchema, principalKey),
    ),
  ),
);
```

equality の左右を逆にしても同じ relation として扱われます。

```ts
eq(
  outerColumn(childTable, childForeignKey),
  column(parentTable, parentPrimaryKey),
);
```

partition source には Principal だけでなく literal も利用できます。

```ts
exists(
  parents,
  and(
    eq(column(parents, "id"), outerColumn(children, "parentId")),
    eq(column(parents, "status"), literal("active")),
  ),
);
```

### Projectability and fail closed

relation を安全かつ一意に RTDB layout へ投影できない場合、`@gasboost/realtime-firebase` は明示的に失敗します。

例えば以下は permissive に fallback しません。

- referenced Table が RTDB に登録されていない
- `outerColumn()` が現在の child Table を参照していない
- `column()` が `exists()` の対象 Table を参照していない
- relation target が parent primary key ではない
- relation equality を一意に決定できない
- conflicting partition が存在する
- relation cycle が発生する
- multi-hop relation が必要になる
- relation resolver が指定されていない
- resolver が関連 Record を解決できない

unsupported な relation を認可条件から無視したり、`true` に変換したりすることはありません。

常に fail closed します。

## Record identity

RTDB の Record path を生成するには primary key が必要です。

`@gasboost/rls` の共通 `TableDefinition` は storage-agnostic なまま維持するため、`@gasboost/realtime-firebase` 側では `primaryKey` を持つ構造型を要求します。

```ts
const deals = {
  name: "deals",
  schema: dealSchema,
  primaryKey: "id",
} as const;
```

SheetORM の `SheetTable` は既に、

```text
name
schema
primaryKey
```

を持っているため、`@gasboost/sheetorm` へ依存せず構造的に利用できます。

## Package boundary

`@gasboost/realtime-firebase` が直接依存するのは、

```text
@gasboost/rls
```

です。

以下には依存しません。

- `@gasboost/sheetorm`
- `@gasboost/replica`
- React
- IndexedDB
- Dexie
- Firebase Browser SDK
- CLI framework

責務は次の範囲に限定します。

```text
@gasboost/realtime-firebase
  │
  ├─ RLS
  │    ↓
  │  Authorization layout
  │    ├─ Record path
  │    ├─ Subscription scope
  │    └─ Firebase Security Rules
  │
  └─ Firebase Authentication
       └─ Custom Token generation
```

Firebase への通信は Firebase 公式 SDK が担当します。

Firebase Authentication の client-side sign in も Firebase 公式 SDK が担当します。

CLI command、config file、filesystem output は `@gasboost/cli` が担当します。

`@gasboost/auth` との lifecycle integration は別 integration package が担当します。

## Architecture

```text
FirebaseRtdb
  │
  ├─ FirebaseRtdbLayout
  │    └─ FirebaseRtdbScopeProjector
  │         └─ FirebaseRtdbBinding
  │
  ├─ FirebaseRtdbTable
  │    └─ FirebaseRtdbPathSegment
  │
  └─ FirebaseRtdbRulesCompiler
       ├─ FirebaseRtdbRulesLocation
       ├─ FirebaseRtdbPredicateCompiler
       │    └─ FirebaseRtdbValueCompiler
       ├─ FirebaseRtdbWriteRuleCompiler
       └─ FirebaseRtdbInvariantCompiler
```

各クラスは1つの責務を持ちます。

状態は各オブジェクト内部へ隠蔽し、振る舞いは public method として提供します。

## License

MIT
