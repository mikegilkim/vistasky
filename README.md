# Vistasky

Vistasky is a Node.js weather app with Puter sign-in and optional cloud syncing for saved cities and display preferences.

## Run locally

Requires Node.js 18 or newer.

```powershell
npm start
```

Open <http://localhost:3000>. Sign-in uses the Puter.js client SDK loaded from `https://js.puter.com/v2/`; no Google OAuth or server-side credentials are required.

## Puter sign-in and preference sync

Choose **Sign in with Puter** in the app. Puter opens its own sign-in window; after sign-in, Vistasky saves the user's saved cities, selected city, temperature units, and theme with the Puter Key-Value Store. This data is stored in the signed-in user's Puter cloud account for this app. **Delete synced weather data** removes Vistasky's preferences key; signing out does not delete saved preferences.

Vistasky does not implement its own login credentials, session API, or preference database. The Puter.js SDK handles authentication and access to the user's cloud key-value store. A working connection to Puter's SDK and services is required for sign-in and syncing; weather forecasts remain available if those services cannot be reached.

## Privacy

Vistasky does not set its own cookies. Puter sign-in is handled by Puter.js and may use Puter-controlled browser storage or authentication mechanisms. The app stores theme locally and uses Puter's Key-Value Store for signed-in weather preferences. Weather searches and forecast requests are sent to Open-Meteo; other interface resources load from their listed providers.

See [privacy.html](./privacy.html) for the current privacy notice. The public site no longer links to it from the footer.

## Deploy to Vercel

Import the GitHub repository into Vercel and set the project root to the repository root. Vercel serves the static app; no `GOOGLE_CLIENT_ID`, Google client secret, Supabase, or other authentication environment variables are required. The app needs access to `https://js.puter.com/v2/` and Puter's services for account sign-in and cloud preference sync.

## Commands

- `npm start` — start the Node.js server (defaults to port 3000; configure with `PORT` and `HOST`).
- `npm test` — run the static server tests.
