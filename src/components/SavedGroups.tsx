import { useState } from 'react';
import { MAX_GROUPS, useMemberGroupsStore } from '../store/useMemberGroupsStore';
import { useAppStore } from '../store/useAppStore';

/**
 * メンバー構成の保存・読み込み。
 *
 * 保存先はブラウザの localStorage だけで、サーバには送らない（個人名を含むため）。
 * 上限は MAX_GROUPS 件で、超える場合は最も古いものが押し出される。
 */
export function SavedGroups() {
  const groups = useMemberGroupsStore((s) => s.groups);
  const save = useMemberGroupsStore((s) => s.save);
  const remove = useMemberGroupsStore((s) => s.remove);
  const clearAll = useMemberGroupsStore((s) => s.clearAll);

  const members = useAppStore((s) => s.members);
  const applyMembers = useAppStore((s) => s.applyMembers);

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const ready = members.filter((m) => m.station?.location);
  const canSave = ready.length >= 2 && name.trim().length > 0;
  const willOverwrite = groups.some((g) => g.name === name.trim());

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">保存したメンバー</h2>
        {groups.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirm('保存したメンバーをすべて消去します。よろしいですか？')) {
                clearAll();
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
          よく集まるメンバーに名前を付けて保存しておくと、次回から選ぶだけで入力できます。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => applyMembers(g.members)}
                className="flex-1 rounded-xl border border-line px-3 py-2 text-left active:bg-accent-soft"
              >
                <span className="block text-sm font-medium text-ink">
                  {g.name}
                </span>
                <span className="block truncate text-xs text-ink-faint">
                  {g.members.length}人 ・{' '}
                  {g.members.map((m) => m.station?.name).join('、')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(g.id)}
                aria-label={`${g.name} を削除`}
                className="shrink-0 rounded-lg px-2 py-2 text-xs text-ink-faint hover:text-red-700"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      {saving ? (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="例：会社の同期"
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {willOverwrite && (
            <p className="text-[11px] text-accent-ink">
              同じ名前の構成を上書きします
            </p>
          )}
          {groups.length >= MAX_GROUPS && !willOverwrite && (
            <p className="text-[11px] text-ink-faint">
              保存は{MAX_GROUPS}件までです。いちばん古いものが消えます。
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSaving(false);
                setName('');
              }}
              className="rounded-xl border border-line px-4 py-2 text-sm text-ink-soft"
            >
              やめる
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => {
                save(name, members);
                setSaving(false);
                setName('');
              }}
              className="flex-1 rounded-xl bg-accent py-2 text-sm font-bold text-ink disabled:bg-line disabled:text-ink-faint"
            >
              {ready.length < 2 ? '最寄駅を2人以上入力してください' : '保存する'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSaving(true)}
          disabled={ready.length < 2}
          className="mt-3 w-full rounded-xl border border-dashed border-line py-2 text-xs text-ink-soft hover:border-accent hover:text-accent-ink disabled:border-line disabled:text-ink-faint"
        >
          いまのメンバーに名前を付けて保存
        </button>
      )}
    </section>
  );
}
