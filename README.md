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

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or select a project and configure the Google Auth Platform consent screen with the app name, support email, audience, and contact details.
2. Create an OAuth client with application type **Web application**.
3. Add each exact Vistasky origin under **Authorized JavaScript origins** (for local development, `http://localhost:3000`; for production, the HTTPS origin of the deployed app). Google Identity Services returns the credential in the browser, so this integration does not need an OAuth client secret or redirect URI.
4. Set `GOOGLE_CLIENT_ID` to the client ID for that web client. The ID is public configuration; never put a client secret in browser code.
5. Use an HTTPS origin for production. Keep `DATA_DIR` on durable, private storage and back it up according to the retention policy.

For a production start, set `NODE_ENV=production`, `GOOGLE_CLIENT_ID`, and an absolute `DATA_DIR` outside the web app directory before running `npm start`. Vistasky does not use cookies. Its random bearer session token is kept in browser `sessionStorage`, sent in authorization headers, and cleared on sign-out or when the tab closes; matching session state is held in server memory and cleared on restart. Preference data lives in the durable data directory.

The server verifies the Google ID token signature, issuer, audience, and expiry against Google's published signing keys. It does not save the Google name or email. A random bearer token maps to the verified Google account identifier in server memory. Saved locations, the last selected city, temperature units, and theme are saved in `.data/preferences.json` (or `DATA_DIR`); the `sub` account identifier is used as the record key. Sign-out ends the session but does not delete synced preferences. Users can delete those preferences with **Delete synced weather data** in the app footer.

Google sign-in replaces the previous Puter authentication integration. Existing preferences stored in Puter are not automatically migrated.

## Privacy

Vistasky does not set or read cookies. It stores the theme in `localStorage` and the signed-in bearer token in tab-scoped `sessionStorage`. Google may use cookies on its own sign-in pages and services. Vistasky does not currently load analytics, advertising, or personalization trackers.

Review [privacy.html](./privacy.html) and complete its deployment-owner contact details and any hosting/provider disclosures before making the app publicly available. The operator must also document the controller, purposes and legal bases, retention, recipients, international transfers, and a working contact for privacy requests.

## Deploy to Vercel

Import the repository into Vercel and set the project root to the repository root. The [Vercel configuration](./vercel.json) selects the **Other** framework preset so Vercel serves the static app files and deploys the catch-all API function in [api/](./api) without mistaking the browser's `app.js` for a server entry point. Use `vistasky.vercel.app` as the project domain, if it is available in the deploying Vercel account.

The forecast app and weather search run on Vercel. Google sign-in is deliberately disabled there: Vercel instances do not provide the durable local disk and shared session store required by the current preference backend. Do not set `GOOGLE_CLIENT_ID` for this deployment until persistent session and preference storage is implemented and configured. Sign-in and preference sync remain available when using `npm start` with a Google client ID and a persistent `DATA_DIR`.

## Commands

- `npm start` — start the Node.js server (defaults to port 3000; configure with `PORT` and `HOST`).
- `npm test` — run the server and API tests.
