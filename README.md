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
| GET | `/api/stations/autocomplete?q=` | 駅名オートコンプリート（Places Autocomplete、駅タイプに限定） |
| GET | `/api/stations/:placeId` | 駅の緯度経度（Place Details） |
| POST | `/api/candidates` | 候補駅のリストアップ＋各メンバーからの直線距離（Nearby Search） |
| POST | `/api/venues` | 駅周辺の店をジャンル別に検索し加重スコア順に3件返す（Text Search） |
| GET | `/api/photo?name=` | 店舗写真のプロキシ（署名付きURLへ302リダイレクト） |

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
  距離計算はサーバ内で完結するため、メンバーが増えてもAPIコールは増えません。
- 候補駅の上限は `functions/src/index.ts` の `MAX_CANDIDATES`、店の検索半径は `VENUE_RADIUS_METERS` で調整できます。
- 関数側は `maxInstances: 10` で暴走を抑えています。
- Places API の結果はキャッシュ期間に制限があるため、サーバ側では永続キャッシュしていません。
  Service Worker も `/api/**` はキャッシュせず、直前の結果のみ localStorage に保持してオフライン閲覧に使います。

---

## テスト

```bash
npm --prefix functions test
```

距離計算・スコア集計・加重スコア・営業時間判定のユニットテスト（`functions/test/util.test.js`）が走ります。
外部依存が無いため、APIキーなしで実行できます。

---

## 未実装 / ローカル仕上げ向けのTODO

- Maps JavaScript API による地図のミニビュー（現状は Google マップへのリンクのみ）
- 候補駅の「発展版」絞り込み（各メンバーの到達可能駅集合の積集合）
- 駅データ.jp などの無料路線データを取り込み、「同一路線で乗換なしに行けるか」を加点要素にする
- 有料の乗換API（駅すぱあと Web サービス、NAVITIME API 等）への差し替え。
  `summarizeCosts()` に所要時間(分)を渡す形にすれば、スコアリングの構造はそのまま使える
