/**
 * public/icon.svg と public/icon-maskable.svg から PWA 用の PNG を書き出す。
 *
 *   npm run icons
 *
 * SVG を編集したらこれを実行して PNG を作り直す。
 * 生成物はデプロイに必要なのでリポジトリにコミットする（.gitignore に入れない）。
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = (name) => resolve(root, 'public', name);

/** [元SVG, 出力先, 一辺のpx] */
const targets = [
  ['icon.svg', 'public/icons/icon-192.png', 192],
  ['icon.svg', 'public/icons/icon-512.png', 512],
  ['icon-maskable.svg', 'public/icons/icon-maskable-512.png', 512],
  ['icon.svg', 'public/apple-touch-icon.png', 180],
];

for (const [source, out, size] of targets) {
  const outPath = resolve(root, out);
  await mkdir(dirname(outPath), { recursive: true });
  await sharp(from(source), { density: 512 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`${out}  ${size}x${size}  <- ${source}`);
}
