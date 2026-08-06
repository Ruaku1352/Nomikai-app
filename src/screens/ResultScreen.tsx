import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { rankStations } from '../lib/scoring';
import { StationCard } from '../components/StationCard';

export function ResultScreen() {
  const result = useAppStore((s) => s.result);
  const sortMode = useAppStore((s) => s.sortMode);
  const setSortMode = useAppStore((s) => s.setSortMode);
  const setStep = useAppStore((s) => s.setStep);
  const ensureVenues = useAppStore((s) => s.ensureVenues);
  const [expanded, setExpanded] = useState<string | null>(null);

  const top = useMemo(
    () => (result ? rankStations(result.stations, sortMode, 3) : []),
    [result, sortMode],
  );

  // 先頭の駅は開いた状態で見せる
  useEffect(() => {
    if (top.length > 0) setExpanded((cur) => cur ?? top[0].placeId);
  }, [top]);

  // 開いた駅の店舗がまだ無ければ取りに行く（指標切替で入れ替わった駅など）
  useEffect(() => {
    if (expanded) void ensureVenues(expanded);
  }, [expanded, ensureVenues]);

  if (!result) {
    return (
      <div className="space-y-4">
        <p className="text-ink-soft">まだ検索結果がありません。</p>
        <button
          type="button"
          onClick={() => setStep('members')}
          className="w-full rounded-xl bg-accent py-4 font-bold text-ink shadow-card"
        >
          最初から入力する
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">集合場所の候補</h1>
          <p className="mt-1 text-xs text-ink-faint">
            {result.members.length}人 / {result.genres.join('・')} /{' '}
            {new Date(result.createdAt).toLocaleString('ja-JP')}時点
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStep('members')}
          className="shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink-soft"
        >
          条件を変更
        </button>
      </header>

      <div className="flex rounded-xl border border-line bg-surface p-1">
        <button
          type="button"
          onClick={() => setSortMode('sum')}
          aria-pressed={sortMode === 'sum'}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
            sortMode === 'sum' ? 'bg-accent text-ink shadow-card' : 'text-ink-soft'
          }`}
        >
          合計距離が短い
        </button>
        <button
          type="button"
          onClick={() => setSortMode('max')}
          aria-pressed={sortMode === 'max'}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
            sortMode === 'max' ? 'bg-accent text-ink shadow-card' : 'text-ink-soft'
          }`}
        >
          一番遠い人が近い
        </button>
      </div>

      <div className="space-y-3">
        {top.map((station, i) => (
          <StationCard
            key={station.placeId}
            rank={i + 1}
            station={station}
            members={result.members}
            sortMode={sortMode}
            expanded={expanded === station.placeId}
            groups={result.venuesByStation[station.placeId]}
            onToggle={() =>
              setExpanded((cur) =>
                cur === station.placeId ? null : station.placeId,
              )
            }
          />
        ))}
      </div>

      <p className="pb-6 text-[11px] leading-relaxed text-ink-faint">
        駅の順位は<strong className="text-ink-soft">直線距離をもとにした目安</strong>
        です。実際の電車での所要時間とは異なります。お店の情報は Google Places
        のデータで、表示時点のものです。最新の営業状況は各店舗にご確認ください。
      </p>
    </div>
  );
}
