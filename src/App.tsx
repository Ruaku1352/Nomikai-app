import { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { MembersScreen } from './screens/MembersScreen';
import { GenresScreen } from './screens/GenresScreen';
import { ResultScreen } from './screens/ResultScreen';

const STEPS = [
  { key: 'members', label: 'メンバー' },
  { key: 'genres', label: 'ジャンル' },
  { key: 'result', label: '結果' },
] as const;

export default function App() {
  const step = useAppStore((s) => s.step);
  const loading = useAppStore((s) => s.loading);
  const loadingMessage = useAppStore((s) => s.loadingMessage);
  const error = useAppStore((s) => s.error);
  const errorDetails = useAppStore((s) => s.errorDetails);
  const clearError = useAppStore((s) => s.clearError);
  const result = useAppStore((s) => s.result);
  const setStep = useAppStore((s) => s.setStep);
  const online = useOnline();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-base px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
      <nav className="mb-5 flex items-center gap-2" aria-label="ステップ">
        {STEPS.map((s, i) => {
          const active = s.key === step;
          const reachable = s.key !== 'result' || result !== null;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!reachable}
              onClick={() => setStep(s.key)}
              className={`flex-1 rounded-full py-1.5 text-xs font-semibold ${
                active
                  ? 'bg-accent text-black'
                  : reachable
                    ? 'bg-white/5 text-white/50'
                    : 'bg-white/5 text-white/20'
              }`}
            >
              {i + 1}. {s.label}
            </button>
          );
        })}
      </nav>

      {!online && (
        <p className="mb-4 rounded-xl bg-amber-500/15 px-4 py-3 text-xs text-amber-300">
          オフラインです。直前の検索結果のみ閲覧できます。
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300"
        >
          <span className="flex-1">
            {error}
            {errorDetails && (
              <span className="mt-1 block break-all text-[11px] text-red-300/60">
                {errorDetails}
              </span>
            )}
          </span>
          <button type="button" onClick={clearError} className="text-red-300/60">
            ✕
          </button>
        </div>
      )}

      <main className="flex-1">
        {step === 'members' && <MembersScreen />}
        {step === 'genres' && <GenresScreen />}
        {step === 'result' && <ResultScreen />}
      </main>

      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-base/80 backdrop-blur-sm">
          <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
          <p className="text-sm text-white/70">{loadingMessage || '処理中…'}</p>
        </div>
      )}
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
