import { useState } from 'react';
import { MAX_GROUPS, useMemberGroupsStore } from '../store/useMemberGroupsStore';
import { useAppStore } from '../store/useAppStore';

type Mode = 'idle' | 'save' | 'update';

/**
 * メンバー入力タブに置く保存・更新の操作。
 *
 * 保存の導線は入力画面側に置く。保存タブの中にあると、
 * 「保存する」操作があること自体に気づきにくいため。
 *
 * 保存済みの構成を読み込んでいる間（activeGroupId がある間）は、
 * その構成名を出して「更新」できるようにする。
 */
export function MemberSaveBar() {
  const groups = useMemberGroupsStore((s) => s.groups);
  const save = useMemberGroupsStore((s) => s.save);
  const update = useMemberGroupsStore((s) => s.update);

  const members = useAppStore((s) => s.members);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const setActiveGroupId = useAppStore((s) => s.setActiveGroupId);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  const [mode, setMode] = useState<Mode>('idle');
  const [name, setName] = useState('');
  const [done, setDone] = useState('');

  const ready = members.filter((m) => m.station?.location);
  const canSubmit = ready.length >= 2 && name.trim().length > 0;

  const flash = (message: string) => {
    setDone(message);
    setTimeout(() => setDone(''), 2500);
  };

  const start = (next: Mode) => {
    setName(next === 'update' ? (activeGroup?.name ?? '') : '');
    setMode(next);
  };

  const close = () => {
    setMode('idle');
    setName('');
  };

  if (mode !== 'idle') {
    const updating = mode === 'update';
    const willOverwrite =
      !updating && groups.some((g) => g.name === name.trim());

    return (
      <section className="rounded-2xl border border-accent bg-accent-soft p-4">
        <label
          htmlFor="group-name"
          className="mb-1 block text-xs font-semibold text-accent-ink"
        >
          {updating ? 'この構成を更新' : 'いまのメンバーを保存'}
        </label>
        <input
          id="group-name"
          type="text"
          value={name}
          autoFocus
          placeholder="例：会社の同期"
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />

        {updating && (
          <p className="mt-1 text-[11px] text-accent-ink">
            いまの{ready.length}人でメンバーを上書きします。名前も変更できます。
          </p>
        )}
        {willOverwrite && (
          <p className="mt-1 text-[11px] text-accent-ink">
            同じ名前の構成を上書きします
          </p>
        )}
        {!updating && groups.length >= MAX_GROUPS && !willOverwrite && (
          <p className="mt-1 text-[11px] text-ink-soft">
            保存は{MAX_GROUPS}件までです。いちばん古いものが消えます。
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-xl border border-line bg-surface px-4 py-2 text-sm text-ink-soft"
          >
            やめる
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (updating && activeGroup) {
                update(activeGroup.id, name, members);
                flash(`「${name.trim()}」を更新しました`);
              } else {
                const id = save(name, members);
                if (id) setActiveGroupId(id);
                flash(`「${name.trim()}」を保存しました`);
              }
              close();
            }}
            className="flex-1 rounded-xl bg-accent py-2 text-sm font-bold text-ink shadow-card disabled:bg-line disabled:text-ink-faint disabled:shadow-none"
          >
            {ready.length < 2
              ? '最寄駅を2人以上入力してください'
              : updating
                ? '更新する'
                : '保存する'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      {done && (
        <p
          role="status"
          className="rounded-xl border border-accent bg-accent-soft px-3 py-2 text-xs text-accent-ink"
        >
          {done}
        </p>
      )}

      {activeGroup ? (
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-ink">
              <span className="font-semibold">「{activeGroup.name}」</span>
              <span className="text-ink-faint">を編集中</span>
            </p>
            <button
              type="button"
              onClick={() => setActiveGroupId(null)}
              className="shrink-0 text-xs text-ink-faint underline"
            >
              編集をやめる
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => start('update')}
              disabled={ready.length < 2}
              className="flex-1 rounded-xl bg-accent py-2 text-sm font-bold text-ink shadow-card disabled:bg-line disabled:text-ink-faint disabled:shadow-none"
            >
              この構成を更新
            </button>
            <button
              type="button"
              onClick={() => start('save')}
              disabled={ready.length < 2}
              className="rounded-xl border border-line px-4 py-2 text-sm text-ink-soft disabled:text-ink-faint"
            >
              別名で保存
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => start('save')}
          disabled={ready.length < 2}
          className="w-full rounded-2xl border border-line bg-surface py-3 text-sm font-medium text-ink shadow-card hover:border-accent hover:text-accent-ink disabled:text-ink-faint disabled:shadow-none"
        >
          {ready.length < 2
            ? 'メンバーを保存（最寄駅を2人以上入力）'
            : 'このメンバーを保存する'}
        </button>
      )}
    </section>
  );
}
