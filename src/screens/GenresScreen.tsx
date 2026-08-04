import { DEFAULT_GENRES, useAppStore } from '../store/useAppStore';

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
        <h1 className="text-xl font-bold text-white">お店のジャンル</h1>
        <p className="mt-1 text-sm text-white/50">複数選択できます。</p>
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
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-white/10 bg-surface text-white/70'
              }`}
            >
              {g}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="custom" className="mb-2 block text-sm text-white/70">
          その他（自由入力）
        </label>
        <input
          id="custom"
          type="text"
          value={customGenre}
          placeholder="例：イタリアン、餃子"
          onChange={(e) => setCustomGenre(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="time" className="mb-2 block text-sm text-white/70">
          集合したい時間帯（任意）
        </label>
        <input
          id="time"
          type="time"
          value={meetTime}
          onChange={(e) => setMeetTime(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-white/40">
          お店の営業時間フィルタに使います。
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm text-white/70">駅の選び方</p>
        <div className="flex rounded-xl border border-white/10 bg-surface p-1">
          <ModeButton
            active={sortMode === 'sum'}
            onClick={() => setSortMode('sum')}
            label="合計最小"
            hint="全員の距離の合計が短い"
          />
          <ModeButton
            active={sortMode === 'max'}
            onClick={() => setSortMode('max')}
            label="最長最小"
            hint="一番遠い人の距離が短い"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep('members')}
          className="rounded-xl border border-white/15 px-5 py-4 text-sm text-white/70"
        >
          戻る
        </button>
        <button
          type="button"
          disabled={selected === 0 || loading}
          onClick={() => void search()}
          className="flex-1 rounded-xl bg-accent py-4 text-base font-bold text-black disabled:bg-white/10 disabled:text-white/30"
        >
          {loading ? '検索中…' : '集合場所を探す'}
        </button>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-lg px-3 py-2 text-center ${
        active ? 'bg-accent text-black' : 'text-white/60'
      }`}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span
        className={`block text-[11px] ${active ? 'text-black/60' : 'text-white/30'}`}
      >
        {hint}
      </span>
    </button>
  );
}
