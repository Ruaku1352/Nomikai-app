import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  CandidateStation,
  Member,
  ResultPayload,
  SortMode,
  StationRef,
  VenueGroup,
} from '../types';
import { fetchCandidates, fetchVenues } from '../lib/api';
import { rankStations } from '../lib/scoring';

export const DEFAULT_GENRES = [
  '居酒屋',
  '焼肉',
  'しゃぶしゃぶ',
  '寿司',
] as const;

export type Step = 'members' | 'genres' | 'result';

const newMember = (index: number): Member => ({
  id: `m${Date.now().toString(36)}${index}${Math.random().toString(36).slice(2, 6)}`,
  name: '',
  station: null,
});

interface AppState {
  step: Step;
  members: Member[];
  genres: string[];
  /** 自由入力ジャンル（「その他」欄） */
  customGenre: string;
  /** 集合したい時間帯（HH:mm）。営業時間フィルタと出発時刻に使う */
  meetTime: string;
  sortMode: SortMode;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  /** 最後に計算した結果。オフラインでも閲覧できるよう永続化する */
  result: ResultPayload | null;

  setStep: (step: Step) => void;
  addMember: () => void;
  removeMember: (id: string) => void;
  setMemberCount: (count: number) => void;
  updateMemberName: (id: string, name: string) => void;
  setMemberStation: (id: string, station: StationRef | null) => void;
  toggleGenre: (genre: string) => void;
  setCustomGenre: (value: string) => void;
  setMeetTime: (value: string) => void;
  setSortMode: (mode: SortMode) => void;
  clearError: () => void;
  reset: () => void;
  /** 選択中ジャンルの実効リスト（自由入力を含む） */
  effectiveGenres: () => string[];
  search: () => Promise<void>;
  /** 指標を切り替えて新しく上位に来た駅の店舗を、必要になった時だけ取りに行く */
  ensureVenues: (placeId: string) => Promise<void>;
}

const MAX_MEMBERS = 10;
const MIN_MEMBERS = 2;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      step: 'members',
      members: [newMember(0), newMember(1)],
      genres: ['居酒屋'],
      customGenre: '',
      meetTime: '',
      sortMode: 'sum',
      loading: false,
      loadingMessage: '',
      error: null,
      result: null,

      setStep: (step) => set({ step }),

      addMember: () =>
        set((s) =>
          s.members.length >= MAX_MEMBERS
            ? s
            : { members: [...s.members, newMember(s.members.length)] },
        ),

      removeMember: (id) =>
        set((s) =>
          s.members.length <= MIN_MEMBERS
            ? s
            : { members: s.members.filter((m) => m.id !== id) },
        ),

      setMemberCount: (count) =>
        set((s) => {
          const target = Math.min(MAX_MEMBERS, Math.max(MIN_MEMBERS, count));
          if (target === s.members.length) return s;
          if (target < s.members.length) {
            return { members: s.members.slice(0, target) };
          }
          const added = Array.from({ length: target - s.members.length }, (_, i) =>
            newMember(s.members.length + i),
          );
          return { members: [...s.members, ...added] };
        }),

      updateMemberName: (id, name) =>
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? { ...m, name } : m)),
        })),

      setMemberStation: (id, station) =>
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? { ...m, station } : m)),
        })),

      toggleGenre: (genre) =>
        set((s) => ({
          genres: s.genres.includes(genre)
            ? s.genres.filter((g) => g !== genre)
            : [...s.genres, genre],
        })),

      setCustomGenre: (customGenre) => set({ customGenre }),
      setMeetTime: (meetTime) => set({ meetTime }),
      setSortMode: (sortMode) => set({ sortMode }),
      clearError: () => set({ error: null }),

      reset: () =>
        set({
          step: 'members',
          members: [newMember(0), newMember(1)],
          genres: ['居酒屋'],
          customGenre: '',
          meetTime: '',
          result: null,
          error: null,
        }),

      effectiveGenres: () => {
        const { genres, customGenre } = get();
        const custom = customGenre.trim();
        return custom ? [...genres, custom] : [...genres];
      },

      search: async () => {
        const { members, meetTime, sortMode } = get();
        const ready = members.filter((m) => m.station?.location);
        if (ready.length < MIN_MEMBERS) {
          set({ error: '最寄駅を2人以上入力してください。' });
          return;
        }
        const genres = get().effectiveGenres();
        if (genres.length === 0) {
          set({ error: 'ジャンルを1つ以上選択してください。' });
          return;
        }

        set({
          loading: true,
          error: null,
          loadingMessage: '候補駅と所要時間を計算中…',
        });

        try {
          const departureTime = meetTime ? toIsoDeparture(meetTime) : null;
          const { stations } = await fetchCandidates({
            members: ready,
            departureTime,
          });

          const top: CandidateStation[] = rankStations(stations, sortMode, 3);
          if (top.length === 0) {
            set({
              loading: false,
              loadingMessage: '',
              error:
                '全員が電車で到達できる候補駅が見つかりませんでした。駅名を見直すか、時間帯を変えて試してください。',
            });
            return;
          }

          set({ loadingMessage: 'お店を検索中…' });

          const venuesByStation: Record<string, VenueGroup[]> = {};
          for (const station of top) {
            const { groups } = await fetchVenues({
              station: {
                placeId: station.placeId,
                name: station.name,
                location: station.location,
              },
              genres,
              openAt: departureTime,
            });
            venuesByStation[station.placeId] = groups;
          }

          set({
            loading: false,
            loadingMessage: '',
            step: 'result',
            result: {
              createdAt: Date.now(),
              sortMode,
              members: ready,
              genres,
              // 上位3駅だけでなく全候補を保持しておき、指標の切替を再計算なしで行う
              stations,
              venuesByStation,
            },
          });
        } catch (e) {
          set({
            loading: false,
            loadingMessage: '',
            error:
              e instanceof Error
                ? e.message
                : '不明なエラーが発生しました。時間をおいて再試行してください。',
          });
        }
      },

      ensureVenues: async (placeId) => {
        const { result, meetTime } = get();
        if (!result) return;
        if (result.venuesByStation[placeId]) return;
        const station = result.stations.find((s) => s.placeId === placeId);
        if (!station) return;

        set({ loading: true, loadingMessage: 'お店を検索中…', error: null });
        try {
          const { groups } = await fetchVenues({
            station: {
              placeId: station.placeId,
              name: station.name,
              location: station.location,
            },
            genres: result.genres,
            openAt: meetTime ? toIsoDeparture(meetTime) : null,
          });
          set((s) => ({
            loading: false,
            loadingMessage: '',
            result: s.result
              ? {
                  ...s.result,
                  venuesByStation: {
                    ...s.result.venuesByStation,
                    [placeId]: groups,
                  },
                }
              : s.result,
          }));
        } catch (e) {
          set({
            loading: false,
            loadingMessage: '',
            error:
              e instanceof Error ? e.message : 'お店の取得に失敗しました。',
          });
        }
      },
    }),
    {
      name: 'nomikai-app',
      partialize: (s) => ({
        members: s.members,
        genres: s.genres,
        customGenre: s.customGenre,
        meetTime: s.meetTime,
        sortMode: s.sortMode,
        result: s.result,
      }),
    },
  ),
);

/** "19:30" → 直近のその時刻のISO文字列（過ぎていれば翌日） */
function toIsoDeparture(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
}
