# @gasboost/realtime-firebase

Google Apps Script（GAS）から Firebase Realtime Database（RTDB）へテーブルのVersion変更を通知するパッケージです。
FrontendはFirebase公式SDKで通知を購読し、TanStack Queryなどのキャッシュを無効化してGAS RPCから正本を再取得します。
レコード本体はRTDBへ複製しません。

## インストールとエントリーポイント

```bash
pnpm add @gasboost/realtime-firebase @gasboost/table zod
```

- Backend（GAS）: `@gasboost/realtime-firebase`
- Frontend（Browser）: `@gasboost/realtime-firebase/client`

`/client` は純粋関数 `versionPath(table: TableDefinition): string` のみを公開します。
GAS globals・サーバー用モジュール・Firebase SDKをruntime importせず、Firebase初期化・購読・状態管理も行いません。
`TableDefinition` は既存の `@gasboost/table` からtype-only importします。FrontendのFirebase SDKやTanStack Queryは利用側で用意してください。

## Backend / Frontendでテーブル定義を共有する

```ts
// shared/tables.ts（Consumer側の共有モジュール）
import { defineTable } from "@gasboost/table";
import { z } from "zod";

export const productsTable = defineTable({
  name: "products",
  schema: z.object({ id: z.string(), name: z.string() }),
  primaryKey: "id",
});
```

BackendのSheetTableにも同じ定義を使い（例: `new SheetTable({ ...productsTable, dbId })`）、
Frontendは共有モジュールの `productsTable` を `versionPath()` に渡します。
テーブル名を `items` に変更すると、SheetORMの `change.table` とFrontendの通知先も同じ定義に追従します。

## Backend: SheetORMのafterCommitから通知する

```ts
import { SheetDB, SheetGateway } from "@gasboost/sheetorm";
import {
  FirebaseRtdb,
  FirebaseRtdbRestTransport,
  PropertiesVersionStore,
} from "@gasboost/realtime-firebase";

const properties = PropertiesService.getScriptProperties();
const rtdb = new FirebaseRtdb({
  versionStore: new PropertiesVersionStore(properties),
  transport: new FirebaseRtdbRestTransport({
    databaseUrl: "https://YOUR_DATABASE_URL",
    urlFetchApp: UrlFetchApp,
    cacheService: CacheService,
    credentialsProvider: () => ({
      email: properties.getProperty("FIREBASE_SERVICE_ACCOUNT_EMAIL")!,
      privateKey: properties.getProperty("FIREBASE_PRIVATE_KEY")!,
    }),
  }),
});

// tablesは利用側で定義したSheetTableの配列。
const db = new SheetDB({
  tables,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,
  afterCommit: (changes) => rtdb.publish(changes),
});
```

`FirebaseRtdb` のコンストラクタには `versionStore` と `transport` のみを渡します。
テーブル定義・Principal・RLS・resolver/queryは不要です。データの認可はSheetORM / GAS RPC側で行います。
既存のSheetORM `afterCommit` から渡される変更配列はそのまま利用できます。

### publishの契約

```ts
publish(changes: readonly { table: string }[]): void
```

`publish()` は同期メソッドです。変更配列から重複を除いたテーブル名ごとに1回だけVersionを採番し、
1回のroot multi-location PATCHで数値を通知します。

```ts
rtdb.publish([
  { table: "employees" },
  { table: "employees" },
  { table: "departments" },
]);
// 初回: { "syncVersions/employees": 1, "syncVersions/departments": 1 }
```

- Create / Update / Deleteの種類に依存せず、テーブル名だけを使います。
- 空配列は何もせず、VersionStore / Transportも呼びません。
- 入力配列・レコードは変更しません。レコード本体や削除情報は送信しません。
- 未変更の依存テーブルを列挙しません。Cascade削除などで実際の子の変更も配列に含まれる場合は親子双方を通知します。
- 親の値に依存するQueryは、親テーブルの通知でも無効化するようFrontendを設定してください。

### RTDBパスの正規化と衝突

Backendの `publish()` とFrontendの `versionPath()` は同じBrowser-safeな関数で、テーブル名から
制御文字（U+0000〜U+001F、U+007F〜U+009F）と `.` / `#` / `$` / `[` / `]` / `/` を取り除きます。
例えば `sales.2026` は `/syncVersions/sales2026`、有効な `products` は `/syncVersions/products` になります。
SheetORM / `@gasboost/table` の論理テーブル名は変更せず、VersionStoreの採番キーも元の名前を使用します。

正規化後が空の場合は両APIが例外を投げます。Backendは同一publish内、および同一 `FirebaseRtdb` インスタンスで
既に検証した通知先と、異なる論理テーブル名が衝突する場合も例外を投げます。
例: `sales.2026` と `sales2026` を同じ通知先として黙って共有せず、採番・PATCHの前に停止します。
同じ論理名の重複は衝突とせず、従来どおり1回だけ採番します。

**正規化は情報を失うため、共有する全テーブル定義で正規化後の名前が一意になるようにしてください。**
Frontendのパス関数は純粋関数であり、他の定義を知りません。Backendの衝突履歴も永続化しないため、
別インスタンスやGASの別実行にまたがって、別々にしか登場しないテーブル間の衝突は検出できません。
衝突した場合は共有定義の論理名を一意な通知先になるように見直してください。自動で別名やsuffixは割り当てません。

### VersionStoreと失敗時の扱い

`PropertiesVersionStore` は `rtdb:version:<tableName>` をScript Propertiesに保存します。
初期値0から+1し、不正な保存値や安全な整数の上限に達した場合は例外を投げます。
任意の同期 `VersionStore`（`next(tableName): number`）と `RtdbTransport`（`patch(updates): void`）も注入できます。

VersionStore自体はロックを実装しません。同じテーブルのwriterは同じPropertiesと既存のテーブルロックを共有してください。
SheetORMの `afterCommit` ではシート更新からpublish完了までロックが保持されます。
直接publishを呼ぶ場合も、呼び出し元で同じロック境界を確保します。

採番・PATCHの例外は呼び出し元へ伝播します。採番後のPATCH失敗では欠番を許容します。
同じ変更配列で再実行すれば新しいVersionで通知できます。Frontendは正本を再取得するため、Versionの連続性は不要です。
自動再送や分散Transactionは提供しません。通知が失敗すると、次の成功通知または明示的な再取得までキャッシュが古いままになる場合があります。
SheetORMのafterCommit失敗時もシートの更新はコミット済みです。
`seed / migrate` はHook対象外のため、必要なら変更テーブルを別途publishして再取得を通知してください。

### REST transportの認証

`FirebaseRtdbRestTransport` は `credentialsProvider` が返す `FirebaseServiceAccount`（`email` / PEM形式の `privateKey`）で
RS256 OAuth JWTを署名し、アクセストークンを内部取得します。秘密鍵のリテラルの `\n` は署名直前に実改行へ正規化します。
既に実改行を含む秘密鍵はそのまま利用できます。秘密鍵をFrontendに渡さないでください。

`CacheService.getScriptCache()` に有効なtokenがあればcredential storageは読みません。
constructorでは認証せず、cache miss / expiration時にproviderを呼びます。
キャッシュはdatabase URLごとに分離され、同じscript / database URLのtransportは同じService Accountを使用する前提です。
TTLは `expires_in` から通信時間と60秒の余裕を差し引き、CacheServiceの上限（6時間）以内にします。
短命tokenでTTLが正にならない場合はキャッシュしません。

署名にはGAS標準の `Utilities` を使用します。GAS外のテストでは `utilities` も注入できます。
`urlFetchApp` / `cacheService` は構造的な部分型なのでfakeを利用できます。
HTTPエラー・通信例外は呼び出し元へ伝播します。
credentialの保存・取得先、対象FirebaseへのService Accountのアクセス権限は利用側で管理してください。
OAuthのscopeは `https://www.googleapis.com/auth/firebase.database` と
`https://www.googleapis.com/auth/userinfo.email` です。

## Rules: 認証済みClientの通知readのみを許可

`rtdb.rules()` は次のJSONを返します。Firebaseへ適用してから購読してください。

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "syncVersions": { ".read": "auth != null" }
  }
}
```

認証済みユーザーは `/syncVersions` 全体または個別のテーブルVersionを読み取れます。
未認証のread、Client write、その他のパスのread/writeは拒否します。
BackendのService AccountがREST APIで通知を書き込みます。

通知はユーザーごとのRLSで分離しません。テーブル名と更新頻度は認証済みユーザー全員に公開されます。
レコード取得時のアクセス権限はGAS RPC / SheetORMで判定してください。

## Frontend: Firebase公式SDKで購読する

```ts
import { versionPath } from "@gasboost/realtime-firebase/client";
import { onValue, ref } from "firebase/database";
import { productsTable } from "./shared/tables";

// databaseは初期化済みのFirebase Database、queryClientはTanStack QueryのQueryClient。
// Firebase Authenticationのsign-in完了後に購読します。
const unsubscribe = onValue(
  ref(database, versionPath(productsTable)),
  () => {
    void queryClient.invalidateQueries({ queryKey: ["staff"] });
  },
);

// 画面の破棄時などに呼び出します。
unsubscribe();
```

`versionPath(productsTable)` は `/syncVersions/products` を返します。文字列や独自の定義型を渡す必要はありません。
Queryの取得関数にはGAS RPCを設定してください。初回・再接続時も現在値のイベントで再取得できます。
Firebase SDKの購読ラッパーやTanStack Query専用hookは提供しません。

## Firebase Custom Token

既存の `FirebaseCustomToken` と関連する `FirebaseServiceAccount` / `FirebaseCustomTokenUtilities` /
`FirebaseCustomClaims` は引き続きBackendエントリーポイントから利用できます。
Firebase Admin SDKやJWTライブラリには依存しません。

```ts
import { FirebaseCustomToken } from "@gasboost/realtime-firebase";

const token = FirebaseCustomToken.generate({
  uid: "user-1",
  claims: { role: "manager" }, // 省略可能
  serviceAccount: { email, privateKey },
  utilities: Utilities,
});
```

`uid` は1〜128文字です。Firebase / OpenID Connectの予約claimは拒否します。
Custom Tokenも秘密鍵のリテラルの `\n` を署名直前に正規化します。
生成tokenはFrontendへ返し、Firebase公式SDKの `signInWithCustomToken()` に渡します。
認証・セッションのlifecycleやcredentialの保存は利用側またはintegration packageが管理します。

## 0.7.x以前からの移行

0.8.0では旧レコード複製用APIを削除しました。

- `new FirebaseRtdb({ versionStore, transport })` に変更し、`tables` / `principal` / `rowLevelSecurity` / `resolve` / `query` を取り除きます。
- Frontendのパス取得を `@gasboost/realtime-firebase/client` の `versionPath(sharedTableDefinition)` に置き換えます。
- 新しい `rtdb.rules()` をFirebaseへ適用し、通知を契機としたGAS RPCの再取得を使用します。
- 旧layout・record/scope・RLSコンパイラのクラスと関連型はexportされません。

既存の `afterCommit: changes => rtdb.publish(changes)` は維持できます。
既存RTDBデータの削除・移行は自動実行しません。

## License

MIT
