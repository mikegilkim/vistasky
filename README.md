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

Google Analytics (`G-7S87WY6YLS`) is configured with Google Consent Mode storage defaults denied for analytics and advertising. This prevents analytics and advertising cookies but still allows cookieless measurement pings to Google. Review local privacy requirements before changing these defaults.

See [privacy.html](./privacy.html) for the current privacy notice. A link appears beside the Open-Meteo weather data attribution in the app footer.

## Deploy to Vercel

Import the GitHub repository into Vercel and set the project root to the repository root. Vercel serves the static app; no `GOOGLE_CLIENT_ID`, Google client secret, Supabase, or other authentication environment variables are required. The app needs access to `https://js.puter.com/v2/` and Puter's services for account sign-in and cloud preference sync.

The site provides a canonical homepage, social metadata, structured application data, an indexable `robots.txt`, and an XML sitemap at `https://vistasky.vercel.app/sitemap.xml`. Add the domain as a property in Google Search Console, verify ownership, and submit the sitemap there. Crawling and indexing are controlled by search engines; these steps improve discovery but cannot guarantee indexing, rankings, or timing.

## Commands

- `npm start` — start the Node.js server (defaults to port 3000; configure with `PORT` and `HOST`).
- `npm test` — run the static server tests.
