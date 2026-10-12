# Vistasky

Vistasky is a Node.js weather app with Google account sign-in and server-side syncing for saved cities and display preferences.

## Run locally

Requires Node.js 18 or newer.

```powershell
$env:GOOGLE_CLIENT_ID = "your-google-oauth-web-client-id"
npm start
```

Open <http://localhost:3000>. Without `GOOGLE_CLIENT_ID`, weather forecasts still work, but Google sign-in and preference syncing are disabled.

## Set up Google sign-in

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or select a project and configure the Google Auth Platform consent screen with the app name, support email, audience, and contact details. If the app is in testing mode, add your account as a test user.
2. Create an OAuth client with application type **Web application**.
3. Add each exact Vistasky origin under **Authorized JavaScript origins** (for local development, `http://localhost:3000`; for production, `https://vistasky.vercel.app`). Google Identity Services returns a signed credential in the browser, so this integration does not use an OAuth client secret or redirect URI. The client ID is public configuration; never put a client secret in browser code.
4. Create a [Supabase](https://supabase.com/dashboard) project, then run this SQL in its SQL Editor:

   ```sql
   create table public.vistasky_sessions (
     token_hash text primary key,
     subject text not null,
     expires_at timestamptz not null
   );
   create index vistasky_sessions_expiry_idx on public.vistasky_sessions (expires_at);

   create table public.vistasky_preferences (
     account_id text primary key,
     preferences jsonb not null
   );

   alter table public.vistasky_sessions enable row level security;
   alter table public.vistasky_preferences enable row level security;
   revoke all on public.vistasky_sessions, public.vistasky_preferences from anon, authenticated;
   grant all on public.vistasky_sessions, public.vistasky_preferences to service_role;
   ```

5. In Vercel Project Settings → Environment Variables, add `SUPABASE_URL` (the project URL from Supabase Project Settings → API) and `SUPABASE_SERVICE_ROLE_KEY` (the server-only service role key from that same page), along with `GOOGLE_CLIENT_ID`. Scope them to Production and any Preview environment you use. Never expose the service role key in browser code or a `NEXT_PUBLIC_` variable. The existing `GOOGLE_CLIENT_SECRET` is not used by this sign-in flow; remove it from Vercel if no other server integration needs it.
6. Redeploy Vercel after saving the variables. Sign-in becomes available only when the Google client ID and both Supabase variables are present.

For a production start outside Vercel, set `NODE_ENV=production`, `GOOGLE_CLIENT_ID`, and an absolute `DATA_DIR` outside the web app directory before running `npm start`. Vistasky does not use cookies. The random bearer session token is kept in browser `sessionStorage`, sent in authorization headers, and cleared on sign-out or when the tab closes. On Vercel, only a SHA-256 hash of the token and its account association are stored in Supabase; synced preferences are stored there as JSONB. Expired session rows are cleaned up on the next successful sign-in.

The server verifies the Google ID token signature, issuer, audience, and expiry against Google's published signing keys. It does not save the Google name or email. Saved locations, the last selected city, temperature units, and theme are keyed by the verified Google account identifier. Sign-out ends the session but does not delete synced preferences. Users can delete those preferences with **Delete synced weather data** in the app footer.

Google sign-in replaces the previous Puter authentication integration. Existing preferences stored in Puter are not automatically migrated.

## Privacy

Vistasky does not set or read cookies. It stores the theme in `localStorage` and the signed-in bearer token in tab-scoped `sessionStorage`. Google may use cookies on its own sign-in pages and services. Vistasky does not currently load analytics, advertising, or personalization trackers.

Review [privacy.html](./privacy.html) and complete its deployment-owner contact details and any hosting/provider disclosures before making the app publicly available. The operator must also document the controller, purposes and legal bases, retention, recipients, international transfers, and a working contact for privacy requests.

## Deploy to Vercel

Import the repository into Vercel and set the project root to the repository root. The [Vercel configuration](./vercel.json) selects the **Other** framework preset so Vercel serves the static app files and deploys the API functions in [api/](./api) without mistaking the browser's `app.js` for a server entry point. Use `vistasky.vercel.app` as the project domain, if it is available in the deploying Vercel account.

The forecast app, weather search, and serverless API run on Vercel. Google sign-in and preference sync are enabled only when the Google client ID and Supabase server credentials are configured. Vercel instances do not use the local JSON preference file for signed-in accounts.

## Commands

- `npm start` — start the Node.js server (defaults to port 3000; configure with `PORT` and `HOST`).
- `npm test` — run the server and API tests.
