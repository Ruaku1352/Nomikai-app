# 飲み会集合場所決めアプリ

参加メンバーそれぞれの「直前の活動場所の最寄駅」を入力すると、各メンバーからの距離をもとに
**みんなが集まりやすい駅を3つ**提案し、各駅について**選んだジャンルの店を口コミ評価順に3件ずつ**表示するPWAです。

要件定義は `docs/spec.md` を参照してください。

---

## 構成

```
.
├── src/                 フロントエンド（React + Vite + TypeScript + Tailwind, PWA）
│   ├── screens/         メンバー入力 / ジャンル選択 / 結果 の3画面
│   ├── components/      駅オートコンプリート・駅カード・店カード
│   ├── store/           Zustand（直前の結果を localStorage に永続化＝オフライン閲覧）
│   └── lib/             API クライアントとスコアリング
└── functions/           Cloud Functions for Firebase（APIキー保護用の薄いプロキシ）
    └── src/google.ts    Places API (New) のラッパー
```

**APIキーはクライアントに一切埋め込みません。** ブラウザは `/api/**` を叩き、
Cloud Functions 側だけが Google Maps Platform のキーを保持します。

### エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/stations/autocomplete?q=` | 駅名オートコンプリート（駅タイプに限定し、駅名一致順に5件） |
| GET | `/api/stations/:placeId` | 駅の緯度経度（Place Details） |
| POST | `/api/candidates` | 候補駅のリストアップ＋各メンバーからの直線距離（Nearby Search） |
| POST | `/api/venues` | 駅周辺の店をジャンル別に検索し加重スコア順に3件返す（Text Search） |
| GET | `/api/photo?name=` | 店舗写真のプロキシ（署名付きURLへ302リダイレクト） |
| GET | `/api/diag` | 設定の切り分け（キーの有無とPlaces APIへの疎通を1コールで確認） |

---

## アルゴリズム

**候補駅（4.1）**: 全員の駅の重心を出し、重心から一番遠いメンバーまでの距離をもとに検索半径を決めて
Nearby Search で駅を取得。同一駅の別出口などを避けるため 400m 以内の駅は1つにまとめ、
最大 15 駅（既定 12 駅）に絞ります。

**距離（4.2）**: 各メンバー駅から候補駅までの**ハバサイン距離（大圏距離）**をサーバ内で計算します。
外部APIは不要です。

> **なぜ電車の所要時間ではないのか**
> Routes API の `travelMode: TRANSIT` は**日本国内の公共交通をサポートしていません**
> （公式ドキュメントに交通機関対象リストから日本が除外されている旨の記載があり、
> 日本国内の座標では HTTP 200 のまま `routes` が空で返ります）。
> Googleマップ上で日本の乗換案内が使えるのはパートナー提携によるもので、その権利はAPI利用者には及びません。
> 詳細な切り分け結果は `docs/spec.md` の「2.2 集合場所の算出」を参照してください。

**スコアリング（4.3）**:

```
score_sum(駅) = Σ(各メンバーの距離)
score_max(駅) = max(各メンバーの距離)
```

UI 上で「合計最小 / 最長最小」を切り替えられます。同点時は全員の重心に近い駅を優先します。

スコア集計は `summarizeCosts()` として単位に依存しない形で切り出してあるため、
将来 有料の乗換API を導入した場合は、距離(m)の代わりに所要時間(分)を渡すだけで同じ構造が使えます。

**駅名の検索**: **Text Search を主経路**にしています。Autocomplete の
`includedPrimaryTypes` に駅タイプを指定すると、日本の主要駅（東京・新宿・渋谷・
恵比寿・目黒など）が候補に出てこない事象が確認されたためです。

1. メモリキャッシュ（10分）
2. **Text Search**（実在の場所を返すので駅を取りこぼさない。緯度経度も返るため
   選択時の Place Details が不要）
3. 件数が足りず完全一致も無ければ Autocomplete で補う
4. それでも0件ならタイプ指定なしの Autocomplete

完全一致が取れたら打ち切るため、通常のコールは1入力あたり1回です。

Places Autocomplete は住所も部分一致の対象にするため、
「渋谷」で代官山駅・代々木公園駅（どちらも渋谷区）が返ります。
`rankByNameMatch()` で駅名側の一致度（完全一致 > 前方一致 > 部分一致）を採点し、
住所だけが一致した候補は捨てています。カタカナ・全角半角・末尾の「駅」は正規化して吸収します。

**店舗（4.4）**: `weighted_score = rating * log(user_ratings_total + 1)` で並べ替え、
レビュー数の少ない高評価店が上位を占めないようにしています。
集合時間を指定した場合は `regularOpeningHours.periods` を使って営業時間（深夜営業の日跨ぎ対応）でフィルタします。

---

## セットアップ

### 事前準備

1. Firebase プロジェクトを作成し、**Blaze プラン**に変更（外部API呼び出しに必要）
2. Google Maps Platform で APIキーを発行し、**Places API (New)** を有効化
   （Routes API は使用しません）
3. APIキーには HTTP リファラ制限ではなく **API 制限**（Places API (New) のみ）を設定してください。
   キーはサーバからのみ使うため、リファラ制限は効きません。

### ローカル開発

```bash
# 1. 依存関係
npm install
npm --prefix functions install

# 2. プロジェクトIDを設定
cp .firebaserc.example .firebaserc   # your-firebase-project-id を書き換える

# 3. APIキーを配置（.gitignore 済み。絶対にコミットしない）
cp functions/.env.example functions/.env
#   GOOGLE_MAPS_API_KEY=... を実キーに書き換える

# 4. フロントの向き先を設定
cp .env.example .env
#   VITE_FUNCTIONS_EMULATOR_PREFIX=/<projectId>/asia-northeast1/api

# 5. 起動（別ターミナルで2つ）
npm --prefix functions run build && npx firebase emulators:start --only functions
npm run dev
```

`npm run dev` の Vite dev server が `/api` を Functions エミュレータへプロキシします。

### 本番デプロイ

```bash
# APIキーを Secret Manager に登録（.env は本番では使わない）
npx firebase functions:secrets:set GOOGLE_MAPS_API_KEY

npm run build                      # dist/ を生成
npm --prefix functions run build
npx firebase deploy                # Hosting + Functions
```

Hosting の `rewrites` で `/api/**` が `asia-northeast1` の `api` 関数に転送されます。

---

## コストに関する注意

- Places API は**従量課金**です。Google Cloud で**予算アラート**を設定しておくことを強く推奨します。
- 1回の検索でのコール数の目安: Autocomplete（入力ごと・250msデバウンス）+ Place Details（人数分）
  + Nearby Search 1回 + Text Search（駅3 × ジャンル数）+ 写真（表示分）。
  駅検索は Text Search が主経路のため Autocomplete より単価が高くなります。完全一致で打ち切る仕組みと
  10分のメモリキャッシュ、350msのデバウンスでコール数を抑えています。
  距離計算はサーバ内で完結するため、メンバーが増えてもAPIコールは増えません。
- 候補駅の上限は `functions/src/index.ts` の `MAX_CANDIDATES`、店の検索半径は `VENUE_RADIUS_METERS` で調整できます。
- 関数側は `maxInstances: 10` で暴走を抑えています。
- Places API の結果はキャッシュ期間に制限があるため、サーバ側では永続キャッシュしていません。
  Service Worker も `/api/**` はキャッシュせず、直前の結果のみ localStorage に保持してオフライン閲覧に使います。

---

## 駅の検索がうまくいかないとき

まず切り分け用エンドポイントを叩いてください。APIキーは返りません。

```bash
curl http://127.0.0.1:5001/<projectId>/asia-northeast1/api/diag
```

| 返ってくるもの | 原因 | 対処 |
|---|---|---|
| `{"keyConfigured": false, ...}` | キーが読めていない | `functions/.env` に `GOOGLE_MAPS_API_KEY=...` を置き、エミュレータを再起動 |
| `Places API (New) が有効になっていません` | 有効化しているのが**レガシーの Places API** | Google Cloud で **Places API (New)** を有効化（別サービス扱い） |
| `APIキーの制限で拒否されました` | キーのAPI制限／リファラ制限 | API制限に Places API (New) を追加。**リファラ制限は外す**（サーバから呼ぶため効かない） |
| `課金設定が有効になっていません` | Blazeプラン未設定 | Firebase を Blaze プランに変更 |
| `APIに接続できません (404)` | フロントがFunctionsに届いていない | `.env` の `VITE_FUNCTIONS_EMULATOR_PREFIX=/<projectId>/asia-northeast1/api` とエミュレータの起動を確認 |
| `{"ok": true, "resultCount": 5}` | バックエンドは正常 | ブラウザのDevToolsで `/api/stations/autocomplete` のレスポンスを確認 |
| `{"ok": false, "resultCount": 0}` | Googleが候補を返していない | `trace.stages` を見てどの段階で0件になったか確認 |

候補が0件になる場合は `?debug=1` を付けると、どの検索経路が何件返したかが分かります。

```bash
curl 'https://<your-app>.web.app/api/stations/autocomplete?q=渋谷&debug=1'
```

```json
{
  "suggestions": [...],
  "trace": {
    "source": "text-search",
    "stages": [
      { "name": "autocomplete(駅タイプ指定)", "query": "渋谷", "raw": 0, "names": [] },
      { "name": "text-search", "query": "渋谷", "raw": 2, "names": ["渋谷駅", "渋谷ヒカリエ駅"] }
    ]
  }
}
```

エラーの詳細（Googleが返した `INVALID_ARGUMENT` 等）は画面のエラー表示にも小さく出ます。

---

## テスト

```bash
npm --prefix functions test
```

距離計算・スコア集計・加重スコア・営業時間判定・駅名マッチングのユニットテスト
（`functions/test/util.test.js`、33件）が走ります。
外部依存が無いため、APIキーなしで実行できます。

---

## 未実装 / ローカル仕上げ向けのTODO

- Maps JavaScript API による地図のミニビュー（現状は Google マップへのリンクのみ）
- 候補駅の「発展版」絞り込み（各メンバーの到達可能駅集合の積集合）
- 駅データ.jp などの無料路線データを取り込み、「同一路線で乗換なしに行けるか」を加点要素にする
- 有料の乗換API（駅すぱあと Web サービス、NAVITIME API 等）への差し替え。
  `summarizeCosts()` に所要時間(分)を渡す形にすれば、スコアリングの構造はそのまま使える
