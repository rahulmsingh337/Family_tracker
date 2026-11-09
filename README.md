# Family Locator
Consent-based family location sharing. Next.js + Supabase + Leaflet.

## Setup
1. Create a Supabase project. SQL Editor → run `supabase/schema.sql`, then `supabase/002_history_transfer.sql`.
2. Auth → Providers → Email. For quick testing, turn off "Confirm email".
3. `cp .env.example .env.local` and fill in the URL and anon key (Project Settings → API).
4. `npm install && npm run dev`

## Deploy (Vercel)
1. Push to GitHub, import the repo in Vercel.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as env vars.
3. Supabase → Auth → URL Configuration: set Site URL to your Vercel URL.

## Notes
- Location works only over HTTPS (Vercel) or localhost, and only while the tab is open. Browsers cannot track in the background; "Keep screen on" (Wake Lock) is a partial workaround.
- Latest position plus 7-day route history (a point per 50 m moved or 5 min). Stopping sharing deletes the latest position and hides the route; "Delete my route history" erases it.
- Access control is enforced by Postgres RLS, not the client.
