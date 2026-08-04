# 機能・コンポーネント一覧

現時点（`claude/new-session-wstmko`）で実装されている機能を、ファイル単位でまとめたものです。
要件定義は `docs/spec.md`、セットアップ手順は `README.md` を参照してください。

---

## 全体構成

```
ブラウザ（PWA）
  │  fetch /api/**            ← APIキーは持たない
  ▼
Cloud Functions（api / asia-northeast1）
  │  X-Goog-Api-Key            ← キーはここだけが持つ
  ▼
Google Maps Platform（Places API (New)）
```

Firebase Hosting の rewrite で `/api/**` → `api` 関数に転送されます（`firebase.json`）。
ローカルでは Vite dev server の proxy が Functions エミュレータへ転送します（`vite.config.ts`）。

---

## フロントエンド

### 画面

| ファイル | 役割 |
|---|---|
| `src/App.tsx` | 3ステップのタブナビゲーション、ローディングオーバーレイ、エラー表示、オンライン/オフライン検知 |
| `src/screens/MembersScreen.tsx` | 人数指定（2〜10人）と各メンバーの最寄駅入力。2人以上の駅が確定するまで次へ進めない |
| `src/screens/GenresScreen.tsx` | ジャンル選択（居酒屋 / 焼肉 / しゃぶしゃぶ / 寿司 + 自由入力）、集合時間帯（任意・お店の営業時間フィルタ用）、指標の初期選択、検索実行 |
| `src/screens/ResultScreen.tsx` | 上位3駅の表示、指標の切替、アコーディオンの開閉と店舗の遅延取得 |

### コンポーネント

| ファイル | 役割 |
|---|---|
| `src/components/StationInput.tsx` | 駅名オートコンプリート。**1文字目から部分一致で最大5件**表示、一致部分をハイライト、↑↓/Enter/Escでキーボード操作。**250msデバウンス**・入力中断時は `AbortController` でキャンセル。**IME変換中は検索せず、変換確定のEnterを候補選択と取り違えない**。候補選択時に Place Details で緯度経度を解決する |
| `src/components/StationCard.tsx` | 駅カード（アコーディオン）。平均/最長の距離サマリ、メンバー別の距離、地図リンク、ジャンル別の店舗リスト |
| `src/components/VenueCard.tsx` | 店カード。写真、店名、星評価、レビュー件数、価格帯、駅からの徒歩分、営業中バッジ、営業時間。タップでGoogleマップへ遷移 |

### ロジック / 状態

| ファイル | 役割 |
|---|---|
| `src/store/useAppStore.ts` | Zustand + persist。入力状態と**直前の検索結果**を localStorage に保存（オフライン閲覧用）。`search()` と `ensureVenues()` を持つ |
| `src/lib/api.ts` | `/api/**` へのクライアント。エラーレスポンスを日本語メッセージに変換する `ApiError` |
| `src/lib/scoring.ts` | `rankStations()`（指標別の並べ替え）、`weightedScore()`、`centroid()`、`formatDistance()` |
| `src/types/index.ts` | フロント・バックエンド共通のデータ形状 |

**状態の持ち方のポイント**：`search()` は上位3駅だけでなく**全候補駅**を `result.stations` に保持します。
そのため結果画面で指標を切り替えても再検索は発生せず、並び替わって新たに上位へ来た駅の店舗だけを
`ensureVenues()` が遅延取得します（APIコールの節約）。

### PWA

- `vite-plugin-pwa` の `generateSW` モードで Service Worker とマニフェストを自動生成（`vite.config.ts`）
- **`/api/**` と `maps.googleapis.com` はキャッシュしない**（Places APIのキャッシュ期間制限に抵触しないため）
- オフライン時の閲覧は Service Worker ではなく、localStorage に保存した直前の結果で担保する
- アイコン: `public/icons/icon-192.png`, `icon-512.png`（maskable兼用）、`public/favicon.svg`

---

## バックエンド（`functions/`）

### 駅の検索（多段フォールバック）

候補が取れた時点で打ち切ります。通常は1〜2コールで終わり、後段は0件のときだけ動きます。

| 順 | 経路 | 内容 |
|---|---|---|
| 1 | Autocomplete（駅タイプ指定） | 通常はここで完結 |
| 2 | Autocomplete（言い換え） | 件数が足りないときだけ。「渋谷」↔「渋谷駅」 |
| 3 | Autocomplete（タイプ指定なし） | 0件のとき。駅らしい名前だけ残す |
| 4 | **Text Search** | 最終手段。実在の場所を返すので取りこぼしにくく、**緯度経度も返る**ので選択時の Place Details を省ける。単価が高いのでここまで来たときだけ |

`?debug=1` を付けると `trace.stages` にどの段階が何件返したかが入るので、
0件になったときの切り分けができます。

### 駅名一致・全国カバレッジ

**駅名への一致を優先する。** Places Autocomplete は住所も部分一致の対象にするため、
素で使うと「渋谷」に対して代官山駅・代々木公園駅（どちらも渋谷区）が返ってきます。
そこで `rankByNameMatch()` で駅名側の一致度を採点し、住所だけが一致した候補は捨てます。

| スコア | 条件 | 例（入力「渋谷」） |
|---|---|---|
| 3 | 完全一致 | 渋谷駅 |
| 2 | 前方一致 | 渋谷ヒカリエ駅 |
| 1 | 部分一致 | 新渋谷駅 |
| 0 | 駅名に含まれない → **捨てる** | 代官山駅、代々木公園駅 |

- 比較前に NFKC 正規化・カタカナ→ひらがな・末尾の「駅」除去を行うので、
  「シブヤ」「渋谷駅」「ｼﾌﾞﾔ」はすべて同じ扱いになります
- **1件も駅名一致がない場合はGoogleの順序をそのまま使います**。かな・ローマ字入力で
  Googleが読みから拾ったケースを捨ててしまわないための保険です
- 同名の駅（JRと地下鉄で別 placeId）は1件にまとめます
- Autocomplete は1回で最大5件しか返さないため、駅名一致だけで5件に満たないときに限り
  言い換えたクエリで引き直して補充します（コールは1入力あたり最大2回）
  - 「渋谷」→「渋谷駅」で補充（住所一致を弾いたぶんを埋める）
  - 「渋谷駅」→「渋谷」で補充（「駅」付きだとGoogle側の候補が減ることがある）

取りこぼしを防ぐため、primary type の絞り込みは次のようにしています。

- `train_station` / `subway_station` / `light_rail_station` / `transit_station` の4種で検索
  （`light_rail_station` は路面電車・モノレール・新交通、`transit_station` は事業者によって
  primary type がこちらになる駅を拾うため）
- それでも0件だった場合は**タイプ指定なしで再検索**し、名前に「駅 / 停留場 / 停留所 / Station」を
  含むものだけを残す
- Google側の仕様変更で型が拒否された（`INVALID_ARGUMENT`）場合も、同じ再検索に落ちるため
  検索機能ごと止まることはない

いずれも `includedRegionCodes: ['jp']` で日本国内に限定しています。

### エンドポイント

| メソッド | パス | 使用API | 内容 |
|---|---|---|---|
| GET | `/api/stations/autocomplete?q=&limit=` | Places Autocomplete | 駅タイプ4種に限定して部分一致検索し、駅名一致順に既定5件返す。件数が足りなければ「〇〇駅」で補充、0件または型が拒否された場合はタイプ指定なしで再検索 |
| GET | `/api/stations/:placeId` | Place Details | 駅の緯度経度・住所を解決 |
| POST | `/api/candidates` | Nearby Search | 候補駅のリストアップと、各メンバーからの直線距離の算出 |
| POST | `/api/venues` | Text Search | ジャンル別に店舗を検索し、加重スコア順の上位3件を返す |
| GET | `/api/photo?name=` | Place Photo | 署名付きURLへ302リダイレクト（キーを露出させない） |
| GET | `/api/diag` | Places Autocomplete | 設定の切り分け用。キーの有無とPlaces APIへの疎通を1コールで確認 |

ルータは `/api` と `/` の両方にマウントしてあり、Hosting rewrite 経由でもエミュレータ直叩きでも動作します。

### ファイル

| ファイル | 役割 |
|---|---|
| `functions/src/index.ts` | Express ルーティング、入力バリデーション、候補駅の絞り込み、距離とスコアの集計、エラーハンドリング |
| `functions/src/google.ts` | Places API (New) のラッパー。APIキーの取得と、上流エラーの秘匿（キー情報を含みうる本文はクライアントに返さない） |
| `functions/src/util.ts` | `haversineMeters()`、`summarizeCosts()`、`weightedScore()`、`isOpenAt()`（営業時間判定）、`rankByNameMatch()`（駅名一致の採点） |
| `functions/test/util.test.js` | 上記の純粋関数のユニットテスト（node:test、33件） |

---

## アルゴリズムの実装状況

### 候補駅のリストアップ（仕様 4.1・シンプル版）

1. 全メンバーの駅の**重心**を計算
2. 重心から一番遠いメンバーまでの距離 `spread` をもとに検索半径を決定
   （`min(50km, max(2km, spread * 0.6))`）
3. Nearby Search（`rankPreference: POPULARITY`）で駅を取得
4. **400m以内の駅は1つに間引く**（同一駅の別出口などを除外）
5. 最大 **15駅**（既定12駅）に制限

> 発展版（各メンバーの到達可能駅集合の積集合）は未実装です。

### 距離の算出（仕様 4.2）

- 各メンバー駅 × 候補駅の**ハバサイン距離（大圏距離）**をサーバ内で計算。**外部APIは使わない**
- メンバーが何人増えてもAPIコール数は変わらない
- 集計は `summarizeCosts()`（合計 / 最大 / 平均）に切り出してあり、**単位に依存しない**。
  将来 乗換API を導入したら距離(m)の代わりに所要時間(分)を渡すだけで同じ構造が使える

> **電車の所要時間を使わない理由**
> Routes API の `travelMode: TRANSIT` は日本国内の公共交通をサポートしておらず、
> HTTP 200 のまま `routes` が空で返ります（DRIVEに変えると正常に返るため、キーや課金の問題ではない）。
> 切り分けの詳細は `docs/spec.md` の 2.2 を参照してください。**再調査は不要です。**

### スコアリング（仕様 4.3）

```
score_sum(駅) = Σ(各メンバーの距離)
score_max(駅) = max(各メンバーの距離)
```

- UI上で「合計最小 / 最長最小」を切替（指標の中身が距離になっただけで、UIの構造は変更なし）
- 同点時は**全員の重心に近い駅**を優先。それも同じならもう一方の指標で比較

### 店舗検索・ソート（仕様 4.4）

- Text Search でクエリ `{ジャンル} {駅名}`、駅から半径 **800m** にバイアス
- `weighted_score = rating * log(user_ratings_total + 1)` で降順ソートし上位3件
- 集合時間を指定した場合は `regularOpeningHours.periods` で営業時間フィルタ
  （**深夜の日跨ぎ営業に対応**。営業時間が不明な店は除外せず残す）
- 徒歩分は駅からの直線距離 ÷ 80m/分

---

## セキュリティ / コスト面の実装

- **APIキーはクライアントに一切渡らない。** ローカルは `functions/.env`、本番は Secret Manager
- 上流APIのエラーは原因別の日本語メッセージに変換し、Googleのエラーコードだけを `details` として返す
  （キーは含まれない。有効化漏れ / キー制限 / 課金 / リクエスト不正 を区別できる）
- 写真プロキシは `places/{id}/photos/{id}` 形式のみ受け付ける（パス注入の防止）
- 関数は `maxInstances: 10` / `timeoutSeconds: 60` で暴走を抑制
- 距離計算はサーバ内で完結するため、この部分の課金は発生しない
- 候補駅の上限 `MAX_CANDIDATES`、店の検索半径 `VENUE_RADIUS_METERS` は `functions/src/index.ts` の定数で調整可能
- ジャンルは最大5件までに制限（Text Searchのコール数抑制）
- Autocomplete は1入力あたり最大2コール（駅名一致が5件に満たないときだけ補充）
- Places の結果はサーバ側で永続キャッシュしない

---

## 検証状況

| 対象 | 状態 |
|---|---|
| フロントエンド / functions のビルド | 通過 |
| 距離計算・スコア集計・加重スコア・営業時間判定・駅名マッチング | ユニットテスト33件が通過（`npm --prefix functions test`） |
| 全エンドポイントの疎通・レスポンス整形・エラー処理 | Places APIをモックして確認。Routes API が呼ばれないことも確認済み |
| **実APIキーを使った動作** | **未検証** |

実APIでの検証はローカル環境で行う前提です。特に以下は実際に叩いてみないと確定しません。

- 重心半径 `spread * 0.6` と重複判定 400m の妥当性（いずれも実データ未検証の暫定値）
- 駅名一致のフィルタで候補が減りすぎないか（補充クエリで5件まで埋まるか）
- Nearby Search の `rankPreference: POPULARITY` が主要ターミナル駅を上位に返すか
- Text Search のクエリ形式と半径800mの妥当性

---

## テスト

```bash
npm --prefix functions test   # ビルド後に node:test を実行（APIキー不要）
```

`functions/test/util.test.js` に33件。距離計算（対称性・経度180度跨ぎを含む）、
スコア集計、加重スコア、営業時間判定（深夜の日跨ぎ・週の折り返し）、
駅名マッチング（住所だけ一致した駅の除外、かな入力、同名駅の統合）をカバーしています。

---

## 未実装 / 将来の拡張余地

- Maps JavaScript API による地図のミニビュー（現状はGoogleマップへのリンクのみ）
- 候補駅の発展版絞り込み（到達可能駅集合の積集合）
- 駅データ.jp などの無料路線データを取り込み、「同一路線で乗換なしに行けるか」を加点要素にする
- 有料の乗換API（駅すぱあと Web サービス、NAVITIME API 等）への差し替え。
  `summarizeCosts()` に所要時間(分)を渡す形にすれば、スコアリングの構造はそのまま使える
