// node:test で実行する。ビルド済みの lib/ を対象にするため、事前に `npm run build` が必要。
//   npm --prefix functions test
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  haversineMeters,
  summarizeCosts,
  weightedScore,
  isOpenAt,
} = require('../lib/util');

/* ------------------------------------------------------------ 距離計算 */

test('haversineMeters: 同一地点は0m', () => {
  const p = { lat: 35.658, lng: 139.7016 };
  assert.equal(haversineMeters(p, p), 0);
});

test('haversineMeters: 渋谷駅↔新宿駅はおよそ3.5km', () => {
  const shibuya = { lat: 35.658, lng: 139.7016 };
  const shinjuku = { lat: 35.6896, lng: 139.7006 };
  const d = haversineMeters(shibuya, shinjuku);
  assert.ok(d > 3400 && d < 3600, `expected ~3.5km but got ${d}`);
});

test('haversineMeters: 東京↔大阪はおよそ400km', () => {
  const tokyo = { lat: 35.6812, lng: 139.7671 };
  const osaka = { lat: 34.7025, lng: 135.4959 };
  const d = haversineMeters(tokyo, osaka);
  assert.ok(d > 390_000 && d < 410_000, `expected ~400km but got ${d}`);
});

test('haversineMeters: 対称である', () => {
  const a = { lat: 35.6812, lng: 139.7671 };
  const b = { lat: 34.7025, lng: 135.4959 };
  assert.equal(haversineMeters(a, b), haversineMeters(b, a));
});

test('haversineMeters: 緯度1度はおよそ111km', () => {
  const d = haversineMeters({ lat: 35, lng: 139 }, { lat: 36, lng: 139 });
  assert.ok(d > 110_000 && d < 112_000, `expected ~111km but got ${d}`);
});

test('haversineMeters: 経度180度をまたいでも最短距離を返す', () => {
  const d = haversineMeters({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
  // 0.2度 ≒ 22km。地球を逆回りした 約4万km にはならないこと
  assert.ok(d < 30_000, `expected short way around but got ${d}`);
});

/* --------------------------------------------------------- スコア集計 */

test('summarizeCosts: 合計・最大・平均を返す', () => {
  assert.deepEqual(summarizeCosts([1000, 2000, 3000]), {
    sum: 6000,
    max: 3000,
    avg: 2000,
  });
});

test('summarizeCosts: 空配列でも落ちない', () => {
  assert.deepEqual(summarizeCosts([]), { sum: 0, max: 0, avg: 0 });
});

test('summarizeCosts: 1人なら合計＝最大＝平均', () => {
  assert.deepEqual(summarizeCosts([1500]), {
    sum: 1500,
    max: 1500,
    avg: 1500,
  });
});

test('summarizeCosts: 単位に依存しない（分を渡しても同じ形で返る）', () => {
  // 将来 乗換API を導入して所要時間(分)を渡す場合の想定
  assert.deepEqual(summarizeCosts([10, 25, 40]), { sum: 75, max: 40, avg: 25 });
});

test('summarizeCosts: 合計は同じでも最大値で優劣がつく', () => {
  // 「合計最小」では引き分けだが「最長最小」では均等な方が勝つケース
  const balanced = summarizeCosts([3000, 3000]);
  const skewed = summarizeCosts([1000, 5000]);
  assert.equal(balanced.sum, skewed.sum);
  assert.ok(balanced.max < skewed.max);
});

/* ------------------------------------------------------- 店舗のスコア */

test('weightedScore: レビュー数が多い方が優先される', () => {
  const few = weightedScore(4.6, 5);
  const many = weightedScore(4.1, 900);
  assert.ok(many > few, 'レビュー5件の4.6より、900件の4.1を上位にする');
});

test('weightedScore: 評価なしは0', () => {
  assert.equal(weightedScore(null, 100), 0);
  assert.equal(weightedScore(undefined, 100), 0);
});

test('weightedScore: レビュー0件は0', () => {
  assert.equal(weightedScore(5, 0), 0);
  assert.equal(weightedScore(5, undefined), 0);
});

/* --------------------------------------------------------- 営業時間 */

// 月曜 17:00 〜 翌2:00 の店
const lateNight = {
  periods: [
    { open: { day: 1, hour: 17, minute: 0 }, close: { day: 2, hour: 2, minute: 0 } },
  ],
};

test('isOpenAt: 営業時間内はtrue（月曜19:30 JST）', () => {
  assert.equal(isOpenAt(lateNight, new Date('2026-08-03T10:30:00Z')), true);
});

test('isOpenAt: 開店前はfalse（月曜15:00 JST）', () => {
  assert.equal(isOpenAt(lateNight, new Date('2026-08-03T06:00:00Z')), false);
});

test('isOpenAt: 日をまたぐ深夜営業もtrue（火曜1:00 JST）', () => {
  assert.equal(isOpenAt(lateNight, new Date('2026-08-03T16:00:00Z')), true);
});

test('isOpenAt: 閉店後はfalse（火曜3:00 JST）', () => {
  assert.equal(isOpenAt(lateNight, new Date('2026-08-03T18:00:00Z')), false);
});

test('isOpenAt: 営業時間が不明な店は除外しない', () => {
  assert.equal(isOpenAt(undefined, new Date()), true);
  assert.equal(isOpenAt({}, new Date()), true);
  assert.equal(isOpenAt({ periods: [] }, new Date()), true);
});

test('isOpenAt: 24時間営業（closeなし）は常にtrue', () => {
  const always = { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] };
  assert.equal(isOpenAt(always, new Date()), true);
});

test('isOpenAt: 日曜から月曜へまたぐ営業（週の折り返し）', () => {
  const sundayLate = {
    periods: [
      { open: { day: 0, hour: 20, minute: 0 }, close: { day: 1, hour: 1, minute: 0 } },
    ],
  };
  // 2026-08-03 00:30 JST は月曜0:30 → 日曜20:00開始の区間内
  assert.equal(isOpenAt(sundayLate, new Date('2026-08-02T15:30:00Z')), true);
});

/* ------------------------------------------------------- 駅名マッチング */

const {
  normalizeForMatch,
  stripStationSuffix,
  scoreStationNameMatch,
  rankByNameMatch,
} = require('../lib/util');

test('normalizeForMatch: カタカナはひらがなに寄せる', () => {
  assert.equal(normalizeForMatch('シブヤ'), 'しぶや');
  assert.equal(normalizeForMatch('ｼﾌﾞﾔ'), 'しぶや');
});

test('normalizeForMatch: 空白・中黒・大文字小文字を吸収する', () => {
  assert.equal(normalizeForMatch('Shibuya Station'), 'shibuyastation');
  assert.equal(normalizeForMatch('サン・シャイン'), 'さんしゃいん');
});

test('stripStationSuffix: 末尾の駅を落とす', () => {
  assert.equal(stripStationSuffix('渋谷駅'), '渋谷');
  assert.equal(stripStationSuffix('原爆ドーム前停留場'), '原爆ドーム前');
  // 途中の「駅」は落とさない
  assert.equal(stripStationSuffix('駅前本町'), '駅前本町');
});

test('scoreStationNameMatch: 完全一致が最上位', () => {
  assert.equal(scoreStationNameMatch('渋谷駅', '渋谷'), 3);
  assert.equal(scoreStationNameMatch('渋谷駅', '渋谷駅'), 3);
});

test('scoreStationNameMatch: 前方一致 > 部分一致', () => {
  assert.ok(
    scoreStationNameMatch('渋谷ヒカリエ駅', '渋谷') >
      scoreStationNameMatch('新渋谷駅', 'ヶ谷'),
  );
  assert.equal(scoreStationNameMatch('西新宿五丁目駅', '西新宿'), 2);
  assert.equal(scoreStationNameMatch('東新宿駅', '新宿'), 1);
});

test('scoreStationNameMatch: 駅名に含まれなければ0（住所だけの一致）', () => {
  // 代官山駅・代々木公園駅はどちらも渋谷区だが駅名に「渋谷」を含まない
  assert.equal(scoreStationNameMatch('代官山駅', '渋谷'), 0);
  assert.equal(scoreStationNameMatch('代々木公園駅', '渋谷'), 0);
});

test('rankByNameMatch: 住所だけ一致した駅を捨てる（報告された不具合）', () => {
  const suggestions = [
    { placeId: '1', name: '代官山駅', address: '日本、東京都渋谷区' },
    { placeId: '2', name: '代々木公園駅', address: '日本、東京都渋谷区' },
    { placeId: '3', name: '渋谷駅', address: '日本、東京都渋谷区' },
    { placeId: '4', name: '神泉駅', address: '日本、東京都渋谷区' },
  ];
  const ranked = rankByNameMatch(suggestions, '渋谷', 5);
  assert.deepEqual(
    ranked.map((s) => s.name),
    ['渋谷駅'],
  );
});

test('rankByNameMatch: 完全一致を先頭にし、前方一致・部分一致が続く', () => {
  const suggestions = [
    { placeId: '1', name: '東新宿駅', address: '' },
    { placeId: '2', name: '新宿三丁目駅', address: '' },
    { placeId: '3', name: '新宿駅', address: '' },
  ];
  assert.deepEqual(
    rankByNameMatch(suggestions, '新宿', 5).map((s) => s.name),
    ['新宿駅', '新宿三丁目駅', '東新宿駅'],
  );
});

test('rankByNameMatch: 同名の駅（JRと地下鉄）は1つにまとめる', () => {
  const suggestions = [
    { placeId: 'jr', name: '渋谷駅', address: 'JR' },
    { placeId: 'metro', name: '渋谷駅', address: '東京メトロ' },
  ];
  assert.equal(rankByNameMatch(suggestions, '渋谷', 5).length, 1);
});

test('rankByNameMatch: 1件も駅名一致がなければGoogleの順序を尊重する', () => {
  // かな入力でGoogleが読みで拾ったケース。ここで捨てると候補が0件になる
  const suggestions = [
    { placeId: '1', name: '渋谷駅', address: '' },
    { placeId: '2', name: '神泉駅', address: '' },
  ];
  assert.deepEqual(
    rankByNameMatch(suggestions, 'しぶや', 5).map((s) => s.name),
    ['渋谷駅', '神泉駅'],
  );
});

test('rankByNameMatch: limit を超えない', () => {
  const suggestions = Array.from({ length: 10 }, (_, i) => ({
    placeId: `p${i}`,
    name: `新宿${i}駅`,
    address: '',
  }));
  assert.equal(rankByNameMatch(suggestions, '新宿', 5).length, 5);
});

test('rankByNameMatch: 空入力では候補を落とさない', () => {
  const suggestions = [{ placeId: '1', name: '渋谷駅', address: '' }];
  assert.equal(rankByNameMatch(suggestions, '', 5).length, 1);
});

/* --------------------------------------------------- 駅そのものかの判定 */

const { looksLikeStation } = require('../lib/google');

test('looksLikeStation: 「〇〇駅」は駅', () => {
  assert.equal(looksLikeStation('東京駅'), true);
  assert.equal(looksLikeStation('原爆ドーム前停留場'), true);
  assert.equal(looksLikeStation('Shibuya Station'), true);
});

test('looksLikeStation: 駅を含むだけの施設は駅ではない', () => {
  // Text Search は「東京 駅」で商業施設も返してくるので末尾で判定する
  assert.equal(looksLikeStation('東京駅一番街'), false);
  assert.equal(looksLikeStation('渋谷スクランブルスクエア'), false);
  assert.equal(looksLikeStation('駅前不動産'), false);
});

/* ------------------------- 無関係な駅を出さない（報告された不具合） */

const { containsKanji } = require('../lib/util');

test('containsKanji: 漢字入力とかな・ローマ字入力を区別する', () => {
  assert.equal(containsKanji('渋谷'), true);
  assert.equal(containsKanji('渋谷駅'), true);
  assert.equal(containsKanji('しぶや'), false);
  assert.equal(containsKanji('シブヤ'), false);
  assert.equal(containsKanji('shibuya'), false);
});

test('rankByNameMatch: 漢字入力で一致が無ければ無関係な駅を出さない', () => {
  // 「渋谷駅」の候補に代官山駅・代々木公園駅・雨晴駅（富山県）が出ていた不具合。
  // 以前はここでGoogleの順序をそのまま返していた。
  const suggestions = [
    { placeId: '1', name: '代官山駅', address: '東京都渋谷区' },
    { placeId: '2', name: '代々木公園駅', address: '東京都渋谷区' },
    { placeId: '3', name: '雨晴駅', address: '富山県高岡市' },
  ];
  assert.deepEqual(rankByNameMatch(suggestions, '渋谷駅', 5), []);
  assert.deepEqual(rankByNameMatch(suggestions, '渋谷', 5), []);
});

test('rankByNameMatch: かな入力なら一致が無くても候補を残す', () => {
  // 漢字の駅名とは文字列照合できないため、ここで捨てると候補が全滅する
  const suggestions = [{ placeId: '1', name: '渋谷駅', address: '' }];
  assert.equal(rankByNameMatch(suggestions, 'しぶや', 5).length, 1);
  assert.equal(rankByNameMatch(suggestions, 'shibuya', 5).length, 1);
});

test('rankByNameMatch: 漢字入力でも一致があればそれだけ返す', () => {
  const suggestions = [
    { placeId: '1', name: '代官山駅', address: '東京都渋谷区' },
    { placeId: '2', name: '渋谷駅', address: '東京都渋谷区' },
  ];
  assert.deepEqual(
    rankByNameMatch(suggestions, '渋谷駅', 5).map((s) => s.name),
    ['渋谷駅'],
  );
});
