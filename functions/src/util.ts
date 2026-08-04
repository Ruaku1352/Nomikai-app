import type { LatLng, OpeningHours } from './google';

const EARTH_RADIUS_M = 6_371_000;

/** 2点間の直線距離(m) */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ------------------------------------------------- 駅名のマッチング */

/**
 * 比較用の正規化。
 * 全角/半角・大文字小文字・空白・中黒を吸収し、カタカナはひらがなに寄せる。
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000・･,、.。]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 末尾の「駅」「停留場」などを落とす（「渋谷」と「渋谷駅」を同一視するため） */
export function stripStationSuffix(value: string): string {
  return value.replace(/(駅前|駅|えき|停留場|停留所|のりば|station)$/i, '');
}

/**
 * 入力に対する「駅名」の一致度。住所は見ない。
 *
 * Places Autocomplete は住所も含めて部分一致するため、「渋谷」で
 * 代官山駅・代々木公園駅（いずれも渋谷区）が返ってくる。
 * 駅名側の一致を優先するために使う。
 *
 *   3 = 完全一致（渋谷 / 渋谷駅）
 *   2 = 前方一致（渋谷ヒカリエ…）
 *   1 = 部分一致（新渋谷…）
 *   0 = 駅名に含まれない（＝住所だけが一致している）
 */
export function scoreStationNameMatch(name: string, query: string): number {
  const n = stripStationSuffix(normalizeForMatch(name));
  const q = stripStationSuffix(normalizeForMatch(query));
  if (!q || !n) return 0;
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (n.includes(q)) return 1;
  return 0;
}

/** 漢字を含む入力か（かな・ローマ字入力と区別する） */
export function containsKanji(value: string): boolean {
  return /[\u3005\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(value);
}

/**
 * 駅名の一致度で並べ替える。
 *
 * 1件でも駅名が一致していれば、住所だけ一致した候補は捨てる。
 *
 * 1件も一致しなかった場合の扱いは入力の種類で変える。
 * - **漢字を含む入力**（渋谷 / 渋谷駅）: 駅名と直接照合できるはずなので、
 *   一致が無い＝無関係な候補しか無いということ。**空を返す。**
 *   以前はGoogleの順序をそのまま返していたため、「渋谷駅」の候補に
 *   代官山駅・代々木公園駅・雨晴駅（富山県）のような無関係な駅が出ていた。
 * - **かな・ローマ字入力**（しぶや / shibuya）: 漢字の駅名とは文字列照合できず、
 *   Googleが読みで拾ってくれている。ここで捨てると候補が全滅するのでGoogleの順序を使う。
 *
 * 同名の駅（JRと地下鉄で別placeId）は1つにまとめる。
 */
export function rankByNameMatch<T extends { placeId: string; name: string }>(
  suggestions: T[],
  query: string,
  limit: number,
): T[] {
  const scored = suggestions.map((s, index) => ({
    item: s,
    score: scoreStationNameMatch(s.name, query),
    index,
  }));

  const matched = scored.filter((x) => x.score > 0);
  const pool =
    matched.length > 0 ? matched : containsKanji(query) ? [] : scored;

  // スコア降順、同スコアならGoogleが返した順（＝関連度順）を保つ
  pool.sort((a, b) => b.score - a.score || a.index - b.index);

  const seen = new Set<string>();
  const result: T[] = [];
  for (const { item } of pool) {
    const key = normalizeForMatch(item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * 候補駅1件分のコスト集計。
 *
 * 引数の `costs` は「各メンバーから候補駅までのコスト」で、単位には依存しない。
 * 現在は直線距離(m)を渡しているが、将来 乗換API（駅すぱあと / NAVITIME 等）を
 * 導入して所要時間(分)が取れるようになった場合は、ここに分を渡すだけで
 * スコアリングの構造はそのまま使える。
 */
export function summarizeCosts(costs: number[]): {
  sum: number;
  max: number;
  avg: number;
} {
  if (costs.length === 0) return { sum: 0, max: 0, avg: 0 };
  const sum = costs.reduce((a, c) => a + c, 0);
  return {
    sum,
    max: Math.max(...costs),
    avg: sum / costs.length,
  };
}

/**
 * 4.4 レビュー数を加味した評価スコア。
 * rating * log(user_ratings_total + 1) で、件数の少ない高評価店を過大評価しない。
 */
export function weightedScore(
  rating: number | undefined | null,
  count: number | undefined | null,
): number {
  if (rating == null) return 0;
  return rating * Math.log((count ?? 0) + 1);
}

/**
 * 指定時刻に営業しているか。Places の periods は日本時間（店舗のローカル時間）基準なので、
 * 目標時刻も Asia/Tokyo に変換してから比較する。
 * 営業時間の情報が無い店は「判定不能」として残す（false negative で候補を減らさない）。
 */
export function isOpenAt(
  hours: OpeningHours | undefined,
  at: Date,
  timeZone = 'Asia/Tokyo',
): boolean {
  const periods = hours?.periods;
  if (!periods || periods.length === 0) return true;

  // 24時間営業は open のみで close が無い
  if (periods.some((p) => p.open && !p.close)) return true;

  const { day, minutes } = localDayMinutes(at, timeZone);

  return periods.some((p) => {
    if (!p.open || !p.close) return false;
    const open = (p.open.day ?? 0) * 1440 + (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
    let close =
      (p.close.day ?? 0) * 1440 + (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0);
    // 深夜まで営業して日をまたぐケース（例: 17:00〜翌2:00）
    if (close <= open) close += 7 * 1440;

    const target = day * 1440 + minutes;
    return (
      (target >= open && target < close) ||
      // 週をまたいだ区間との比較用に1週間分ずらして再判定
      (target + 7 * 1440 >= open && target + 7 * 1440 < close)
    );
  });
}

/** 指定タイムゾーンでの曜日(0=日)と 0時からの経過分 */
function localDayMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = Math.max(0, weekdays.indexOf(get('weekday')));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { day, minutes: hour * 60 + minute };
}
