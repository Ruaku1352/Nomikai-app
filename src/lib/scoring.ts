import type { CandidateStation, SortMode, Venue } from '../types';

/**
 * 4.3 スコアリング（候補駅の並べ替え）
 *
 * - fair: 平均 + k×標準偏差。全員が同じくらいの距離になる駅を上位にする（既定）
 * - sum : Σ(各メンバーの距離)。全体の移動量が最小
 * - max : max(各メンバーの距離)。一番遠い人の負担が最小
 *
 * 同点・僅差の場合は全員の重心に近い駅を優先する。
 */
export function rankStations(
  stations: CandidateStation[],
  mode: SortMode,
  limit = 3,
): CandidateStation[] {
  const scoreOf = (s: CandidateStation) =>
    mode === 'fair' ? s.fairnessMeters : mode === 'sum' ? s.sumMeters : s.maxMeters;

  return [...stations]
    .sort((a, b) => {
      const diff = scoreOf(a) - scoreOf(b);
      if (diff !== 0) return diff;
      // 乗換回数が取れないため、重心に近い方をタイブレークに使う
      const c = a.centroidMeters - b.centroidMeters;
      if (c !== 0) return c;
      return a.sumMeters - b.sumMeters;
    })
    .slice(0, limit);
}

/**
 * 並び順の表示名。内部の指標名ではなく、意味が伝わる言葉にする。
 * badge は駅カードに出す短い表記（label をそのまま使うと文がつながらないため別に持つ）。
 */
export const SORT_MODES: {
  mode: SortMode;
  label: string;
  hint: string;
  badge: string;
}[] = [
  {
    mode: 'fair',
    label: 'みんな公平に',
    hint: '全員が同じくらいの距離',
    badge: '公平さで選出',
  },
  {
    mode: 'sum',
    label: '全体の移動が最小',
    hint: '合計距離がいちばん短い',
    badge: '合計距離で選出',
  },
  {
    mode: 'max',
    label: '一番遠い人を優先',
    hint: '最長の人の距離が短い',
    badge: '最長距離で選出',
  },
];

/**
 * 4.4 レビュー数を考慮した加重スコア。
 * レビュー数が極端に少ない高評価店を過大評価しないために log を掛ける。
 */
export function weightedScore(
  rating: number | null,
  userRatingCount: number | null,
): number {
  if (rating == null) return 0;
  return rating * Math.log((userRatingCount ?? 0) + 1);
}

export function sortVenues(venues: Venue[], limit = 3): Venue[] {
  return [...venues]
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, limit);
}

/** 重心（緯度経度の単純平均）。日本国内程度の範囲なら十分な近似。 */
export function centroid(points: { lat: number; lng: number }[]) {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** メートルを表示用の文字列にする（1km未満はm、それ以上はkm） */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
