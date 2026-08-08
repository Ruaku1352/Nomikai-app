import type { Venue } from '../types';

export function VenueCard({ venue }: { venue: Venue }) {
  return (
    <a
      href={venue.mapsUrl}
      target="_blank"
      rel="noreferrer"
      className="flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card active:bg-canvas"
    >
      {venue.photoUrl ? (
        <img
          src={venue.photoUrl}
          alt=""
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-canvas text-2xl">
          🍶
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{venue.name}</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          <Stars rating={venue.rating} />
          {venue.rating != null && (
            <span className="ml-1 font-medium text-amber-500">
              {venue.rating.toFixed(1)}
            </span>
          )}
          {venue.userRatingCount != null && (
            <span className="ml-1 text-ink-faint">({venue.userRatingCount})</span>
          )}
        </p>
        {/* 平均予算。価格情報が無い店では行ごと出さない */}
        {(venue.priceLevel || venue.priceRange) && (
          <p className="mt-1 text-xs text-ink-soft">
            {venue.priceLevel && (
              <span className="font-medium">{venue.priceLevel}</span>
            )}
            {venue.priceLevel && venue.priceRange && (
              <span className="mx-1 text-ink-faint">·</span>
            )}
            {venue.priceRange}
          </p>
        )}
        <p className="mt-1 text-xs text-ink-faint">
          {venue.walkMinutes != null && <>駅から徒歩約{venue.walkMinutes}分</>}
          {venue.openNow != null && (
            <span
              className={
                venue.openNow ? 'ml-2 text-emerald-600' : 'ml-2 text-ink-faint'
              }
            >
              {venue.openNow ? '営業中' : '営業時間外'}
            </span>
          )}
        </p>
        {venue.openingHours && venue.openingHours.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-ink-faint">
            {venue.openingHours[0]}
          </p>
        )}
      </div>
    </a>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-ink-faint">評価なし</span>;
  const full = Math.round(rating);
  return (
    <span className="text-amber-500" aria-label={`評価 ${rating.toFixed(1)}`}>
      {'★'.repeat(full)}
      <span className="text-line">{'★'.repeat(5 - full)}</span>
    </span>
  );
}
