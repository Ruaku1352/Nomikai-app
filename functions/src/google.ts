/**
 * Google Maps Platform への薄いラッパー。
 * APIキーはここ（サーバ側）だけで扱い、クライアントには絶対に出さない。
 */

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
  ) {
    super(message);
  }
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
    // 上流のエラー本文はキー情報を含みうるのでクライアントには返さない
    throw new HttpError(
      res.status === 429 ? 429 : 502,
      res.status === 429
        ? 'リクエストが多すぎます。少し待って再試行してください。'
        : '地図サービスへの問い合わせに失敗しました。',
    );
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

export async function autocompleteStations(input: string) {
  const data = await callGoogle<AutocompleteResponse>(
    `${PLACES_BASE}/places:autocomplete`,
    {
      method: 'POST',
      body: JSON.stringify({
        input,
        // 駅だけに絞る（includedPrimaryTypes は最大5件）
        includedPrimaryTypes: ['train_station', 'subway_station'],
        languageCode: 'ja',
        regionCode: 'JP',
      }),
    },
  );

  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      address: p.structuredFormat?.secondaryText?.text ?? '',
    }));
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
