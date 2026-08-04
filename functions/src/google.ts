/**
 * Google Maps Platform への薄いラッパー。
 * APIキーはここ（サーバ側）だけで扱い、クライアントには絶対に出さない。
 */

import {
  normalizeForMatch,
  rankByNameMatch,
  scoreStationNameMatch,
} from './util';

const PLACES_BASE = 'https://places.googleapis.com/v1';

export interface LatLng {
  lat: number;
  lng: number;
}

export function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new HttpError(
      500,
      'GOOGLE_MAPS_API_KEY が設定されていません。functions/.env を確認してください。',
    );
  }
  return key;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 原因の切り分け用。APIキーは絶対に含めない。 */
    readonly details?: string,
  ) {
    super(message);
  }
}

interface GoogleErrorBody {
  error?: { code?: number; status?: string; message?: string };
}

/**
 * Google のエラーを、原因が分かる日本語メッセージに変換する。
 *
 * 以前は「地図サービスへの問い合わせに失敗しました」の一言に潰していたため、
 * APIの有効化漏れなのかキー制限なのかリクエスト不正なのか区別がつかなかった。
 * Googleのエラー本文にAPIキーは含まれないので、原因部分は details として返す。
 */
function translateGoogleError(status: number, body: string): HttpError {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as GoogleErrorBody;
    code = parsed.error?.status ?? '';
    message = parsed.error?.message ?? '';
  } catch {
    message = body.slice(0, 300);
  }
  const details = [code, message].filter(Boolean).join(': ').slice(0, 500);

  if (status === 429 || code === 'RESOURCE_EXHAUSTED') {
    return new HttpError(
      429,
      'リクエストが多すぎます。少し待って再試行してください。',
      details,
    );
  }
  if (status === 403 || status === 401 || code === 'PERMISSION_DENIED') {
    if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(message)) {
      return new HttpError(
        502,
        'Google Cloud で Places API (New) が有効になっていません。プロジェクトで有効化してください。',
        details,
      );
    }
    if (/API key|referer|referrer|IP|restrict/i.test(message)) {
      return new HttpError(
        502,
        'APIキーの制限で拒否されました。キーのAPI制限に Places API (New) が含まれているか確認してください（サーバから呼ぶためリファラ制限は使えません）。',
        details,
      );
    }
    if (/billing/i.test(message)) {
      return new HttpError(
        502,
        'Google Cloud の課金設定が有効になっていません（Firebase は Blaze プランが必要です）。',
        details,
      );
    }
    return new HttpError(502, 'Google API へのアクセスが拒否されました。', details);
  }
  if (status === 400 || code === 'INVALID_ARGUMENT') {
    return new HttpError(
      502,
      'Google API へのリクエストが不正です。',
      details,
    );
  }
  return new HttpError(502, '地図サービスへの問い合わせに失敗しました。', details);
}

async function callGoogle<T>(
  url: string,
  init: RequestInit & { fieldMask?: string },
): Promise<T> {
  const { fieldMask, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Google API error', url, res.status, text);
    throw translateGoogleError(res.status, text);
  }
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- Places */

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }[];
}

/**
 * 駅とみなす primary type。
 *
 * train_station / subway_station だけでは日本の駅を取りこぼす:
 *   - light_rail_station … 路面電車・モノレール・新交通（広島電鉄、ゆりかもめ、札幌市電など）
 *   - transit_station     … 事業者や駅によってはこちらが primary になる
 * includedPrimaryTypes は最大5件まで指定できる。
 */
const STATION_PRIMARY_TYPES = [
  'train_station',
  'subway_station',
  'light_rail_station',
  'transit_station',
];

/**
 * 駅そのものの名前か。
 * 「東京駅一番街」（商業施設）のような “駅を含むだけ” の場所を弾くため、
 * 末尾で判定する。住所は見ない（住所に駅名が入るだけの場所を拾ってしまうため）。
 */
export function looksLikeStation(name: string): boolean {
  return /(駅|停留場|停留所|のりば|station)$/i.test(name.trim());
}

export interface Suggestion {
  placeId: string;
  name: string;
  address: string;
  /** Text Search 経由で取れた場合のみ。Place Details を省ける */
  location?: LatLng;
}

function toSuggestions(data: AutocompleteResponse): Suggestion[] {
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      address: p.structuredFormat?.secondaryText?.text ?? '',
    }));
}

/** Autocomplete を1回叩く（typed=false でタイプ絞り込みなし） */
async function fetchAutocomplete(
  input: string,
  typed: boolean,
): Promise<Suggestion[]> {
  const data = await callGoogle<AutocompleteResponse>(
    `${PLACES_BASE}/places:autocomplete`,
    {
      method: 'POST',
      body: JSON.stringify({
        input,
        languageCode: 'ja',
        // 日本国内に限定する
        includedRegionCodes: ['jp'],
        ...(typed ? { includedPrimaryTypes: STATION_PRIMARY_TYPES } : {}),
      }),
    },
  );
  return toSuggestions(data);
}

/**
 * 駅名オートコンプリート。
 *
 * Places Autocomplete は住所も含めて部分一致するため、素で使うと
 * 「渋谷」に対して代官山駅・代々木公園駅（どちらも渋谷区）が返ってくる。
 * そこで駅名への一致度（rankByNameMatch）で並べ替え、住所だけが一致した候補は捨てる。
 *
 * Autocomplete は1回につき最大5件しか返さないため、駅名一致だけで件数が足りない
 * ときに限り「〇〇駅」で引き直して補充する（コールは最大2回）。
 */
export interface AutocompleteTrace {
  /** どの段階で何が起きたか（切り分け用） */
  stages: {
    name: string;
    /** 実際にGoogleへ送った文字列。文字化けの有無もこれで分かる */
    query: string;
    /** Googleが返した件数 */
    raw: number;
    /** 駅名フィルタ通過後の件数 */
    kept?: number;
    names: string[];
    /** 失敗した場合の理由（成功時は入らない） */
    error?: string;
  }[];
  source: 'cache' | 'text-search' | 'autocomplete' | 'autocomplete-loose' | 'none';
}

/**
 * 直近の検索結果を短時間だけ持つ。
 * 同じ駅名を何度も引くケース（打鍵・複数メンバー・再検索）でコールを減らす。
 * Places の規約上、長期保存はしないので10分で捨てる。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; value: Suggestion[] }>();

function getCached(key: string): Suggestion[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key: string, value: Suggestion[]): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

/**
 * 駅名の候補を返す。
 *
 * **Text Search を主経路にしている。** Autocomplete の `includedPrimaryTypes` に
 * 駅タイプを指定すると、日本の主要駅（東京・新宿・渋谷・恵比寿・目黒など）が
 * 候補に出てこない事象が本番で確認されたため。Autocomplete の候補は
 * primary type が Table B（geocode / establishment 等）になることがあり、
 * Table A の駅タイプでの絞り込みと噛み合わない。
 *
 * Text Search は実在の場所を返すので駅を取りこぼさず、緯度経度も一緒に返るため
 * 選択時の Place Details を省ける。単価は Autocomplete より高いので、
 * 短時間キャッシュと入力のデバウンスでコール数を抑える。
 */
export async function autocompleteStations(
  input: string,
  limit = 5,
  trace?: AutocompleteTrace,
): Promise<Suggestion[]> {
  const query = input.trim();
  const cacheKey = `${normalizeForMatch(query)}|${limit}`;

  const cached = getCached(cacheKey);
  if (cached) {
    if (trace) {
      trace.source = 'cache';
      trace.stages.push({
        name: 'cache',
        query,
        raw: cached.length,
        names: cached.map((s) => s.name),
      });
    }
    return cached;
  }

  const collected = new Map<string, Suggestion>();
  const record = (name: string, q: string, list: Suggestion[]) => {
    trace?.stages.push({
      name,
      query: q,
      raw: list.length,
      names: list.map((s) => s.name),
    });
  };
  const recordError = (name: string, q: string, e: unknown) => {
    trace?.stages.push({
      name,
      query: q,
      raw: 0,
      names: [],
      error:
        e instanceof HttpError
          ? `${e.message}${e.details ? ` (${e.details})` : ''}`
          : String(e),
    });
  };
  const add = (list: Suggestion[]) => {
    for (const s of list) if (!collected.has(s.placeId)) collected.set(s.placeId, s);
  };
  const finish = (result: Suggestion[], source: AutocompleteTrace['source']) => {
    if (trace) trace.source = source;
    setCached(cacheKey, result);
    return result;
  };

  // 上流エラーは握り潰さず、最後まで候補が得られなかったときに投げ直す
  let lastError: unknown = null;

  // 1) Text Search（主経路）
  let textCount = 0;
  try {
    const byText = await searchStationsByText(query, limit, trace);
    record('text-search', textSearchQuery(query), byText);
    textCount = byText.length;
    add(byText);
  } catch (e) {
    lastError = e;
    recordError('text-search', query, e);
    console.warn('text-search に失敗しました', e);
  }

  let ranked = rankByNameMatch([...collected.values()], query, limit);
  // 件数が揃っている、または入力と完全一致する駅が取れていれば追加のコールはしない
  const hasExact = ranked.some((s) => scoreStationNameMatch(s.name, query) === 3);
  if (ranked.length >= limit || (hasExact && ranked.length > 0)) {
    return finish(ranked, 'text-search');
  }

  // 2) 件数が足りなければ Autocomplete で補う（単価が安いので気軽に足せる）
  try {
    const typed = await fetchAutocomplete(query, true);
    record('autocomplete(駅タイプ指定)', query, typed);
    add(typed);
  } catch (e) {
    lastError = e;
    recordError('autocomplete(駅タイプ指定)', query, e);
    console.warn('autocomplete(タイプ指定)に失敗しました', e);
  }

  ranked = rankByNameMatch([...collected.values()], query, limit);
  if (ranked.length > 0) {
    return finish(ranked, textCount > 0 ? 'text-search' : 'autocomplete');
  }

  // 3) 最後の救済：タイプで絞らずに引き、駅らしい候補だけ残す
  try {
    const loose = await fetchAutocomplete(query, false);
    const looseStations = rankByNameMatch(
      loose.filter((s) => looksLikeStation(s.name)),
      query,
      limit,
    );
    trace?.stages.push({
      name: 'autocomplete(タイプ指定なし)',
      query,
      raw: loose.length,
      kept: looseStations.length,
      names: loose.map((s) => s.name),
    });
    if (looseStations.length > 0) return finish(looseStations, 'autocomplete-loose');
  } catch (e) {
    lastError = e;
    recordError('autocomplete(タイプ指定なし)', query, e);
  }

  // 全経路が失敗した場合は「0件」ではなくエラーとして返す（設定不備を隠さない）
  if (lastError) throw lastError;
  return finish([], 'none');
}

interface PlaceDetails {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
}

export async function placeDetails(placeId: string) {
  const data = await callGoogle<PlaceDetails>(
    `${PLACES_BASE}/places/${encodeURIComponent(placeId)}?languageCode=ja&regionCode=JP`,
    {
      method: 'GET',
      fieldMask: 'id,displayName,formattedAddress,location',
    },
  );
  return {
    placeId: data.id,
    name: data.displayName?.text ?? '',
    address: data.formattedAddress,
    location: data.location
      ? { lat: data.location.latitude, lng: data.location.longitude }
      : undefined,
  };
}

interface NearbyResponse {
  places?: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
  }[];
}

/** 重心の周辺から候補駅を拾う（4.1 シンプル版） */
export async function nearbyStations(center: LatLng, radiusMeters: number) {
  const data = await callGoogle<NearbyResponse>(
    `${PLACES_BASE}/places:searchNearby`,
    {
      method: 'POST',
      fieldMask:
        'places.id,places.displayName,places.formattedAddress,places.location',
      body: JSON.stringify({
        includedTypes: ['train_station', 'subway_station'],
        maxResultCount: 20,
        rankPreference: 'POPULARITY',
        languageCode: 'ja',
        regionCode: 'JP',
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            // Nearby Search の半径上限は 50km
            radius: Math.min(radiusMeters, 50_000),
          },
        },
      }),
    },
  );

  return (data.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? '',
      address: p.formattedAddress,
      location: {
        lat: p.location!.latitude,
        lng: p.location!.longitude,
      },
    }));
}

interface TextSearchResponse {
  places?: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    googleMapsUri?: string;
    photos?: { name: string }[];
    currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
    regularOpeningHours?: OpeningHours;
  }[];
}

export interface OpeningHours {
  weekdayDescriptions?: string[];
  periods?: {
    open?: { day?: number; hour?: number; minute?: number };
    close?: { day?: number; hour?: number; minute?: number };
  }[];
}

export async function searchVenues(params: {
  textQuery: string;
  center: LatLng;
  radiusMeters: number;
  openNow: boolean;
}) {
  const data = await callGoogle<TextSearchResponse>(
    `${PLACES_BASE}/places:searchText`,
    {
      method: 'POST',
      fieldMask: [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.googleMapsUri',
        'places.photos',
        'places.currentOpeningHours',
        'places.regularOpeningHours',
      ].join(','),
      body: JSON.stringify({
        textQuery: params.textQuery,
        languageCode: 'ja',
        regionCode: 'JP',
        maxResultCount: 20,
        openNow: params.openNow,
        locationBias: {
          circle: {
            center: {
              latitude: params.center.lat,
              longitude: params.center.lng,
            },
            radius: params.radiusMeters,
          },
        },
      }),
    },
  );
  return data.places ?? [];
}

interface StationTextSearchResponse {
  places?: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    primaryType?: string;
    location?: { latitude: number; longitude: number };
  }[];
}

/**
 * Text Search で駅を探す。Autocomplete が0件を返したときの代替経路。
 *
 * Autocomplete は挙動がGoogle側の都合（対応タイプ・地域）に左右されるが、
 * Text Search は実在の場所を返すため取りこぼしにくい。緯度経度も一緒に返るので
 * 選択時の Place Details を省ける。単価は高いので0件時のみ使う。
 */
/**
 * Text Search に投げる語。
 * 「渋谷駅」のように既に駅名ならそのまま、そうでなければ空白区切りで「駅」を足す。
 * `${query}駅` と連結すると1〜2文字の入力で「渋駅」のような語になってしまう。
 */
export function textSearchQuery(query: string): string {
  return /(駅|停留場|停留所)$/.test(query) ? query : `${query} 駅`;
}

export async function searchStationsByText(
  query: string,
  limit = 5,
  trace?: AutocompleteTrace,
): Promise<Suggestion[]> {
  const textQuery = textSearchQuery(query);
  const data = await callGoogle<StationTextSearchResponse>(
    `${PLACES_BASE}/places:searchText`,
    {
      method: 'POST',
      fieldMask: [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.primaryType',
        'places.location',
      ].join(','),
      body: JSON.stringify({
        textQuery,
        languageCode: 'ja',
        regionCode: 'JP',
        // maxResultCount は非推奨。pageSize が後継（1〜20）
        pageSize: 20,
      }),
    },
  );

  const found = (data.places ?? [])
    .map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? '',
      address: p.formattedAddress ?? '',
      primaryType: p.primaryType ?? '',
      location: p.location
        ? { lat: p.location.latitude, lng: p.location.longitude }
        : undefined,
    }))
    // 駅タイプであるか、名前が「〇〇駅」で終わるものだけを残す
    .filter(
      (p) =>
        STATION_PRIMARY_TYPES.includes(p.primaryType) || looksLikeStation(p.name),
    )
    .map(({ primaryType: _primaryType, ...rest }) => rest);

  const ranked = rankByNameMatch(found, query, limit);
  trace?.stages.push({
    name: 'text-search(Googleの生の応答)',
    query: textQuery,
    raw: (data.places ?? []).length,
    kept: found.length,
    names: (data.places ?? []).map((p) => p.displayName?.text ?? ''),
  });
  return ranked;
}

/** 写真の実URLを解決する（キーを露出させないためサーバ経由でリダイレクトする） */
export async function photoUri(
  photoName: string,
  maxWidthPx: number,
): Promise<string> {
  const data = await callGoogle<{ photoUri?: string }>(
    `${PLACES_BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`,
    { method: 'GET' },
  );
  if (!data.photoUri) throw new HttpError(404, '写真が見つかりませんでした。');
  return data.photoUri;
}
