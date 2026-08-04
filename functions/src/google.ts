/**
 * Google Maps Platform への薄いラッパー。
 * APIキーはここ（サーバ側）だけで扱い、クライアントには絶対に出さない。
 */

import { rankByNameMatch } from './util';

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

/** 駅らしい名前か（タイプ絞り込みなしのフォールバック時に使う） */
function looksLikeStation(name: string, address: string): boolean {
  return /駅|停留場|停留所|のりば|Station/i.test(`${name} ${address}`);
}

interface Suggestion {
  placeId: string;
  name: string;
  address: string;
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
export async function autocompleteStations(
  input: string,
  limit = 5,
): Promise<Suggestion[]> {
  const query = input.trim();
  const collected = new Map<string, Suggestion>();

  const add = (list: Suggestion[]) => {
    for (const s of list) if (!collected.has(s.placeId)) collected.set(s.placeId, s);
  };

  try {
    add(await fetchAutocomplete(query, true));
  } catch (e) {
    // タイプ指定がGoogle側の仕様変更で弾かれても検索機能ごと落とさない。
    // 有効化漏れ・キー制限などの本質的なエラーはそのまま投げる。
    if (!(e instanceof HttpError && e.details?.startsWith('INVALID_ARGUMENT'))) {
      throw e;
    }
    console.warn('includedPrimaryTypes が拒否されたためタイプ指定なしで再試行します');
    add(await fetchAutocomplete(query, false));
  }

  let ranked = rankByNameMatch([...collected.values()], query, limit);

  // 駅名一致が足りないときだけ「〇〇駅」で補充する
  if (ranked.length < limit && !/(駅|停留場|停留所)$/.test(query)) {
    try {
      add(await fetchAutocomplete(`${query}駅`, true));
      ranked = rankByNameMatch([...collected.values()], query, limit);
    } catch (e) {
      console.warn('駅名での補充検索に失敗しました', e);
    }
  }

  if (ranked.length > 0) return ranked;

  // フォールバック：タイプで絞らずに引き、駅らしい候補だけ残す
  const loose = await fetchAutocomplete(query, false);
  return rankByNameMatch(
    loose.filter((s) => looksLikeStation(s.name, s.address)),
    query,
    limit,
  );
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
