# 飲み会集合場所決めアプリ

参加メンバーそれぞれの「直前の活動場所の最寄駅」を入力すると、電車の所要時間を考慮して
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
    └── src/google.ts    Places API (New) / Routes API のラッパー
```

**APIキーはクライアントに一切埋め込みません。** ブラウザは `/api/**` を叩き、
Cloud Functions 側だけが Google Maps Platform のキーを保持します。

### エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/stations/autocomplete?q=` | 駅名オートコンプリート（Places Autocomplete、駅タイプに限定） |
| GET | `/api/stations/:placeId` | 駅の緯度経度（Place Details） |
| POST | `/api/candidates` | 候補駅のリストアップ＋所要時間マトリクス（Nearby Search + Routes） |
| POST | `/api/venues` | 駅周辺の店をジャンル別に検索し加重スコア順に3件返す（Text Search） |
| GET | `/api/photo?name=` | 店舗写真のプロキシ（署名付きURLへ302リダイレクト） |

---

## アルゴリズム

**候補駅（4.1）**: 全員の駅の重心を出し、重心から一番遠いメンバーまでの距離をもとに検索半径を決めて
Nearby Search で駅を取得。同一駅の別出口などを避けるため 400m 以内の駅は1つにまとめ、
最大 15 駅（既定 12 駅）に絞ります。

**所要時間（4.2）**: Routes API の **ComputeRouteMatrix** を使い、「人数 × 候補駅」を **1コール**で取得します。
マトリクスが使えなかった場合のみ ComputeRoutes を1組ずつ叩くフォールバックに落ちます
（この時だけ乗換回数も取得できます）。全員が到達できない駅は候補から外れます。

**スコアリング（4.3）**:

```
score_sum(駅) = Σ(各メンバーの所要時間)
score_max(駅) = max(各メンバーの所要時間)
```

UI 上で「合計最小 / 最長最小」を切り替えられます。同点時は乗換回数の合計が少ない方を優先します。

**店舗（4.4）**: `weighted_score = rating * log(user_ratings_total + 1)` で並べ替え、
レビュー数の少ない高評価店が上位を占めないようにしています。
集合時間を指定した場合は `regularOpeningHours.periods` を使って営業時間（深夜営業の日跨ぎ対応）でフィルタします。

---

## セットアップ

### 事前準備

1. Firebase プロジェクトを作成し、**Blaze プラン**に変更（外部API呼び出しに必要）
2. Google Maps Platform で APIキーを発行し、以下を有効化
   - **Places API (New)**
   - **Routes API**
3. APIキーには HTTP リファラ制限ではなく **API 制限**（上記2つのみ）を設定してください。
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

- Places API / Routes API は**従量課金**です。Google Cloud で**予算アラート**を設定しておくことを強く推奨します。
- 1回の検索でのコール数の目安: Autocomplete（入力ごと・250msデバウンス）+ Place Details（人数分）
  + Nearby Search 1回 + ComputeRouteMatrix 1回 + Text Search（駅3 × ジャンル数）+ 写真（表示分）。
- 候補駅の上限は `functions/src/index.ts` の `MAX_CANDIDATES`、店の検索半径は `VENUE_RADIUS_METERS` で調整できます。
- 関数側は `maxInstances: 10` で暴走を抑えています。
- Places API の結果はキャッシュ期間に制限があるため、サーバ側では永続キャッシュしていません。
  Service Worker も `/api/**` はキャッシュせず、直前の結果のみ localStorage に保持してオフライン閲覧に使います。

---

## 未実装 / ローカル仕上げ向けのTODO

- Maps JavaScript API による地図のミニビュー（現状は Google マップへのリンクのみ）
- 候補駅の「発展版」絞り込み（各メンバーの到達可能駅集合の積集合）
- ComputeRouteMatrix で乗換回数が取れないため、同点時のタイブレークが効かないケースがある
- テスト（`functions/src/util.ts` のスコアリング・営業時間判定はユニットテストしやすい形にしてあります）
