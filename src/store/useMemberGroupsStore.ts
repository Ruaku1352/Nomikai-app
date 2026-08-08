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
  /** 同名の構成があれば上書き、無ければ追加。上限を超えたら最も古いものを捨てる */
  save: (name: string, members: Member[]) => void;
  remove: (id: string) => void;
  /** 保存した構成をすべて消す（個人情報を残さないための導線） */
  clearAll: () => void;
}

export const useMemberGroupsStore = create<MemberGroupsState>()(
  persist(
    (set) => ({
      groups: [],

      save: (name, members) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          // 駅が確定しているメンバーだけを保存する
          const keep = members
            .filter((m) => m.station?.location)
            .map((m) => ({ ...m }));
          if (keep.length === 0) return s;

          const entry: MemberGroup = {
            id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            name: trimmed,
            members: keep,
            savedAt: Date.now(),
          };
          // 同名は上書き
          const others = s.groups.filter((g) => g.name !== trimmed);
          const next = [entry, ...others];
          return { groups: next.slice(0, MAX_GROUPS) };
        }),

      remove: (id) =>
        set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),

      clearAll: () => set({ groups: [] }),
    }),
    { name: 'nomikai-app-member-groups', version: 1 },
  ),
);
