import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import express from 'express';
import cors from 'cors';
import {
  HttpError,
  autocompleteStations,
  nearbyStations,
  photoUri,
  placeDetails,
  searchVenues,
  type AutocompleteTrace,
  type LatLng,
} from './google';
import {
  haversineMeters,
  isOpenAt,
  summarizeCosts,
  weightedScore,
} from './util';

/**
 * APIキーは Secret Manager 経由で注入する。
 *   firebase functions:secrets:set GOOGLE_MAPS_API_KEY
 * ローカルは functions/.env に GOOGLE_MAPS_API_KEY=... を置けば読まれる。
 */
const GOOGLE_MAPS_API_KEY = defineSecret('GOOGLE_MAPS_API_KEY');

/** 候補駅の上限。Nearby Search の結果からこの件数まで絞る。 */
const MAX_CANDIDATES = 15;
/** 店を探す半径（駅からの徒歩圏） */
const VENUE_RADIUS_METERS = 800;
/** 徒歩の目安速度（m/分） */
const WALK_SPEED = 80;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '256kb' }));

const router = express.Router();

/**
 * Express 4 は async ハンドラの reject を拾ってくれないので、
 * 明示的に next() に渡してエラーハンドラまで届ける。
 */
const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    fn(req, res).catch(next);
  };

/** オートコンプリートで返す候補の件数 */
const AUTOCOMPLETE_LIMIT = 5;

/**
 * デプロイされているビルドの識別子。
 * 「直したはずなのに直っていない」ときに、実際に動いている版を確認するために返す。
 */
const API_VERSION = '2026-08-04-stations-v3';

router.get(
  '/stations/autocomplete',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    // 1文字から引く（「渋」「新」でも候補を出す）
    if (q.length < 1) {
      res.json({ suggestions: [] });
      return;
    }
    const limit = Math.min(
      10,
      Math.max(1, Number(req.query.limit ?? AUTOCOMPLETE_LIMIT) || AUTOCOMPLETE_LIMIT),
    );

    // ?debug=1 でどの段階が何件返したかを一緒に返す（切り分け用。キーは含まない）
    if (req.query.debug) {
      const trace: AutocompleteTrace = { stages: [], source: 'none' };
      const suggestions = await autocompleteStations(q, limit, trace);
      res.json({ apiVersion: API_VERSION, receivedQuery: q, suggestions, trace });
      return;
    }

    res.json({ suggestions: await autocompleteStations(q, limit) });
  }),
);

/**
 * 設定の切り分け用。APIキーが読めているか、Places API (New) が実際に叩けるかを返す。
 * Autocomplete を1回だけ実行する（キー自体は絶対に返さない）。
 */
router.get(
  '/diag',
  wrap(async (_req, res) => {
    const keyConfigured = Boolean(process.env.GOOGLE_MAPS_API_KEY);
    if (!keyConfigured) {
      res.json({
        apiVersion: API_VERSION,
        keyConfigured: false,
        ok: false,
        hint: 'functions/.env に GOOGLE_MAPS_API_KEY を設定するか、Secret Manager に登録してください。',
      });
      return;
    }
    try {
      const trace: AutocompleteTrace = { stages: [], source: 'none' };
      const suggestions = await autocompleteStations('渋谷', 5, trace);
      res.json({
        apiVersion: API_VERSION,
        keyConfigured: true,
        ok: suggestions.length > 0,
        sampleQuery: '渋谷',
        resultCount: suggestions.length,
        samples: suggestions.map((s) => s.name),
        trace,
      });
    } catch (e) {
      const err = e as HttpError;
      res.json({
        apiVersion: API_VERSION,
        keyConfigured: true,
        ok: false,
        error: err.message,
        details: err.details ?? null,
      });
    }
  }),
);

router.get(
  '/stations/:placeId',
  wrap(async (req, res) => {
    res.json(await placeDetails(req.params.placeId));
  }),
);

interface CandidateRequestMember {
  id: string;
  name?: string;
  location: LatLng;
  stationName?: string;
}

/**
 * 4.1 候補駅のリストアップ + 4.2 距離の算出。
 *
 * 所要時間ではなく直線距離で評価する。Routes API の TRANSIT モードは
 * 日本国内の公共交通をサポートしておらず（200 OK のまま routes が空で返る）、
 * 電車の所要時間は取得できないため。詳細は docs/spec.md の 2.2 を参照。
 */
router.post(
  '/candidates',
  wrap(async (req, res) => {
  const members = (req.body?.members ?? []) as CandidateRequestMember[];
  const requested = Number(req.body?.maxCandidates ?? 12);

  if (!Array.isArray(members) || members.length < 2) {
    throw new HttpError(400, 'メンバーを2人以上指定してください。');
  }
  if (members.some((m) => !m.id || !isFiniteLatLng(m.location))) {
    throw new HttpError(400, 'メンバーの位置情報が不正です。');
  }

  const limit = Math.min(
    MAX_CANDIDATES,
    Math.max(3, Number.isFinite(requested) ? requested : 12),
  );

  // 全員の駅の重心
  const center: LatLng = {
    lat: members.reduce((a, m) => a + m.location.lat, 0) / members.length,
    lng: members.reduce((a, m) => a + m.location.lng, 0) / members.length,
  };

  // 重心から一番遠いメンバーまでの距離を基準に検索半径を決める。
  // 全員が近い時に半径が小さくなりすぎないよう下限2km、上限は Nearby Search の50km。
  const spread = Math.max(
    ...members.map((m) => haversineMeters(center, m.location)),
  );
  const radius = Math.min(50_000, Math.max(2_000, spread * 0.6));

  const found = await nearbyStations(center, radius);

  // 近すぎる駅は同じ駅の別出口なども多いので間引く（400m以内は1つに）
  const candidates: typeof found = [];
  for (const station of found) {
    if (candidates.length >= limit) break;
    const tooClose = candidates.some(
      (c) => haversineMeters(c.location, station.location) < 400,
    );
    if (!tooClose) candidates.push(station);
  }

  if (candidates.length === 0) {
    res.json({ stations: [] });
    return;
  }

  // 距離の計算に外部APIは不要。全メンバー × 全候補駅をその場で算出する。
  const stations = candidates.map((station) => {
    const distances: Record<string, number> = {};
    members.forEach((m) => {
      distances[m.id] = Math.round(
        haversineMeters(m.location, station.location),
      );
    });

    const { sum, max, avg } = summarizeCosts(Object.values(distances));

    return {
      ...station,
      distances,
      sumMeters: Math.round(sum),
      maxMeters: Math.round(max),
      avgMeters: Math.round(avg),
      // 同点時のタイブレーク用（重心に近い駅を優先する）
      centroidMeters: Math.round(haversineMeters(center, station.location)),
    };
  });

  res.json({ stations });
  }),
);

/** 4.4 店舗検索・ソート */
router.post(
  '/venues',
  wrap(async (req, res) => {
  const station = req.body?.station as
    | { placeId: string; name: string; location: LatLng }
    | undefined;
  const genres = (req.body?.genres ?? []) as string[];
  const openAt = (req.body?.openAt ?? null) as string | null;

  if (!station || !isFiniteLatLng(station.location)) {
    throw new HttpError(400, '駅の情報が不正です。');
  }
  if (!Array.isArray(genres) || genres.length === 0) {
    throw new HttpError(400, 'ジャンルを1つ以上指定してください。');
  }

  const target = openAt ? new Date(openAt) : null;
  const validTarget =
    target && !Number.isNaN(target.getTime()) ? target : null;

  const groups = await Promise.all(
    genres.slice(0, 5).map(async (genre) => {
      const places = await searchVenues({
        textQuery: `${genre} ${station.name}`,
        center: station.location,
        radiusMeters: VENUE_RADIUS_METERS,
        openNow: false,
      });

      const venues = places
        .filter((p) => p.location)
        .filter((p) =>
          validTarget ? isOpenAt(p.regularOpeningHours, validTarget) : true,
        )
        .map((p) => {
          const distance = haversineMeters(station.location, {
            lat: p.location!.latitude,
            lng: p.location!.longitude,
          });
          return {
            placeId: p.id,
            name: p.displayName?.text ?? '',
            rating: p.rating ?? null,
            userRatingCount: p.userRatingCount ?? null,
            priceLevel: formatPriceLevel(p.priceLevel),
            photoUrl: p.photos?.[0]?.name
              ? `/api/photo?name=${encodeURIComponent(p.photos[0].name)}`
              : null,
            address: p.formattedAddress ?? null,
            distanceMeters: Math.round(distance),
            walkMinutes: Math.max(1, Math.round(distance / WALK_SPEED)),
            openNow: p.currentOpeningHours?.openNow ?? null,
            openingHours:
              p.regularOpeningHours?.weekdayDescriptions ??
              p.currentOpeningHours?.weekdayDescriptions ??
              null,
            mapsUrl:
              p.googleMapsUri ??
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                p.displayName?.text ?? '',
              )}&query_place_id=${p.id}`,
            weightedScore: weightedScore(p.rating, p.userRatingCount),
            genre,
          };
        })
        .sort((a, b) => b.weightedScore - a.weightedScore)
        .slice(0, 3);

      return { genre, venues };
    }),
  );

  res.json({ groups });
  }),
);

/**
 * 写真プロキシ。photoUri は署名付きの一時URLなので、キーを晒さずに302で流す。
 * Places の画像はキャッシュ制限があるため長期キャッシュしない。
 */
router.get(
  '/photo',
  wrap(async (req, res) => {
  const name = String(req.query.name ?? '');
  const width = Math.min(1600, Math.max(100, Number(req.query.w ?? 400)));
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(name)) {
    throw new HttpError(400, '写真の指定が不正です。');
  }
  const uri = await photoUri(name, width);
  res.set('Cache-Control', 'private, max-age=600');
  res.redirect(302, uri);
  }),
);

// Hosting の rewrite 経由（/api/**）でも Emulator 直叩き（/<fn>/**）でも動くようにする
app.use('/api', router);
app.use('/', router);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }
    console.error('Unhandled error', err);
    res.status(500).json({ error: 'サーバでエラーが発生しました。' });
  },
);

export const api = onRequest(
  {
    region: 'asia-northeast1',
    secrets: [GOOGLE_MAPS_API_KEY],
    // 課金の暴走を防ぐための保険
    maxInstances: 10,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  app,
);

function isFiniteLatLng(v: unknown): v is LatLng {
  const p = v as LatLng | undefined;
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

function formatPriceLevel(level: string | undefined): string | null {
  switch (level) {
    case 'PRICE_LEVEL_FREE':
      return '無料';
    case 'PRICE_LEVEL_INEXPENSIVE':
      return '¥';
    case 'PRICE_LEVEL_MODERATE':
      return '¥¥';
    case 'PRICE_LEVEL_EXPENSIVE':
      return '¥¥¥';
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return '¥¥¥¥';
    default:
      return null;
  }
}
