import sharp from 'sharp';
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

await mkdir('public/media', { recursive: true });
await mkdir('public/fonts', { recursive: true });
const files = (await readdir('assets-source')).filter((f) => f.endsWith('.png')).sort();
const manifest = [];
for (const file of files) {
  const slug = file.replace('.png', '');
  const source = join('assets-source', file);
  const meta = await sharp(source).metadata();
  for (const width of [480, 800, 1200, 1600]) {
    for (const [ext, options] of [
      ['avif', { quality: 48, effort: 4 }],
      ['webp', { quality: 77, effort: 4 }],
    ]) {
      const destination = `public/media/${slug}-${width}.${ext}`;
      try {
        if ((await stat(destination)).mtimeMs > (await stat(source)).mtimeMs) continue;
      } catch {
        /* First export. */
      }
      await sharp(source)
        .resize({ width, withoutEnlargement: false })
        .toFormat(ext, options)
        .toFile(destination);
    }
  }
  await sharp(source)
    .resize({ width: 1200 })
    .jpeg({ quality: 79, mozjpeg: true })
    .toFile(`public/media/${slug}-1200.jpg`);
  manifest.push({
    slug,
    source,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    sha256: createHash('sha256')
      .update(await readFile(source))
      .digest('hex'),
    formats: ['avif', 'webp', 'jpg'],
    widths: [480, 800, 1200, 1600],
    generation:
      'Built-in imagegen; commissioned architectural photography; technical briefs in assets-source/prompts.md',
  });
  console.log(`Exported ${slug}`);
}
await writeFile('assets-source/manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// Technical exports of the approved PNG identity; no new logo design.
const icon = await sharp('images/brand/pole-icon.png').trim().toBuffer();
const logo = await sharp('images/brand/pole-logo.png').trim().toBuffer();
await sharp(logo)
  .resize({ width: 432 })
  .png({ palette: true, quality: 100 })
  .toFile('public/brand/pole-logo.png');
for (const size of [16, 32, 48]) {
  await sharp(icon)
    .resize({ width: Math.round(size * 0.8), height: Math.round(size * 0.8), fit: 'contain' })
    .extend({
      top: Math.floor(size * 0.1),
      bottom: size - Math.round(size * 0.8) - Math.floor(size * 0.1),
      left: Math.floor(size * 0.1),
      right: size - Math.round(size * 0.8) - Math.floor(size * 0.1),
      background: { r: 247, g: 245, b: 240, alpha: 1 },
    })
    .png()
    .toFile(`public/brand/favicon-${size}.png`);
  // A light tile preserves the approved dark mark in a dark browser tab.
  await sharp(`public/brand/favicon-${size}.png`)
    .png()
    .toFile(`public/brand/favicon-dark-${size}.png`);
}
await sharp(icon)
  .resize({ width: 132, height: 132, fit: 'contain', background: '#f7f5f0' })
  .extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#f7f5f0' })
  .flatten({ background: '#f7f5f0' })
  .png()
  .toFile('public/brand/apple-touch-icon.png');
const og = Buffer.from(
  `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#f7f5f0"/><rect x="70" y="90" width="1060" height="1" fill="#d9d7d0"/><rect x="70" y="535" width="1060" height="1" fill="#d9d7d0"/><rect x="1025" y="100" width="105" height="105" fill="#ff7a18"/></svg>`,
);
const ogLogo = await sharp(logo).resize({ width: 850 }).png().toBuffer();
await sharp(og)
  .composite([{ input: ogLogo, left: 100, top: 220 }])
  .jpeg({ quality: 90 })
  .toFile('public/brand/og-pole.jpg');

for (const [family, slug] of [
  ['Manrope', 'manrope'],
  ['Onest', 'onest'],
]) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600&display=swap`;
  const css = await fetch(cssUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`Font CSS ${r.status}`);
    return r.text();
  });
  for (const subset of ['cyrillic', 'latin']) {
    const escaped = subset.replace('-', '\\-');
    const match = css.match(
      new RegExp(`/\\* ${escaped} \\*/\\s*@font-face\\s*\\{[^}]*src: url\\(([^)]+)\\)`),
    );
    if (!match) throw new Error(`Missing ${family} ${subset} WOFF2`);
    const response = await fetch(match[1]);
    if (!response.ok) throw new Error(`Font download ${response.status}`);
    await writeFile(
      `public/fonts/${slug}-${subset}.woff2`,
      Buffer.from(await response.arrayBuffer()),
    );
  }
  const license = await fetch(
    `https://raw.githubusercontent.com/google/fonts/main/ofl/${slug}/OFL.txt`,
  );
  if (!license.ok) throw new Error(`Missing ${family} license`);
  await writeFile(
    `public/fonts/${slug}-LICENSE.txt`,
    (await license.text()).replace(/[ \t]+$/gm, ''),
  );
}
console.log(`Prepared ${manifest.length} source images, brand assets and local fonts.`);
