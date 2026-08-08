import { DEFAULT_GENRES, useAppStore } from '../store/useAppStore';
import { SORT_MODES } from '../lib/scoring';

export function GenresScreen() {
  const genres = useAppStore((s) => s.genres);
  const toggleGenre = useAppStore((s) => s.toggleGenre);
  const customGenre = useAppStore((s) => s.customGenre);
  const setCustomGenre = useAppStore((s) => s.setCustomGenre);
  const meetTime = useAppStore((s) => s.meetTime);
  const setMeetTime = useAppStore((s) => s.setMeetTime);
  const sortMode = useAppStore((s) => s.sortMode);
  const setSortMode = useAppStore((s) => s.setSortMode);
  const setStep = useAppStore((s) => s.setStep);
  const search = useAppStore((s) => s.search);
  const loading = useAppStore((s) => s.loading);

  const selected = genres.length + (customGenre.trim() ? 1 : 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-ink">お店のジャンル</h1>
        <p className="mt-1 text-sm text-ink-faint">複数選択できます。</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {DEFAULT_GENRES.map((g) => {
          const on = genres.includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggleGenre(g)}
              aria-pressed={on}
              className={`rounded-2xl border py-4 text-base font-semibold transition-colors ${
                on
                  ? 'border-accent bg-accent-soft text-accent-ink shadow-card'
                  : 'border-line bg-surface text-ink-soft shadow-card'
              }`}
            >
              {g}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="custom" className="mb-2 block text-sm text-ink-soft">
          その他（自由入力）
        </label>
        <input
          id="custom"
          type="text"
          value={customGenre}
          placeholder="例：イタリアン、餃子"
          onChange={(e) => setCustomGenre(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="time" className="mb-2 block text-sm text-ink-soft">
          集合したい時間帯（任意）
        </label>
        <input
          id="time"
          type="time"
          value={meetTime}
          onChange={(e) => setMeetTime(e.target.value)}
          className="rounded-xl border border-line bg-surface px-4 py-3 text-ink focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink-faint">
          お店の営業時間フィルタに使います。
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm text-ink-soft">駅の選び方</p>
        <div className="space-y-2">
          {SORT_MODES.map((m) => {
            const on = sortMode === m.mode;
            return (
              <button
                key={m.mode}
                type="button"
                onClick={() => setSortMode(m.mode)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left shadow-card transition-colors ${
                  on
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-surface'
                }`}
              >
                <span
                  className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                    on ? 'border-accent bg-accent' : 'border-line'
                  }`}
                  aria-hidden
                />
                <span>
                  <span
                    className={`block text-sm font-semibold ${
                      on ? 'text-accent-ink' : 'text-ink'
                    }`}
                  >
                    {m.label}
                  </span>
                  <span className="block text-[11px] text-ink-faint">
                    {m.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep('members')}
          className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-ink-soft"
        >
          戻る
        </button>
        <button
          type="button"
          disabled={selected === 0 || loading}
          onClick={() => void search()}
          className="flex-1 rounded-xl bg-accent py-4 text-base font-bold text-ink shadow-card transition-colors disabled:bg-line disabled:text-ink-faint disabled:shadow-none"
        >
          {loading ? '検索中…' : '集合場所を探す'}
        </button>
      </div>
    </div>
  );
}
