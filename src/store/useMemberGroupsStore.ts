import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Member } from '../types';

/**
 * 名前を付けて保存したメンバー構成（例：「会社の同期」）。
 *
 * **個人名を含むため、保存先はブラウザの localStorage だけ。サーバには送らない。**
 * 検索結果の永続化（useAppStore）とは別キーで管理する。
 */
export interface MemberGroup {
  id: string;
  name: string;
  members: Member[];
  savedAt: number;
}

/** 保存できる構成の上限。超えたら古いものから消す */
export const MAX_GROUPS = 10;

interface MemberGroupsState {
  groups: MemberGroup[];
  /**
   * 同名の構成があれば上書き、無ければ追加。上限を超えたら最も古いものを捨てる。
   * 追加した構成の id を返すので、呼び出し側で「編集中」の対象にできる。
   */
  save: (name: string, members: Member[]) => string | null;
  /** 既存の構成を、名前ごと差し替える（並び順と id は保つ） */
  update: (id: string, name: string, members: Member[]) => void;
  remove: (id: string) => void;
  /** 保存した構成をすべて消す（個人情報を残さないための導線） */
  clearAll: () => void;
}

/** 駅が確定しているメンバーだけを、参照を切って取り出す */
function confirmedMembers(members: Member[]): Member[] {
  return members.filter((m) => m.station?.location).map((m) => ({ ...m }));
}

export const useMemberGroupsStore = create<MemberGroupsState>()(
  persist(
    (set) => ({
      groups: [],

      save: (name, members) => {
        const trimmed = name.trim();
        const keep = confirmedMembers(members);
        if (!trimmed || keep.length === 0) return null;

        const entry: MemberGroup = {
          id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: trimmed,
          members: keep,
          savedAt: Date.now(),
        };
        set((s) => {
          // 同名は上書き
          const others = s.groups.filter((g) => g.name !== trimmed);
          return { groups: [entry, ...others].slice(0, MAX_GROUPS) };
        });
        return entry.id;
      },

      update: (id, name, members) =>
        set((s) => {
          const trimmed = name.trim();
          const keep = confirmedMembers(members);
          if (!trimmed || keep.length === 0) return s;
          if (!s.groups.some((g) => g.id === id)) return s;

          return {
            groups: s.groups
              // 別の構成が同じ名前を持っていたら、そちらを畳む
              .filter((g) => g.id === id || g.name !== trimmed)
              .map((g) =>
                g.id === id
                  ? { ...g, name: trimmed, members: keep, savedAt: Date.now() }
                  : g,
              ),
          };
        }),

      remove: (id) =>
        set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),

      clearAll: () => set({ groups: [] }),
    }),
    { name: 'nomikai-app-member-groups', version: 1 },
  ),
);
