export const GET = () =>
  new Response(
    import.meta.env.VERCEL_ENV === 'preview'
      ? 'User-agent: *\nDisallow: /'
      : 'User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://ceiling-premium.vercel.app/sitemap.xml',
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
