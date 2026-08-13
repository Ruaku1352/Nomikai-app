import { useMemberGroupsStore } from '../store/useMemberGroupsStore';
import { useAppStore } from '../store/useAppStore';

/**
 * メンバー構成の保存・読み込み。
 *
 * 保存先はブラウザの localStorage だけで、サーバには送らない（個人名を含むため）。
 * 上限は MAX_GROUPS 件で、超える場合は最も古いものが押し出される。
 */
export function SavedGroups({ onApplied }: { onApplied?: () => void }) {
  const groups = useMemberGroupsStore((s) => s.groups);
  const remove = useMemberGroupsStore((s) => s.remove);
  const clearAll = useMemberGroupsStore((s) => s.clearAll);

  const applyMembers = useAppStore((s) => s.applyMembers);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const setActiveGroupId = useAppStore((s) => s.setActiveGroupId);

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          選ぶとメンバーがまとめて入ります
        </p>
        {groups.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirm('保存したメンバーをすべて消去します。よろしいですか？')) {
                clearAll();
                setActiveGroupId(null);
              }
            }}
            className="text-xs text-ink-faint underline"
          >
            すべて消去
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">
          まだ保存されていません。「メンバーを入力」タブの
          <strong className="text-ink-soft">「このメンバーを保存する」</strong>
          から登録できます。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  // 選択した構成は、そのまま編集・更新の対象になる
                  applyMembers(g.members, g.id);
                  onApplied?.();
                }}
                className="flex-1 rounded-xl border border-line px-3 py-2 text-left active:bg-accent-soft"
              >
                <span className="block text-sm font-medium text-ink">
                  {g.name}
                </span>
                <span className="block truncate text-xs text-ink-faint">
                  {g.members.length}人 ・{' '}
                  {/* 名前を付けていれば名前、無ければ駅名で中身が分かるようにする */}
                  {g.members
                    .map((m, i) => m.name.trim() || m.station?.name || `メンバー${i + 1}`)
                    .join('、')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  remove(g.id);
                  if (activeGroupId === g.id) setActiveGroupId(null);
                }}
                aria-label={`${g.name} を削除`}
                className="shrink-0 rounded-lg px-2 py-2 text-xs text-ink-faint hover:text-red-700"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

    </section>
  );
}
