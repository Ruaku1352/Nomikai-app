import type { Venue } from '../types';

export function VenueCard({ venue }: { venue: Venue }) {
  return (
    <a
      href={venue.mapsUrl}
      target="_blank"
      rel="noreferrer"
      className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 active:bg-white/10"
    >
      {venue.photoUrl ? (
        <img
          src={venue.photoUrl}
          alt=""
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-white/10 text-2xl">
          🍶
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{venue.name}</p>
        <p className="mt-0.5 text-xs text-white/70">
          <Stars rating={venue.rating} />
          {venue.rating != null && (
            <span className="ml-1 font-medium text-amber-300">
              {venue.rating.toFixed(1)}
            </span>
          )}
          {venue.userRatingCount != null && (
            <span className="ml-1 text-white/40">({venue.userRatingCount})</span>
          )}
          {venue.priceLevel && (
            <span className="ml-2 text-white/60">{venue.priceLevel}</span>
          )}
        </p>
        <p className="mt-1 text-xs text-white/50">
          {venue.walkMinutes != null && <>駅から徒歩約{venue.walkMinutes}分</>}
          {venue.openNow != null && (
            <span
              className={
                venue.openNow ? 'ml-2 text-emerald-400' : 'ml-2 text-white/40'
              }
            >
              {venue.openNow ? '営業中' : '営業時間外'}
            </span>
          )}
        </p>
        {venue.openingHours && venue.openingHours.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-white/40">
            {venue.openingHours[0]}
          </p>
        )}
      </div>
    </a>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-white/30">評価なし</span>;
  const full = Math.round(rating);
  return (
    <span className="text-amber-300" aria-label={`評価 ${rating.toFixed(1)}`}>
      {'★'.repeat(full)}
      <span className="text-white/20">{'★'.repeat(5 - full)}</span>
    </span>
  );
}
