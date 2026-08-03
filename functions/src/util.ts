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
