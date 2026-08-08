import { useEffect, useRef, useState } from 'react';
import type { AutocompleteSuggestion } from '../types';
import { ApiError, autocompleteStations } from '../lib/api';

interface Props {
  /** 呼び出し元の入力欄に入っていた文字列 */
  initialQuery: string;
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  onClose: () => void;
}

/** 一覧で出す件数。通常のオートコンプリート（5件）より多く見せる */
const PICKER_LIMIT = 20;
/** 検索窓のデバウンス。通常の入力欄と揃える */
const DEBOUNCE_MS = 250;

/**
 * 駅候補の一覧（フルスクリーン）。
 *
 * 通常のオートコンプリートは5件までなので、目的の駅が出ないときにここを開く。
 * **開いたときに1回だけ** 20件のリクエストを投げる。開いていない間は取りに行かない
 * （Autocomplete はリクエスト数がそのまま課金に効くため）。
 */
export function StationPicker({ initialQuery, onSelect, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escで閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 開いた直後の1回と、検索窓を編集したときだけ取得する
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const { suggestions } = await autocompleteStations(
          trimmed,
          PICKER_LIMIT,
          controller.signal,
        );
        setItems(suggestions);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setItems([]);
        setError(
          e instanceof ApiError
            ? { message: e.message, details: e.details }
            : { message: '駅の検索に失敗しました' },
        );
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="駅を選ぶ"
      className="fixed inset-0 z-40 flex flex-col bg-canvas"
    >
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          value={query}
          placeholder="駅名を入力"
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-xl px-3 py-3 text-sm text-ink-soft"
        >
          閉じる
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-xs leading-relaxed text-accent-ink">
          同じ名前の駅が全国にある場合は、「桜井 箕面」のように
          <strong>地名を足す</strong>か「阪急桜井」のように
          <strong>路線名を足す</strong>と絞り込めます。
        </p>

        {loading && <p className="py-6 text-center text-sm text-ink-faint">検索中…</p>}

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error.message}
            {error.details && (
              <span className="mt-1 block break-all text-[11px] text-red-700/70">
                {error.details}
              </span>
            )}
          </p>
        )}

        {!loading && !error && items.length === 0 && query.trim() && (
          <p className="py-6 text-center text-sm text-ink-faint">
            該当する駅が見つかりません
          </p>
        )}

        {items.length > 0 && (
          <>
            <p className="mb-2 text-xs text-ink-faint">{items.length}件</p>
            <ul className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {items.map((s, i) => (
                <li
                  key={s.placeId}
                  className={i > 0 ? 'border-t border-line' : undefined}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(s)}
                    className="w-full px-4 py-3 text-left active:bg-accent-soft"
                  >
                    <span className="block text-sm font-medium text-ink">
                      {s.name}
                    </span>
                    {/* 同名駅を区別できるよう所在地も出す */}
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {s.address || '所在地不明'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
