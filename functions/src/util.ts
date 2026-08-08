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
  const tokens = splitQuery(query);
  if (tokens.length === 0) return 0;
  return Math.max(...tokens.map((t) => scoreSingleToken(name, t)));
}

/**
 * 入力を空白で区切る。
 * 「桜井 箕面」のように地名を併記した入力に対応するため。
 * 連結して比較すると駅名とは一致しなくなり、候補が全滅してしまう。
 */
export function splitQuery(query: string): string[] {
  return query
    .split(/[\s\u3000]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function scoreSingleToken(name: string, token: string): number {
  const n = stripStationSuffix(normalizeForMatch(name));
  const q = stripStationSuffix(normalizeForMatch(token));
  if (!q || !n) return 0;

  const score = (a: string, b: string) => {
    if (!b || !a) return 0;
    if (a === b) return 3;
    if (a.startsWith(b)) return 2;
    if (a.includes(b)) return 1;
    return 0;
  };

  // 「阪急桜井」で「桜井駅」を引けるよう、事業者名を外した形でも比較して高い方を採る。
  // 駅名側にも事業者名が付くことがある（例:「阪急梅田駅」）ので両方から外す。
  return Math.max(
    score(n, q),
    score(stripRailwayPrefix(n), stripRailwayPrefix(q)),
  );
}

/**
 * 駅名に使われなかった語が住所に含まれていれば加点する。
 *
 * 「桜井 箕面」のように地名を併記された場合に、同名の駅の中から
 * 目的の駅（大阪府箕面市の桜井駅）を上位に出すために使う。
 */
export function scoreAddressHint(
  address: string | undefined,
  query: string,
  name: string,
): number {
  if (!address) return 0;
  const a = normalizeForMatch(address);
  return splitQuery(query).filter((t) => {
    // 駅名そのものに一致した語は住所側の手がかりとして数えない
    if (scoreSingleToken(name, t) > 0) return false;
    const q = normalizeForMatch(t);
    return q.length > 0 && a.includes(q);
  }).length;
}

/**
 * 鉄道事業者名の前置き。「阪急桜井」「JR桜井」のように入力されても
 * 駅名「桜井駅」と照合できるよう、比較時だけ取り除く。
 * （Googleへ送るクエリからは外さない。事業者名があった方が目的の駅を引きやすいため）
 */
const RAILWAY_PREFIXES = [
  'jr',
  'jr西日本',
  'jr東日本',
  'jr東海',
  'jr九州',
  'jr北海道',
  'jr四国',
  '阪急',
  '阪神',
  '近鉄',
  '南海',
  '京阪',
  '名鉄',
  '西鉄',
  '東急',
  '東武',
  '西武',
  '京王',
  '京成',
  '京急',
  '小田急',
  '相鉄',
  '山陽',
  '神鉄',
  '泉北',
  '都営',
  '地下鉄',
  '市営地下鉄',
  '市営',
];

/** 先頭の事業者名を1つだけ取り除く（正規化後の文字列に対して使う） */
export function stripRailwayPrefix(value: string): string {
  for (const prefix of RAILWAY_PREFIXES) {
    if (value.length > prefix.length && value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

/** 漢字を含む入力か（かな・ローマ字入力と区別する） */
export function containsKanji(value: string): boolean {
  return /[\u3005\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(value);
}

/** ここより近ければ「同じ駅の別事業者・別出口」とみなして1件にまとめる */
const SAME_STATION_METERS = 1000;

/**
 * 住所から「都道府県 + 市区町村」だけを取り出す。
 *
 * 位置が取れない候補（Autocomplete 経由）の同一判定に使う。
 * 番地まで含めて比較すると、同じ駅でも表記の差（「渋谷区」と「渋谷区道玄坂」）で
 * 別の駅と判定されてしまうため、市区町村までに丸める。
 */
export function addressArea(address: string): string {
  const a = normalizeForMatch(address);
  const m = a.match(/(東京都|北海道|京都府|大阪府|[^0-9]{2,3}県)(.*?[市区町村])/);
  return m ? `${m[1]}${m[2]}` : a;
}

/**
 * 2件が同じ駅を指しているか。
 *
 * 名前だけで判定すると、**全国にある同名の別駅**まで潰してしまう。
 * 例：桜井駅は奈良県桜井市（JR・近鉄）と大阪府箕面市（阪急）に別々に存在する。
 * そこで名前が同じでも、位置が離れていれば別の駅として両方残す。
 */
function isSameStation(
  a: { name: string; address?: string; location?: LatLng },
  b: { name: string; address?: string; location?: LatLng },
): boolean {
  if (normalizeForMatch(a.name) !== normalizeForMatch(b.name)) return false;
  if (a.location && b.location) {
    return haversineMeters(a.location, b.location) < SAME_STATION_METERS;
  }
  // 位置が無い候補（Autocomplete 経由）は住所で判断する。
  // 都道府県・市区町村が違えば別の駅とみなす。
  return addressArea(a.address ?? '') === addressArea(b.address ?? '');
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
 * 同じ駅の別事業者・別出口は1件にまとめるが、**同名でも離れていれば別の駅として残す**
 * （isSameStation を参照）。
 */
export function rankByNameMatch<
  T extends {
    placeId: string;
    name: string;
    address?: string;
    location?: LatLng;
  },
>(suggestions: T[], query: string, limit: number): T[] {
  const scored = suggestions.map((s, index) => ({
    item: s,
    score: scoreStationNameMatch(s.name, query),
    // 「桜井 箕面」のような地名併記で、目的の駅を同名の駅より上に出すための加点
    areaHint: scoreAddressHint(s.address, query, s.name),
    index,
  }));

  const matched = scored.filter((x) => x.score > 0);
  const pool =
    matched.length > 0 ? matched : containsKanji(query) ? [] : scored;

  // 駅名の一致度 → 住所の手がかり → Googleが返した順（＝関連度順）
  pool.sort(
    (a, b) => b.score - a.score || b.areaHint - a.areaHint || a.index - b.index,
  );

  const result: T[] = [];
  for (const { item } of pool) {
    if (result.some((kept) => isSameStation(kept, item))) continue;
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * 「みんな公平に」の並び順に使う複合スコア。
 *
 *   score = mean + FAIRNESS_K * stddev
 *
 * ばらつき（標準偏差）だけで並べると、**全員が等しく遠い駅**が最良になってしまう。
 * 例えば全員から30km離れた駅は標準偏差ゼロで満点になるが、集合場所としては最悪。
 * そのため「近さ（mean）」と「公平さ（stddev）」を足し合わせた複合スコアにしている。
 *
 * k = 1.0 の根拠:
 *   mean も stddev も同じ単位（m）なので、k は「ばらつき1mを距離何m分の
 *   ペナルティとみなすか」を表す。k=1.0 だと、
 *   - 全員2km（mean 2000 / stddev 0）  → 2000
 *   - 1kmと3km（mean 2000 / stddev 1000）→ 3000
 *   となり、平均が同じなら偏っている方が明確に不利になる。
 *   一方、全員10kmの駅（10000）が、1kmと3kmの駅（3000）に勝つことはない。
 *   k を大きくすると公平さ重視、小さくすると近さ重視に寄る。
 */
export const FAIRNESS_K = 1.0;

/** 母標準偏差（サンプルではなく母集団。メンバー全員が対象なので n で割る） */
export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance =
    values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 上記の複合スコア。値が小さいほど「みんなにとって公平で近い」 */
export function fairnessScore(values: number[], k = FAIRNESS_K): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  return mean + k * stddev(values);
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

/* --------------------------------------------------------- 平均予算 */

/** Places の priceLevel を Google マップと同じ記号に変換する */
export function formatPriceLevel(level: string | undefined | null): string | null {
  switch (level) {
    case 'PRICE_LEVEL_FREE':
      return '無料';
    case 'PRICE_LEVEL_INEXPENSIVE':
      return '¥';
    case 'PRICE_LEVEL_MODERATE':
      return '¥¥';
    case 'PRICE_LEVEL_EXPENSIVE':
      return '¥¥¥';
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return '¥¥¥¥';
    default:
      return null;
  }
}

/**
 * priceRange を「3,000〜4,000円」の形にする。
 * Money の units は文字列で返る。通貨は priceRange 側の currencyCode を尊重し、
 * 無ければ日本円とみなす。片側しか無い場合は「3,000円〜」「〜4,000円」とする。
 */
export function formatPriceRange(
  range:
    | {
        startPrice?: { currencyCode?: string; units?: string };
        endPrice?: { currencyCode?: string; units?: string };
      }
    | undefined
    | null,
): string | null {
  const start = toAmount(range?.startPrice?.units);
  const end = toAmount(range?.endPrice?.units);
  if (start == null && end == null) return null;

  const currency =
    range?.startPrice?.currencyCode ?? range?.endPrice?.currencyCode ?? 'JPY';
  const format = (v: number) =>
    currency === 'JPY'
      ? `${v.toLocaleString('ja-JP')}円`
      : `${v.toLocaleString('ja-JP')} ${currency}`;

  if (start != null && end != null) {
    return currency === 'JPY'
      ? `${start.toLocaleString('ja-JP')}〜${format(end)}`
      : `${format(start)}〜${format(end)}`;
  }
  return start != null ? `${format(start)}〜` : `〜${format(end as number)}`;
}

function toAmount(units: string | undefined): number | null {
  if (units == null) return null;
  const n = Number(units);
  return Number.isFinite(n) ? n : null;
}
