import { useEffect, useRef, useState } from 'react';
import type { AutocompleteSuggestion, StationRef } from '../types';
import { autocompleteStations, resolveStation } from '../lib/api';

interface Props {
  value: StationRef | null;
  placeholder?: string;
  onChange: (station: StationRef | null) => void;
}

/**
 * 駅名オートコンプリート。入力を250msデバウンスしてから Places Autocomplete を叩く
 * （課金対象なので打鍵ごとには投げない）。
 */
export function StationInput({ value, placeholder, onChange }: Props) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const skipNextFetch = useRef(false);

  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value?.placeId, value?.name]);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPending(true);
      setError(null);
      try {
        const { suggestions } = await autocompleteStations(
          trimmed,
          controller.signal,
        );
        setSuggestions(suggestions);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError('駅の検索に失敗しました');
          setSuggestions([]);
        }
      } finally {
        setPending(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

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
    // 緯度経度は Place Details で解決する（Autocomplete には含まれない）
    setPending(true);
    try {
      const station = await resolveStation(s.placeId);
      onChange(station);
    } catch {
      setError('駅の位置情報を取得できませんでした');
      onChange(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        inputMode="search"
        value={query}
        placeholder={placeholder ?? '例：渋谷駅'}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
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
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 bg-surface shadow-xl">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => void select(s)}
                className="w-full px-4 py-3 text-left hover:bg-white/10"
              >
                <span className="block text-sm text-white">{s.name}</span>
                <span className="block text-xs text-white/40">{s.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
