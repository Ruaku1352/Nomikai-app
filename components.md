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
Google Maps Platform（Places API (New) / Routes API）
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
| `src/screens/GenresScreen.tsx` | ジャンル選択（居酒屋 / 焼肉 / しゃぶしゃぶ / 寿司 + 自由入力）、集合時間帯（任意）、指標の初期選択、検索実行 |
| `src/screens/ResultScreen.tsx` | 上位3駅の表示、指標の切替、アコーディオンの開閉と店舗の遅延取得 |

### コンポーネント

| ファイル | 役割 |
|---|---|
| `src/components/StationInput.tsx` | 駅名オートコンプリート。**250msデバウンス**・2文字未満は送信しない・入力中断時は `AbortController` でキャンセル。候補選択時に Place Details で緯度経度を解決する |
| `src/components/StationCard.tsx` | 駅カード（アコーディオン）。合計/最長の所要時間サマリ、メンバー別の所要時間・乗換回数、地図リンク、ジャンル別の店舗リスト |
| `src/components/VenueCard.tsx` | 店カード。写真、店名、星評価、レビュー件数、価格帯、駅からの徒歩分、営業中バッジ、営業時間。タップでGoogleマップへ遷移 |

### ロジック / 状態

| ファイル | 役割 |
|---|---|
| `src/store/useAppStore.ts` | Zustand + persist。入力状態と**直前の検索結果**を localStorage に保存（オフライン閲覧用）。`search()` と `ensureVenues()` を持つ |
| `src/lib/api.ts` | `/api/**` へのクライアント。エラーレスポンスを日本語メッセージに変換する `ApiError` |
| `src/lib/scoring.ts` | `rankStations()`（指標別の並べ替え）、`weightedScore()`、`centroid()`、`formatMinutes()` |
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

### エンドポイント

| メソッド | パス | 使用API | 内容 |
|---|---|---|---|
| GET | `/api/stations/autocomplete?q=` | Places Autocomplete | `train_station` / `subway_station` に限定、`languageCode=ja` |
| GET | `/api/stations/:placeId` | Place Details | 駅の緯度経度・住所を解決 |
| POST | `/api/candidates` | Nearby Search + Routes | 候補駅のリストアップと所要時間マトリクス |
| POST | `/api/venues` | Text Search | ジャンル別に店舗を検索し、加重スコア順の上位3件を返す |
| GET | `/api/photo?name=` | Place Photo | 署名付きURLへ302リダイレクト（キーを露出させない） |

ルータは `/api` と `/` の両方にマウントしてあり、Hosting rewrite 経由でもエミュレータ直叩きでも動作します。

### ファイル

| ファイル | 役割 |
|---|---|
| `functions/src/index.ts` | Express ルーティング、入力バリデーション、候補駅の絞り込み、スコア集計、エラーハンドリング |
| `functions/src/google.ts` | Google Maps Platform のラッパー。APIキーの取得と、上流エラーの秘匿（キー情報を含みうる本文はクライアントに返さない） |
| `functions/src/util.ts` | `haversineMeters()`、`weightedScore()`、`isOpenAt()`（営業時間判定） |

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

### 所要時間マトリクス（仕様 4.2）

- **ComputeRouteMatrix** を使い、「人数 × 候補駅」を **1コール**で取得
- 失敗時のみ ComputeRoutes を1組ずつ叩くフォールバック（同時実行5本に制限）
- 乗換回数はフォールバック時のみ取得できる（マトリクスは返さない）
- 自分の最寄駅が候補になった場合（300m以内）は経路が返らなくても0分として扱う
- 誰か1人でも到達できない駅は候補から除外する

### スコアリング（仕様 4.3）

```
score_sum(駅) = Σ(各メンバーの所要時間)
score_max(駅) = max(各メンバーの所要時間)
```

- UI上で「合計最小 / 最長最小」を切替
- 同点時は**乗換回数の合計が少ない方**を優先。それも同じならもう一方の指標で比較

### 店舗検索・ソート（仕様 4.4）

- Text Search でクエリ `{ジャンル} {駅名}`、駅から半径 **800m** にバイアス
- `weighted_score = rating * log(user_ratings_total + 1)` で降順ソートし上位3件
- 集合時間を指定した場合は `regularOpeningHours.periods` で営業時間フィルタ
  （**深夜の日跨ぎ営業に対応**。営業時間が不明な店は除外せず残す）
- 徒歩分は駅からの直線距離 ÷ 80m/分

---

## セキュリティ / コスト面の実装

- **APIキーはクライアントに一切渡らない。** ローカルは `functions/.env`、本番は Secret Manager
- 上流APIのエラー本文はそのまま返さず、汎用の日本語メッセージに置き換える
- 写真プロキシは `places/{id}/photos/{id}` 形式のみ受け付ける（パス注入の防止）
- 関数は `maxInstances: 10` / `timeoutSeconds: 60` で暴走を抑制
- 候補駅の上限 `MAX_CANDIDATES`、店の検索半径 `VENUE_RADIUS_METERS` は `functions/src/index.ts` の定数で調整可能
- ジャンルは最大5件までに制限（Text Searchのコール数抑制）
- Places の結果はサーバ側で永続キャッシュしない

---

## 検証状況

| 対象 | 状態 |
|---|---|
| フロントエンド / functions のビルド | 通過 |
| 全エンドポイントの疎通・レスポンス整形・エラー処理 | Google APIをモックして確認 |
| スコアリング、営業時間判定（日跨ぎ）、距離計算 | 単体で確認 |
| **実APIキーを使った動作** | **未検証** |

実APIでの検証はローカル環境で行う前提です。特に以下は実際に叩いてみないと確定しません。

- ComputeRouteMatrix が TRANSIT で期待通り動くか（動かない場合は自動でフォールバックするが、コール数が増えるため `MAX_CANDIDATES` の再調整が必要）
- 重心半径 `spread * 0.6` と重複判定 400m の妥当性（いずれも実データ未検証の暫定値）
- Autocomplete が日本の駅名で妥当な候補を返すか
- Text Search のクエリ形式と半径800mの妥当性

---

## 未実装

- Maps JavaScript API による地図のミニビュー（現状はGoogleマップへのリンクのみ）
- 候補駅の発展版絞り込み（到達可能駅集合の積集合）
- ユニットテスト（`functions/src/util.ts` はテストしやすい純関数として切り出し済み）
