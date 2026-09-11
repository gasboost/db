# @gasboost/rls

Zod Schema を利用した、型安全でストレージ非依存の Row Level Security 定義ライブラリです。

`@gasboost/rls` は、Record 単位のアクセス制御を宣言的な Authorization AST として表現します。

Google Sheets、SQL、Firebase Realtime Database などの具体的なストレージには依存せず、同じ RLS 定義をそれぞれの Adapter / Interpreter から解釈できます。

```text
@gasboost/rls
  └─ Authorization AST
      ├─ SheetORM
      │   └─ In-memory evaluator
      ├─ SQL / D1
      │   └─ WHERE / EXISTS compiler
      └─ Firebase RTDB
          └─ Security Rules compiler
```

---

## Features

- Zod Schema による型安全な Column 参照
- 型安全な Principal 参照
- Storage Agnostic
- Declarative Authorization AST
- `select / insert / update / delete` policy
- PostgreSQL RLS に近い `using / check` semantics
- AND / OR
- Equality comparison
- Other Table references with `exists`
- Outer Record references
- SheetORM / SQL / Firebase から解釈可能
- Authentication implementation 非依存

---

## Explicit Allow

認可条件を設けず、操作を明示的に許可したい場合は `allow()` を使用します。

```ts
import { allow, RowLevelSecurity } from "@gasboost/rls";

const security = new RowLevelSecurity({
  table: deals,

  select: {
    using: allow(),
  },
});
```

`allow()` は常に許可される Predicate Expression を表します。

```text
allow()
↓
true
```

`literal(true)` ではなく専用の Authorization AST として表現されるため、Interpreter / Compiler は「明示的な無条件許可」として扱うことができます。

例えば、

```text
SheetORM
→ true

SQL
→ TRUE

Firebase RTDB
→ true
```

のように各 Backend へ変換できます。

---

## Policy Semantics

RLS の設定有無と Policy の有無は、それぞれ異なる意味を持ちます。

```text
RLS definition が存在しない
→ unrestricted

RLS definition が存在する
かつ対象 operation の Policy が存在しない
→ deny

RLS definition が存在する
かつ allow() が指定されている
→ explicitly allow
```

例えば、

```ts
new RowLevelSecurity({
  table: deals,

  select: {
    using: allow(),
  },
});
```

では `select` はすべて許可されます。

一方、

```ts
new RowLevelSecurity({
  table: deals,
});
```

では、この Table に RLS が設定されているため、Policy が定義されていない operation は許可されません。

この仕様により、

```text
RLSを利用しないTable
→ 従来どおり unrestricted

RLSを利用するTable
→ 明示されたPolicyのみ許可

認可条件を必要としないoperation
→ allow() で明示
```

という区別ができます。

---

## Predicate Expressions

利用可能な Predicate Expression は以下です。

| Expression                 | 意味                                    |
| -------------------------- | --------------------------------------- |
| `allow()`                  | 常に許可                                |
| `eq(left, right)`          | 左右の値が等しい                        |
| `and(...conditions)`       | すべての条件を満たす                    |
| `or(...conditions)`        | 1つ以上の条件を満たす                   |
| `exists(table, condition)` | 対象Tableに条件を満たすRecordが存在する |

---

## Installation

```bash
pnpm add @gasboost/rls zod
```

npm の場合:

```bash
npm install @gasboost/rls zod
```

---

## Table Definition

RLS が必要とする Table 定義は `name` と Zod Schema だけです。

```ts
import { z } from "zod";

const deals = {
  name: "deals",
  schema: z.object({
    id: z.string(),
    salesPersonId: z.string(),
    amount: z.number(),
  }),
} as const;
```

Spreadsheet ID、SQL table metadata、Firebase path などのストレージ固有情報は RLS に含みません。

---

## Principal

Principal は、現在操作を要求している主体を表します。

```ts
const principalSchema = z.object({
  userId: z.string(),
  role: z.enum(["sales", "manager"]),
});
```

Principal は特定の Authentication Library や User 型には依存しません。

```ts
principal(principalSchema, "userId");
principal(principalSchema, "role");
```

存在しない key は compile-time error になります。

```ts
principal(principalSchema, "unknown");
```

---

## Value Expressions

### Column

現在評価中の Record の値を参照します。

```ts
column(deals, "salesPersonId");
```

概念的には、

```ts
currentRecord.salesPersonId;
```

を表します。

### Principal

現在の Principal の値を参照します。

```ts
principal(principalSchema, "userId");
```

概念的には、

```ts
currentPrincipal.userId;
```

を表します。

### Literal

定数値を表します。

```ts
literal(100);
```

### Outer Column

`exists()` 内から外側の Record を参照します。

```ts
outerColumn(deals, "salesPersonId");
```

---

## Predicate Expressions

### Equality

```ts
eq(column(deals, "salesPersonId"), principal(principalSchema, "userId"));
```

概念的には、

```ts
currentRecord.salesPersonId === currentPrincipal.userId;
```

です。

Operand の型が一致しない場合は compile-time error になります。

```ts
eq(column(deals, "amount"), principal(principalSchema, "userId"));
```

---

## AND / OR

```ts
and(
  eq(...),
  eq(...),
);
```

```ts
or(
  eq(...),
  eq(...),
);
```

---

## RowLevelSecurity

```ts
import { column, eq, principal, RowLevelSecurity } from "@gasboost/rls";

const dealSecurity = new RowLevelSecurity({
  table: deals,

  select: {
    using: eq(
      column(deals, "salesPersonId"),
      principal(principalSchema, "userId"),
    ),
  },

  insert: {
    check: eq(
      column(deals, "salesPersonId"),
      principal(principalSchema, "userId"),
    ),
  },

  update: {
    using: eq(
      column(deals, "salesPersonId"),
      principal(principalSchema, "userId"),
    ),
    check: eq(
      column(deals, "salesPersonId"),
      principal(principalSchema, "userId"),
    ),
  },

  delete: {
    using: eq(
      column(deals, "salesPersonId"),
      principal(principalSchema, "userId"),
    ),
  },
});
```

各 Policy の意味は以下です。

| Policy         | 意味                               |
| -------------- | ---------------------------------- |
| `select.using` | 既存 Record を参照できる条件       |
| `insert.check` | 新規 Record が許可された状態か     |
| `update.using` | 既存 Record を更新対象にできる条件 |
| `update.check` | 更新後 Record が許可された状態か   |
| `delete.using` | 既存 Record を削除対象にできる条件 |

---

## Referencing Other Tables

`exists()` を使って別 Table を参照できます。

```ts
const assignments = {
  name: "assignments",
  schema: z.object({
    managerId: z.string(),
    subordinateId: z.string(),
  }),
} as const;

const security = new RowLevelSecurity({
  table: deals,

  select: {
    using: or(
      eq(column(deals, "salesPersonId"), principal(principalSchema, "userId")),
      exists(
        assignments,
        and(
          eq(
            column(assignments, "managerId"),
            principal(principalSchema, "userId"),
          ),
          eq(
            column(assignments, "subordinateId"),
            outerColumn(deals, "salesPersonId"),
          ),
        ),
      ),
    ),
  },
});
```

この例では、

```text
本人の案件
OR
自分の部下が担当する案件
```

を表現しています。

---

## Storage Agnostic

`@gasboost/rls` 自体は Authorization AST を定義するだけです。

Record の読み込みやアクセス制御の実行は行いません。

```text
RLS AST
  ↓
Interpreter
```

例えば SheetORM では、

```text
load
↓
RLS evaluation
↓
authorized records
↓
Query
```

として解釈できます。

SQL backend では、

```ts
eq(column(deals, "salesPersonId"), principal(principalSchema, "userId"));
```

を概念的に、

```sql
WHERE deals.sales_person_id = ?
```

へ変換できます。

---

## Query との関係

`@gasboost/query` と `@gasboost/rls` は責務が異なります。

```text
@gasboost/query
= 何を取得したいか

@gasboost/rls
= どの Record を操作してよいか
```

Query はユースケースごとに変化します。

RLS は Database / Repository に対する恒常的な Authorization Rule として利用できます。

---

## Architecture

```text
@gasboost/rls
├─ ValueExpression
│  ├─ column
│  ├─ outerColumn
│  ├─ principal
│  └─ literal
├─ PredicateExpression
│  ├─ allow
│  ├─ eq
│  ├─ and
│  ├─ or
│  └─ exists
└─ RowLevelSecurity
   ├─ select.using
   ├─ insert.check
   ├─ update.using
   ├─ update.check
   └─ delete.using
```

`@gasboost/rls` は認可条件を AST として表現することだけを責務とします。

具体的な評価・変換は各 Adapter / Interpreter の責務です。

`@gasboost/rls` は認可条件を AST として表現することだけを責務とします。

具体的な評価・変換は各 Adapter / Interpreter の責務です。

---

## License

MIT
