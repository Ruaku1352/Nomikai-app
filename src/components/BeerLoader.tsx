/**
 * 検索中に出すビールのアニメーション。
 *
 * モチーフと色は public/icon.svg のジョッキに合わせている
 * （背景 #16233D / ビール #F2A63B / 泡 #FFF4E2）。
 * 動きは CSS アニメーションのみで、ライブラリは使わない。
 * `prefers-reduced-motion` が有効な環境では、満杯のジョッキを静止表示する
 * （アニメーションの停止は src/index.css 側でまとめて行う）。
 */
export function BeerLoader({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        viewBox="0 0 160 160"
        className="h-32 w-32"
        role="img"
        aria-label="検索中"
      >
        <rect width="160" height="160" rx="36" fill="#16233D" />

        {/* 取っ手 */}
        <path
          d="M112,64 Q140,64 140,88 Q140,112 112,112"
          fill="none"
          stroke="#D9862A"
          strokeWidth="12"
          strokeLinecap="round"
        />

        {/* ジョッキの中身。clipPath でジョッキの形に切り抜く */}
        <defs>
          <clipPath id="mug">
            <path d="M36,48 H112 V116 Q112,132 96,132 H52 Q36,132 36,116 Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#mug)">
          <rect x="36" y="48" width="76" height="84" fill="#F7F4EE" />
          {/* 下から注がれて満ちていくビール */}
          <rect
            className="beer-fill"
            x="36"
            y="48"
            width="76"
            height="84"
            fill="#F2A63B"
          />
          {/* 立ちのぼる泡 */}
          <circle className="beer-bubble beer-bubble-1" cx="56" r="4" fill="#FFF4E2" />
          <circle className="beer-bubble beer-bubble-2" cx="76" r="3" fill="#FFF4E2" />
          <circle className="beer-bubble beer-bubble-3" cx="95" r="5" fill="#FFF4E2" />
        </g>

        {/* ジョッキの縁 */}
        <path
          d="M36,48 H112 V116 Q112,132 96,132 H52 Q36,132 36,116 Z"
          fill="none"
          stroke="#FFF4E2"
          strokeWidth="7"
          strokeLinejoin="round"
        />
        {/* 上の泡 */}
        <path
          className="beer-foam"
          d="M32,48 V38 Q32,22 48,26 Q57,12 72,20 Q86,10 99,21 Q112,13 118,26 Q134,22 133,40 V48 Z"
          fill="#FFF4E2"
        />
      </svg>

      <p className="text-sm font-medium text-ink-soft">{message}</p>
    </div>
  );
}
