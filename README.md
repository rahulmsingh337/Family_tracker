# Family Locator (Firebase)
Consent-based family location sharing. Next.js + Firebase Auth/Firestore + Leaflet. Runs on the free Spark plan (no Cloud Functions).

## Firebase setup (console.firebase.google.com)
1. Add project → Add a **Web app** → copy `apiKey`, `authDomain`, `projectId`, `appId`.
2. Build → Authentication → Sign-in method → enable **Email/Password**.
3. Build → Firestore Database → Create (production mode) → **Rules** tab → paste `firestore.rules` → Publish.
4. Firestore → **TTL** → Create policy: collection group `trail`, field `expireAt` (route history auto-deletes after 7 days, typically within ~24 h of expiry).
5. Authentication → Settings → **Authorized domains** → add your `*.vercel.app` domain.

## Deploy (Vercel)
Add these env vars, then Deploy:
`NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`

## Notes
- Location works only over HTTPS (Vercel) or localhost, and only while the tab is open. Browsers cannot track in the background.
- Latest position plus route history (a point per 50 m or 5 min). Stopping sharing deletes the latest position and hides the route.
- The owner cannot leave; transfer ownership first. A family cannot be deleted from the UI.
- Access control lives in `firestore.rules`, not the client.
