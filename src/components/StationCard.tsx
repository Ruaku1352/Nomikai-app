import type { CandidateStation, Member, SortMode, VenueGroup } from '../types';
import { formatDistance } from '../lib/scoring';
import { VenueCard } from './VenueCard';

interface Props {
  rank: number;
  station: CandidateStation;
  members: Member[];
  sortMode: SortMode;
  expanded: boolean;
  groups: VenueGroup[] | undefined;
  onToggle: () => void;
}

export function StationCard({
  rank,
  station,
  members,
  sortMode,
  expanded,
  groups,
  onToggle,
}: Props) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${station.location.lat},${station.location.lng}&query_place_id=${station.placeId}`;

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-black">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-white">
            {station.name}
          </span>
          <span className="block text-xs text-white/50">
            平均 {formatDistance(station.avgMeters)} / 最長{' '}
            {formatDistance(station.maxMeters)}
            <span className="ml-2 text-accent">
              {sortMode === 'sum' ? '合計距離が最小' : '最長距離が最小'}
            </span>
          </span>
        </span>
        <span
          className={`shrink-0 text-white/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
            メンバー別の距離（直線）
          </h3>
          <ul className="mb-4 space-y-1">
            {members.map((m, i) => (
              <li key={m.id} className="flex justify-between text-sm">
                <span className="truncate text-white/70">
                  {m.name || `メンバー${i + 1}`}
                  <span className="ml-1 text-white/30">
                    （{m.station?.name}）
                  </span>
                </span>
                <span className="ml-2 shrink-0 text-white">
                  {formatDistance(station.distances[m.id])}
                </span>
              </li>
            ))}
          </ul>

          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="mb-4 inline-block text-sm text-accent underline"
          >
            地図で開く
          </a>

          {groups === undefined ? (
            <p className="text-sm text-white/40">お店を読み込み中…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-white/40">
              条件に合うお店が見つかりませんでした。
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.genre} className="mb-4 last:mb-0">
                <h3 className="mb-2 text-sm font-semibold text-white">
                  {group.genre}
                </h3>
                {group.venues.length === 0 ? (
                  <p className="text-xs text-white/40">
                    このジャンルのお店は見つかりませんでした。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {group.venues.map((v) => (
                      <VenueCard key={v.placeId} venue={v} />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
