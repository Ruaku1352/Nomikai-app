export interface LatLng {
  lat: number;
  lng: number;
}

/** 参加メンバー1人分の入力 */
export interface Member {
  id: string;
  /** 表示名（未入力なら「メンバーN」） */
  name: string;
  /** 選択済みの最寄駅。未選択なら null */
  station: StationRef | null;
}

/** 駅（Places の場所）への参照 */
export interface StationRef {
  placeId: string;
  name: string;
  address?: string;
  location?: LatLng;
}

export interface AutocompleteSuggestion {
  placeId: string;
  name: string;
  address: string;
}

/** 候補駅 + 各メンバーからの距離 */
export interface CandidateStation {
  placeId: string;
  name: string;
  address?: string;
  location: LatLng;
  /** memberId -> 直線距離(m) */
  distances: Record<string, number>;
  /** 全員分の距離の合計(m) */
  sumMeters: number;
  /** 一番遠い人の距離(m) */
  maxMeters: number;
  /** 平均距離(m) */
  avgMeters: number;
  /** 全員の重心からの距離(m)。同点時のタイブレークに使う */
  centroidMeters: number;
}

export type SortMode = 'sum' | 'max';

export interface Venue {
  placeId: string;
  name: string;
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: string | null;
  photoUrl: string | null;
  address: string | null;
  /** 駅からの直線距離(m) */
  distanceMeters: number | null;
  /** 徒歩の目安（分） */
  walkMinutes: number | null;
  openNow: boolean | null;
  openingHours: string[] | null;
  mapsUrl: string;
  /** rating * log(count + 1) */
  weightedScore: number;
  /** どのジャンルで引っかかったか */
  genre: string;
}

export interface VenueGroup {
  genre: string;
  venues: Venue[];
}

export interface ResultPayload {
  createdAt: number;
  sortMode: SortMode;
  members: Member[];
  genres: string[];
  stations: CandidateStation[];
  /** stationPlaceId -> ジャンル別の店リスト */
  venuesByStation: Record<string, VenueGroup[]>;
}
