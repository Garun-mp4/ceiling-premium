import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
const root = resolve('dist');
let checked = 0;
const errors = [];
const titles = new Set();
async function walk(path) {
  const found = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const p = join(path, item.name);
    if (item.isDirectory()) found.push(...(await walk(p)));
    else if (item.name.endsWith('.html')) found.push(p);
  }
  return found;
}
for (const path of await walk(root)) {
  const html = await readFile(path, 'utf8');
  checked++;
  if ((html.match(/<h1(?:\s|>)/g) || []).length !== 1) errors.push(`${path}: expected one h1`);
  if (!html.includes('rel="canonical"')) errors.push(`${path}: missing canonical`);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  if (!title || titles.has(title)) errors.push(`${path}: missing or duplicate title`);
  else titles.add(title);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  if (new Set(ids).size !== ids.length) errors.push(`${path}: duplicate element ID`);
  for (const image of html.matchAll(/<img\s[^>]*>/g))
    if (!/\salt(?:=|\s|>)/.test(image[0])) errors.push(`${path}: image without alt`);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]*)[^\"]*"/g)) {
    const url = match[1];
    if (url.startsWith('/api/')) continue;
    const target = resolve(root, '.' + decodeURIComponent(url));
    if (!target.startsWith(root)) throw new Error('Unsafe link');
    try {
      const s = await stat(target);
      if (s.isDirectory()) await stat(join(target, 'index.html'));
    } catch {
      errors.push(`${path}: broken asset/link ${url}`);
    }
  }
}
const expected = [
  'hero-desktop',
  'hero-mobile',
  'living-main',
  'living-detail',
  'kitchen-main',
  'kitchen-detail',
  'bedroom-main',
  'bedroom-detail',
  'child-main',
  'child-detail',
  'bathroom-main',
  'bathroom-detail',
  'studio-main',
  'studio-detail',
  'detail-standard',
  'detail-shadow',
  'detail-floating',
  'detail-curtain',
  'texture-matte',
  'texture-satin',
  'texture-gloss',
  'process-measure',
  'process-install',
  'process-check',
];
for (const slug of expected)
  for (const ext of ['avif', 'webp'])
    for (const width of [480, 800, 1200, 1600])
      try {
        await stat(join(root, `media/${slug}-${width}.${ext}`));
      } catch {
        errors.push(`Missing ${slug}-${width}.${ext}`);
      }
const sizes = { js: 0, css: 0, fonts: 0 };
for (const file of await readdir(join(root, '_astro'))) {
  const buffer = await readFile(join(root, '_astro', file));
  if (file.endsWith('.js')) sizes.js += gzipSync(buffer).length;
  if (file.endsWith('.css')) sizes.css += gzipSync(buffer).length;
}
for (const file of await readdir(join(root, 'fonts')))
  if (file.endsWith('.woff2')) sizes.fonts += (await stat(join(root, 'fonts', file))).size;
for (const [key, limit] of Object.entries({ js: 60000, css: 40000, fonts: 140000 }))
  if (sizes[key] > limit) errors.push(`${key} budget exceeded: ${sizes[key]} > ${limit}`);
for (const [file, limit] of [
  ['hero-desktop-1600.avif', 250000],
  ['hero-mobile-800.avif', 130000],
])
  if ((await stat(join(root, 'media', file))).size > limit)
    errors.push(`${file}: hero image budget exceeded`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Validated ${checked} HTML pages, internal links and all 24 image sets.`);
console.log(
  `Payload budgets: JS ${sizes.js} B gzip; CSS ${sizes.css} B gzip; fonts ${sizes.fonts} B.`,
);
