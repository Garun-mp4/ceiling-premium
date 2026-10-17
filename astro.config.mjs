import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ceiling-premium.vercel.app',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
});
