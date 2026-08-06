/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 明るい配色。色名は用途で付けているので、色を変えたいときはここだけ直せばよい。
        // 色名は Tailwind 標準のユーティリティ名と衝突しないものにする。
        // 例: base にすると text-base（フォントサイズ）が文字色として再定義され、
        // text-base を使っている箇所の文字色が壊れる。
        canvas: '#F7F4EE', // 画面の背景（生成り。暖簾の紙のイメージ）
        surface: '#FFFFFF', // カード・入力欄
        ink: '#16233D', // 主要な文字（アイコンの藍色と同じ）
        'ink-soft': '#4A5875', // 補足の文字
        'ink-faint': '#6B7590', // さらに弱い文字・プレースホルダ
        line: '#E5DFD3', // 罫線・枠線
        accent: '#E9A13B', // ボタンや選択中（アイコンのビールの琥珀）
        'accent-ink': '#A9660C', // 明るい背景の上に置く accent 色の文字
        'accent-soft': '#FDF1DE', // 選択中の淡い背景
      },
      boxShadow: {
        card: '0 1px 2px rgba(22, 35, 61, 0.06), 0 4px 12px rgba(22, 35, 61, 0.05)',
      },
    },
  },
  plugins: [],
};
