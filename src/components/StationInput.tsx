import { useEffect, useRef, useState } from 'react';
import type { AutocompleteSuggestion, StationRef } from '../types';
import { ApiError, autocompleteStations, resolveStation } from '../lib/api';

interface Props {
  value: StationRef | null;
  placeholder?: string;
  onChange: (station: StationRef | null) => void;
}

/** 検索バーに出す候補の件数 */
const SUGGESTION_LIMIT = 5;
/**
 * 打鍵ごとに投げないためのデバウンス。
 * 駅の検索は Text Search を主経路にしており単価が高いので、やや長めにとる。
 * （サーバ側にも10分の短時間キャッシュがある）
 */
const DEBOUNCE_MS = 350;

/**
 * 駅名オートコンプリート。
 * 1文字目から部分一致で候補を最大5件出し、↑↓とEnterで選べる。
 */
export function StationInput({ value, placeholder, onChange }: Props) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(
    null,
  );
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const skipNextFetch = useRef(false);
  // 日本語入力の変換中は確定前の文字が流れてくるので、その間は検索しない
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    // 駅が確定したときだけ入力欄を同期する。
    // value が null に戻ったとき（＝ユーザーが編集を始めたとき）に空にしてしまうと、
    // 選択済みの状態から打ち直せなくなる。
    if (value?.name) setQuery(value.name);
  }, [value?.placeId, value?.name]);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    if (composing) return;
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPending(true);
      setError(null);
      try {
        const { suggestions } = await autocompleteStations(
          trimmed,
          SUGGESTION_LIMIT,
          controller.signal,
        );
        setSuggestions(suggestions);
        setActiveIndex(-1);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setSuggestions([]);
        setError(
          e instanceof ApiError
            ? { message: e.message, details: e.details }
            : { message: '駅の検索に失敗しました' },
        );
      } finally {
        setPending(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, composing]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const select = async (s: AutocompleteSuggestion) => {
    skipNextFetch.current = true;
    setQuery(s.name);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    // Text Search 経由の候補は緯度経度を持っているので Place Details を省ける
    if (s.location) {
      onChange({
        placeId: s.placeId,
        name: s.name,
        address: s.address,
        location: s.location,
      });
      return;
    }

    // Autocomplete の候補には緯度経度が無いので Place Details で解決する
    setPending(true);
    setError(null);
    try {
      const station = await resolveStation(s.placeId);
      if (!station.location) {
        throw new ApiError('駅の位置情報を取得できませんでした', 502);
      }
      onChange(station);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? { message: e.message, details: e.details }
          : { message: '駅の位置情報を取得できませんでした' },
      );
      onChange(null);
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 変換確定のEnterを候補選択と取り違えない
    if (e.nativeEvent.isComposing || composing) return;
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      void select(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder ?? '例：渋谷'}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setComposing(false);
          setQuery(e.currentTarget.value);
        }}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-accent focus:outline-none"
      />
      {pending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">
          検索中…
        </span>
      )}
      {value && !pending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-emerald-400">
          ✓
        </span>
      )}

      {error && (
        <p className="mt-1 text-xs text-red-400">
          {error.message}
          {error.details && (
            <span className="mt-0.5 block break-all text-[10px] text-red-400/60">
              {error.details}
            </span>
          )}
        </p>
      )}

      {open && suggestions.length === 0 && !pending && !error && (
        <p className="mt-1 text-xs text-white/30">
          該当する駅が見つかりません
        </p>
      )}

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-surface shadow-xl"
        >
          {suggestions.map((s, i) => (
            <li key={s.placeId}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => void select(s)}
                className={`w-full px-4 py-3 text-left ${
                  i === activeIndex ? 'bg-white/10' : ''
                }`}
              >
                <span className="block text-sm text-white">
                  <Highlight text={s.name} query={query} />
                </span>
                <span className="block truncate text-xs text-white/40">
                  {s.address}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 入力に一致した部分を強調する（部分一致なので先頭とは限らない） */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-bold text-accent">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}
