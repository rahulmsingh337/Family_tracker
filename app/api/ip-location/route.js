export const dynamic = 'force-dynamic';
// Coarse fallback only. Headers are set by Vercel; empty on localhost.
export function GET(req) {
  const h = req.headers;
  const lat = parseFloat(h.get('x-vercel-ip-latitude'));
  const lng = parseFloat(h.get('x-vercel-ip-longitude'));
  return Response.json(Number.isNaN(lat) ? {} : { lat, lng });
}
