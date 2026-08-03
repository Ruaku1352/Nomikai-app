import { useAppStore } from '../store/useAppStore';
import { StationInput } from '../components/StationInput';

export function MembersScreen() {
  const members = useAppStore((s) => s.members);
  const setMemberCount = useAppStore((s) => s.setMemberCount);
  const addMember = useAppStore((s) => s.addMember);
  const removeMember = useAppStore((s) => s.removeMember);
  const updateMemberName = useAppStore((s) => s.updateMemberName);
  const setMemberStation = useAppStore((s) => s.setMemberStation);
  const setStep = useAppStore((s) => s.setStep);

  const filled = members.filter((m) => m.station?.location).length;
  const canProceed = filled >= 2;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-white">メンバーの最寄駅</h1>
        <p className="mt-1 text-sm text-white/50">
          飲み会直前にいる場所の最寄駅を入力してください。
        </p>
      </header>

      <div className="flex items-center gap-3">
        <label htmlFor="count" className="text-sm text-white/70">
          人数
        </label>
        <input
          id="count"
          type="number"
          min={2}
          max={10}
          value={members.length}
          onChange={(e) => setMemberCount(Number(e.target.value))}
          className="w-20 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-accent focus:outline-none"
        />
        <span className="text-xs text-white/40">2〜10人</span>
      </div>

      <ul className="space-y-4">
        {members.map((m, i) => (
          <li key={m.id} className="rounded-2xl border border-white/10 bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <input
                type="text"
                value={m.name}
                placeholder={`メンバー${i + 1}`}
                onChange={(e) => updateMemberName(m.id, e.target.value)}
                className="w-40 bg-transparent text-sm font-semibold text-white placeholder:text-white/40 focus:outline-none"
              />
              {members.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeMember(m.id)}
                  className="text-xs text-white/40 hover:text-red-400"
                >
                  削除
                </button>
              )}
            </div>
            <StationInput
              value={m.station}
              onChange={(station) => setMemberStation(m.id, station)}
            />
          </li>
        ))}
      </ul>

      {members.length < 10 && (
        <button
          type="button"
          onClick={addMember}
          className="w-full rounded-xl border border-dashed border-white/20 py-3 text-sm text-white/60 hover:border-accent hover:text-accent"
        >
          ＋ メンバーを追加
        </button>
      )}

      <button
        type="button"
        disabled={!canProceed}
        onClick={() => setStep('genres')}
        className="w-full rounded-xl bg-accent py-4 text-base font-bold text-black disabled:bg-white/10 disabled:text-white/30"
      >
        {canProceed ? '次へ：ジャンルを選ぶ' : '最寄駅を2人以上入力してください'}
      </button>
    </div>
  );
}
