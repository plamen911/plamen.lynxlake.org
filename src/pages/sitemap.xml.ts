import { buildDate } from '../data/discovery';

// The profile page and the go-insurance-checker page; lastmod is the build date, as every build ships the content.
export const GET = (): Response =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://plamen.lynxlake.org/</loc><lastmod>${buildDate()}</lastmod></url>
  <url><loc>https://plamen.lynxlake.org/go-insurance-checker/</loc><lastmod>${buildDate()}</lastmod></url>
</urlset>
`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
