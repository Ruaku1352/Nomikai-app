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
    { placeId: 'jr', name: '渋谷駅', address: '日本、東京都渋谷区渋谷２丁目' },
    { placeId: 'metro', name: '渋谷駅', address: '日本、東京都渋谷区道玄坂１丁目' },
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

/* ------------------------------------------------- 公平さの複合スコア */

const { stddev, fairnessScore, FAIRNESS_K } = require('../lib/util');

test('stddev: 全員が同じ距離ならばらつきは0', () => {
  assert.equal(stddev([2000, 2000, 2000]), 0);
});

test('stddev: 既知の値と一致する（母標準偏差）', () => {
  // [1000, 3000] → 平均2000、偏差±1000
  assert.equal(stddev([1000, 3000]), 1000);
  // [2, 4, 4, 4, 5, 5, 7, 9] は母標準偏差2の教科書例
  assert.equal(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
});

test('stddev: 空配列でも落ちない', () => {
  assert.equal(stddev([]), 0);
});

test('fairnessScore: 平均が同じなら偏りが大きい方が不利', () => {
  const even = fairnessScore([2000, 2000]);
  const skewed = fairnessScore([1000, 3000]);
  assert.equal(even, 2000);
  assert.equal(skewed, 3000);
  assert.ok(even < skewed);
});

test('fairnessScore: 全員が等しく遠い駅が最良にならない', () => {
  // ばらつきだけで並べると 全員30km（stddev 0）が満点になってしまう。
  // 複合スコアなら 1km/3km の駅の方が上位に来ること。
  const farButEven = fairnessScore([30000, 30000]);
  const nearButSkewed = fairnessScore([1000, 3000]);
  assert.ok(nearButSkewed < farButEven);
});

test('fairnessScore: k を大きくするほど公平さを重視する', () => {
  const skewed = [1000, 3000];
  assert.ok(fairnessScore(skewed, 2) > fairnessScore(skewed, 1));
  // 偏りが無ければ k を変えてもスコアは動かない
  assert.equal(fairnessScore([2000, 2000], 5), fairnessScore([2000, 2000], 1));
});

test('fairnessScore: 既定の k は 1.0', () => {
  assert.equal(FAIRNESS_K, 1.0);
  assert.equal(fairnessScore([1000, 3000]), fairnessScore([1000, 3000], 1.0));
});

test('fairnessScore: 1人なら平均そのもの', () => {
  assert.equal(fairnessScore([2500]), 2500);
});

/* --------------------------------------------------------- 平均予算 */

const { formatPriceLevel, formatPriceRange } = require('../lib/util');

test('formatPriceLevel: Googleマップと同じ記号に変換する', () => {
  assert.equal(formatPriceLevel('PRICE_LEVEL_INEXPENSIVE'), '¥');
  assert.equal(formatPriceLevel('PRICE_LEVEL_MODERATE'), '¥¥');
  assert.equal(formatPriceLevel('PRICE_LEVEL_EXPENSIVE'), '¥¥¥');
  assert.equal(formatPriceLevel('PRICE_LEVEL_VERY_EXPENSIVE'), '¥¥¥¥');
  assert.equal(formatPriceLevel('PRICE_LEVEL_FREE'), '無料');
});

test('formatPriceLevel: 不明な値・未指定は null（行を出さない）', () => {
  assert.equal(formatPriceLevel(undefined), null);
  assert.equal(formatPriceLevel('PRICE_LEVEL_UNSPECIFIED'), null);
});

test('formatPriceRange: 上下限が揃っていれば範囲で返す', () => {
  assert.equal(
    formatPriceRange({
      startPrice: { currencyCode: 'JPY', units: '3000' },
      endPrice: { currencyCode: 'JPY', units: '4000' },
    }),
    '3,000〜4,000円',
  );
});

test('formatPriceRange: 片側だけでも表示する', () => {
  assert.equal(
    formatPriceRange({ startPrice: { currencyCode: 'JPY', units: '5000' } }),
    '5,000円〜',
  );
  assert.equal(
    formatPriceRange({ endPrice: { currencyCode: 'JPY', units: '2000' } }),
    '〜2,000円',
  );
});

test('formatPriceRange: JPY以外は通貨コードを尊重する', () => {
  assert.equal(
    formatPriceRange({
      startPrice: { currencyCode: 'USD', units: '20' },
      endPrice: { currencyCode: 'USD', units: '30' },
    }),
    '20 USD〜30 USD',
  );
});

test('formatPriceRange: 情報が無ければ null（行を出さない）', () => {
  assert.equal(formatPriceRange(undefined), null);
  assert.equal(formatPriceRange({}), null);
  assert.equal(formatPriceRange({ startPrice: { units: 'abc' } }), null);
});

/* ------------------------------- 同名の別駅・事業者名（報告された不具合） */

const { stripRailwayPrefix } = require('../lib/util');

test('rankByNameMatch: 同名でも離れていれば別の駅として両方残す', () => {
  // 桜井駅は奈良県桜井市（JR・近鉄）と大阪府箕面市（阪急）に別々に存在する。
  // 名前だけで重複排除すると、阪急の桜井駅が候補から消えてしまっていた。
  const suggestions = [
    {
      placeId: 'nara',
      name: '桜井駅',
      address: '奈良県桜井市',
      location: { lat: 34.5163, lng: 135.8433 },
    },
    {
      placeId: 'hankyu',
      name: '桜井駅',
      address: '大阪府箕面市桜井',
      location: { lat: 34.8206, lng: 135.4739 },
    },
  ];
  const ranked = rankByNameMatch(suggestions, '桜井', 5);
  assert.equal(ranked.length, 2);
  assert.deepEqual(
    ranked.map((s) => s.placeId),
    ['nara', 'hankyu'],
  );
});

test('rankByNameMatch: 同じ駅の別事業者は1件にまとめる（近接）', () => {
  // JRと東京メトロの渋谷駅は別 placeId だが同じ駅
  const suggestions = [
    {
      placeId: 'jr',
      name: '渋谷駅',
      address: '東京都渋谷区',
      location: { lat: 35.658, lng: 139.7016 },
    },
    {
      placeId: 'metro',
      name: '渋谷駅',
      address: '東京都渋谷区',
      location: { lat: 35.6592, lng: 139.7005 },
    },
  ];
  assert.equal(rankByNameMatch(suggestions, '渋谷', 5).length, 1);
});

test('rankByNameMatch: 位置が無い候補は住所で別駅を判定する', () => {
  // Autocomplete 経由の候補には緯度経度が無い
  const suggestions = [
    { placeId: 'a', name: '桜井駅', address: '奈良県桜井市' },
    { placeId: 'b', name: '桜井駅', address: '大阪府箕面市' },
    { placeId: 'c', name: '桜井駅', address: '奈良県桜井市' },
  ];
  const ranked = rankByNameMatch(suggestions, '桜井', 5);
  assert.equal(ranked.length, 2, '住所が同じ a と c だけがまとまる');
  assert.deepEqual(
    ranked.map((s) => s.placeId),
    ['a', 'b'],
  );
});

test('stripRailwayPrefix: 先頭の事業者名だけを外す', () => {
  assert.equal(stripRailwayPrefix('阪急桜井'), '桜井');
  assert.equal(stripRailwayPrefix('jr難波'), '難波');
  assert.equal(stripRailwayPrefix('近鉄奈良'), '奈良');
  // 駅名そのものが事業者名で始まるだけの場合は壊さない
  assert.equal(stripRailwayPrefix('桜井'), '桜井');
  // 事業者名だけの入力は空にしない
  assert.equal(stripRailwayPrefix('阪急'), '阪急');
});

test('scoreStationNameMatch: 事業者名付きで入力しても駅名に一致する', () => {
  assert.equal(scoreStationNameMatch('桜井駅', '阪急桜井'), 3);
  assert.equal(scoreStationNameMatch('桜井駅', '阪急桜井駅'), 3);
  assert.equal(scoreStationNameMatch('難波駅', 'JR難波'), 3);
  // 駅名側に事業者名が付いているケース
  assert.equal(scoreStationNameMatch('阪急梅田駅', '梅田'), 3);
});

test('scoreStationNameMatch: 事業者名対応で無関係な駅を拾わない', () => {
  assert.equal(scoreStationNameMatch('新大阪駅', '阪急桜井'), 0);
});

const { addressArea } = require('../lib/util');

test('addressArea: 市区町村までに丸める', () => {
  assert.equal(addressArea('日本、東京都渋谷区道玄坂１丁目'), '東京都渋谷区');
  assert.equal(addressArea('〒150-0002 東京都渋谷区渋谷２丁目２４'), '東京都渋谷区');
  assert.equal(addressArea('奈良県桜井市大字桜井'), '奈良県桜井市');
  assert.equal(addressArea('大阪府箕面市桜井'), '大阪府箕面市');
  assert.equal(addressArea('神奈川県横浜市西区'), '神奈川県横浜市');
});

test('addressArea: 同じ駅は同じ値、別の市なら違う値になる', () => {
  assert.equal(
    addressArea('日本、東京都渋谷区渋谷２丁目'),
    addressArea('日本、東京都渋谷区道玄坂１丁目'),
  );
  assert.notEqual(addressArea('奈良県桜井市'), addressArea('大阪府箕面市桜井'));
});

/* --------------------------------------------- 地名を併記した入力 */

const { splitQuery, scoreAddressHint } = require('../lib/util');

test('splitQuery: 全角・半角の空白で区切る', () => {
  assert.deepEqual(splitQuery('桜井 箕面'), ['桜井', '箕面']);
  assert.deepEqual(splitQuery('桜井　箕面'), ['桜井', '箕面']);
  assert.deepEqual(splitQuery('  桜井  '), ['桜井']);
  assert.deepEqual(splitQuery(''), []);
});

test('scoreStationNameMatch: 地名を併記しても駅名に一致する', () => {
  // 連結して比較していた頃は 0 になり、候補が全滅していた
  assert.equal(scoreStationNameMatch('桜井駅', '桜井 箕面'), 3);
  assert.equal(scoreStationNameMatch('渋谷駅', '渋谷 東京'), 3);
});

test('scoreAddressHint: 駅名に使われなかった語が住所にあれば加点', () => {
  assert.equal(scoreAddressHint('大阪府箕面市桜井', '桜井 箕面', '桜井駅'), 1);
  assert.equal(scoreAddressHint('奈良県桜井市', '桜井 箕面', '桜井駅'), 0);
  // 駅名に一致した語は住所側の手がかりに数えない
  assert.equal(scoreAddressHint('奈良県桜井市', '桜井', '桜井駅'), 0);
});

test('rankByNameMatch: 地名を併記すると目的の駅が先頭に来る', () => {
  const suggestions = [
    {
      placeId: 'nara',
      name: '桜井駅',
      address: '奈良県桜井市大字桜井',
      location: { lat: 34.5163, lng: 135.8433 },
    },
    {
      placeId: 'hankyu',
      name: '桜井駅',
      address: '大阪府箕面市桜井１丁目',
      location: { lat: 34.8206, lng: 135.4739 },
    },
  ];
  assert.equal(rankByNameMatch(suggestions, '桜井 箕面', 5)[0].placeId, 'hankyu');
  // 地名を付けなければGoogleの順序のまま
  assert.equal(rankByNameMatch(suggestions, '桜井', 5)[0].placeId, 'nara');
});
