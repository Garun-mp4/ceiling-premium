import { projects, solutions } from '../data/content';
import { site } from '../data/site';
export const GET = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/resheniya/', '/proekty/', '/stoimost/', '/o-kompanii/', '/kontakty/', '/privacy/', '/consent/', '/cookies/', ...solutions.map((s) => `/resheniya/${s.slug}/`), ...projects.map((p) => `/proekty/${p.slug}/`)].map((path) => `<url><loc>${site.url}${path}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
