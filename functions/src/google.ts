/**
 * Google Maps Platform への薄いラッパー。
 * APIキーはここ（サーバ側）だけで扱い、クライアントには絶対に出さない。
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';
const ROUTES_BASE = 'https://routes.googleapis.com';

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

/* ---------------------------------------------------------------- Routes */

export interface RouteResult {
  /** 分。到達不能なら null */
  minutes: number | null;
  /** 乗換回数。取得できなければ null */
  transfers: number | null;
}

interface MatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  condition?: string;
}

/**
 * 4.2 所要時間マトリクス。
 * ComputeRouteMatrix なら「人数×候補駅」分を 1 コールで取得できるのでこちらを優先し、
 * 失敗した場合のみ ComputeRoutes を1組ずつ叩くフォールバックに落ちる。
 */
export async function transitMatrix(
  origins: LatLng[],
  destinations: LatLng[],
  departureTime: string | null,
): Promise<RouteResult[][]> {
  const body = {
    origins: origins.map((o) => ({
      waypoint: {
        location: {
          latLng: { latitude: o.lat, longitude: o.lng },
        },
      },
    })),
    destinations: destinations.map((d) => ({
      waypoint: {
        location: { latLng: { latitude: d.lat, longitude: d.lng } },
      },
    })),
    travelMode: 'TRANSIT',
    ...(departureTime ? { departureTime } : {}),
  };

  try {
    const res = await fetch(
      `${ROUTES_BASE}/distanceMatrix/v2:computeRouteMatrix`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey(),
          'X-Goog-FieldMask':
            'originIndex,destinationIndex,duration,condition',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('computeRouteMatrix failed, falling back', res.status, text);
      throw new Error('matrix-unavailable');
    }
    const elements = (await res.json()) as MatrixElement[];
    const grid: RouteResult[][] = origins.map(() =>
      destinations.map(() => ({ minutes: null, transfers: null })),
    );
    for (const el of elements) {
      const o = el.originIndex ?? 0;
      const d = el.destinationIndex ?? 0;
      if (!grid[o]?.[d]) continue;
      const ok = el.condition === 'ROUTE_EXISTS' && el.duration;
      grid[o][d] = {
        minutes: ok ? parseDurationSeconds(el.duration!) / 60 : null,
        // マトリクスは乗換回数を返さないため null
        transfers: null,
      };
    }
    return grid;
  } catch {
    return computeRoutesFallback(origins, destinations, departureTime);
  }
}

interface ComputeRoutesResponse {
  routes?: {
    duration?: string;
    legs?: { steps?: { travelMode?: string }[] }[];
  }[];
}

/** 1組ずつ ComputeRoutes を叩く。コール数が増えるので同時実行数を絞る。 */
async function computeRoutesFallback(
  origins: LatLng[],
  destinations: LatLng[],
  departureTime: string | null,
): Promise<RouteResult[][]> {
  const grid: RouteResult[][] = origins.map(() =>
    destinations.map(() => ({ minutes: null, transfers: null })),
  );

  const jobs: { o: number; d: number }[] = [];
  origins.forEach((_, o) =>
    destinations.forEach((__, d) => jobs.push({ o, d })),
  );

  const CONCURRENCY = 5;
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        grid[job.o][job.d] = await computeRoute(
          origins[job.o],
          destinations[job.d],
          departureTime,
        );
      } catch (e) {
        console.warn('computeRoutes failed', e);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker),
  );
  return grid;
}

async function computeRoute(
  origin: LatLng,
  destination: LatLng,
  departureTime: string | null,
): Promise<RouteResult> {
  const data = await callGoogle<ComputeRoutesResponse>(
    `${ROUTES_BASE}/directions/v2:computeRoutes`,
    {
      method: 'POST',
      fieldMask: 'routes.duration,routes.legs.steps.travelMode',
      body: JSON.stringify({
        origin: {
          location: {
            latLng: { latitude: origin.lat, longitude: origin.lng },
          },
        },
        destination: {
          location: {
            latLng: { latitude: destination.lat, longitude: destination.lng },
          },
        },
        travelMode: 'TRANSIT',
        languageCode: 'ja',
        ...(departureTime ? { departureTime } : {}),
      }),
    },
  );

  const route = data.routes?.[0];
  if (!route?.duration) return { minutes: null, transfers: null };

  const transitSteps =
    route.legs
      ?.flatMap((l) => l.steps ?? [])
      .filter((s) => s.travelMode === 'TRANSIT').length ?? 0;

  return {
    minutes: parseDurationSeconds(route.duration) / 60,
    transfers: transitSteps > 0 ? transitSteps - 1 : null,
  };
}

/** "1234s" 形式の Duration を秒に変換 */
function parseDurationSeconds(duration: string): number {
  return Number.parseFloat(duration.replace(/s$/, '')) || 0;
}
