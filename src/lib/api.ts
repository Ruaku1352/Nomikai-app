import type {
  AutocompleteSuggestion,
  CandidateStation,
  LatLng,
  Member,
  StationRef,
  VenueGroup,
} from '../types';

/**
 * APIキーはクライアントに埋め込まない。すべて薄いバックエンド(Cloud Functions)経由。
 * 開発時は vite の proxy 経由で Firebase Emulator に飛ぶ。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = `リクエストに失敗しました (${res.status})`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* プレーンテキストならそのまま無視 */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

/** 駅名オートコンプリート（Places API - Autocomplete） */
export function autocompleteStations(
  query: string,
  signal?: AbortSignal,
): Promise<{ suggestions: AutocompleteSuggestion[] }> {
  return request(`/stations/autocomplete?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    signal,
  });
}

/** placeId から緯度経度を引く（Places API - Place Details） */
export function resolveStation(placeId: string): Promise<StationRef> {
  return request(`/stations/${encodeURIComponent(placeId)}`, { method: 'GET' });
}

/**
 * 4.1 + 4.2: 候補駅のリストアップと所要時間マトリクスの取得をまとめて依頼する。
 * 候補駅の絞り込み（maxCandidates）はサーバ側でも上限が効く。
 */
export function fetchCandidates(params: {
  members: Member[];
  departureTime?: string | null;
  maxCandidates?: number;
}): Promise<{ stations: CandidateStation[] }> {
  return request('/candidates', {
    method: 'POST',
    body: JSON.stringify({
      members: params.members
        .filter((m) => m.station?.location)
        .map((m) => ({
          id: m.id,
          name: m.name,
          location: m.station!.location as LatLng,
          stationName: m.station!.name,
        })),
      departureTime: params.departureTime ?? null,
      maxCandidates: params.maxCandidates ?? 12,
    }),
  });
}

/** 4.4: 駅周辺の店をジャンル別に検索して加重スコア順に返す */
export function fetchVenues(params: {
  station: { placeId: string; name: string; location: LatLng };
  genres: string[];
  openAt?: string | null;
}): Promise<{ groups: VenueGroup[] }> {
  return request('/venues', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
