import type { CandidateStation, SortMode, Venue } from '../types';

/**
 * 4.3 スコアリング
 * score_sum = Σ(各メンバーの所要時間) / score_max = max(各メンバーの所要時間)
 * 到達できないメンバーがいる駅は候補から落とす（sumMinutes/maxMinutes が null）。
 * スコアが同点の場合は乗換回数の合計が少ない方を優先。
 */
export function rankStations(
  stations: CandidateStation[],
  mode: SortMode,
  limit = 3,
): CandidateStation[] {
  const reachable = stations.filter(
    (s) => s.sumMinutes !== null && s.maxMinutes !== null,
  );

  const scoreOf = (s: CandidateStation) =>
    mode === 'sum' ? (s.sumMinutes as number) : (s.maxMinutes as number);

  return [...reachable]
    .sort((a, b) => {
      const diff = scoreOf(a) - scoreOf(b);
      if (diff !== 0) return diff;
      // 僅差・同着は乗換回数が少ない方を優先
      const t = a.totalTransfers - b.totalTransfers;
      if (t !== 0) return t;
      // それでも同じなら「もう一方の指標」で比較
      const other =
        mode === 'sum'
          ? (a.maxMinutes as number) - (b.maxMinutes as number)
          : (a.sumMinutes as number) - (b.sumMinutes as number);
      return other;
    })
    .slice(0, limit);
}

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

export function formatMinutes(minutes: number | null): string {
  if (minutes == null) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}
