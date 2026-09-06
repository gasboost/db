# gasboost/db

Google Apps Script でデータアクセスを扱うためのライブラリ群です。

Google Workspace と密接に連携できる Google Apps Script の強みを活かしながら、アプリケーションから Google Sheets を型安全に扱うためのデータアクセス基盤を提供します。

## Packages

### @gasboost/sheetorm

Google Apps Script / Google Sheets 向けの、Zod ベースの型安全な ORM です。

Google Sheets の各シートをテーブルとして扱い、Zod Schema から推論された Record に対して CRUD、Query、Relation、Transaction などの操作を提供します。

主な機能:

- Zod Schema による型安全な Record
- Create / Find / Update / Upsert / Delete
- Query / Filter / Order By / Limit / Offset
- JOIN / Recursive JOIN
- Relation
- Cascade / Set Null / Restrict
- Nested Create
- 数値 Auto Increment / UUID Auto Numbering
- Unique Constraint
- Optimistic Lock
- Transaction / Commit / Rollback
- Migration
- Seed
- Sheet Protection

インストール:

```bash
pnpm add @gasboost/sheetorm zod
```

詳細な API、利用方法、設計方針については [@gasboost/sheetorm README](./packages/sheetorm/README.md) を参照してください。

## Design

gasboost/db は Domain Model を提供しません。

Google Sheets から取得したデータを型安全な Record として扱うところまでを責務とし、Domain Entity への変換や Business Logic は利用側の Application / Repository に委ねます。

```text
Google Sheets
     ↓
@gasboost/sheetorm
     ↓
Record
     ↓
Application / Repository
     ↓
Domain
```

また、Google Sheets への I/O は可能な限り Table 単位に集約し、Filter、Sort、JOIN などを取得後のメモリ上で処理することで、Spreadsheet API の呼び出し回数を抑えることを重視しています。

## License

MIT
