import { createIcons, icons } from 'https://cdn.jsdelivr.net/npm/lucide@latest/+esm';
import { setWeatherEffect } from './effects.js';
import { renderTrendChart } from './chart.js';

const $ = (id) => document.getElementById(id);
const refreshIcons = () => createIcons({ icons });

const DEFAULT_CITIES = [
  { name: 'New York', admin1: 'New York', country: 'United States', latitude: 40.7143, longitude: -74.006 },
  { name: 'London', admin1: 'England', country: 'United Kingdom', latitude: 51.5085, longitude: -0.1257 },
  { name: 'Tokyo', admin1: 'Tokyo', country: 'Japan', latitude: 35.6895, longitude: 139.6917 },
  { name: 'Sydney', admin1: 'New South Wales', country: 'Australia', latitude: -33.8679, longitude: 151.2073 },
];

const state = {
  unit: 'celsius',
  place: DEFAULT_CITIES[0],
  saved: [...DEFAULT_CITIES],
  signedIn: false,
  data: null,
};
const PREFERENCES_KEY = 'vistasky_weather_preferences_v1';

/* ---------- Weather code mapping ---------- */
function wx(code, isDay = 1) {
  const d = isDay !== 0;
  const map = {
    0: ['Clear sky', d ? 'sun' : 'moon'],
    1: ['Mostly clear', d ? 'sun' : 'moon'],
    2: ['Partly cloudy', d ? 'cloud-sun' : 'cloud-moon'],
    3: ['Overcast', 'cloud'],
    45: ['Fog', 'cloud-fog'], 48: ['Rime fog', 'cloud-fog'],
    51: ['Light drizzle', 'cloud-drizzle'], 53: ['Drizzle', 'cloud-drizzle'], 55: ['Heavy drizzle', 'cloud-drizzle'],
    56: ['Freezing drizzle', 'cloud-drizzle'], 57: ['Freezing drizzle', 'cloud-drizzle'],
    61: ['Light rain', 'cloud-rain'], 63: ['Rain', 'cloud-rain'], 65: ['Heavy rain', 'cloud-rain'],
    66: ['Freezing rain', 'cloud-hail'], 67: ['Freezing rain', 'cloud-hail'],
    71: ['Light snow', 'cloud-snow'], 73: ['Snow', 'cloud-snow'], 75: ['Heavy snow', 'cloud-snow'], 77: ['Snow grains', 'snowflake'],
    80: ['Rain showers', 'cloud-rain-wind'], 81: ['Rain showers', 'cloud-rain-wind'], 82: ['Violent showers', 'cloud-rain-wind'],
    85: ['Snow showers', 'cloud-snow'], 86: ['Snow showers', 'cloud-snow'],
    95: ['Thunderstorm', 'cloud-lightning'], 96: ['Thunderstorm, hail', 'cloud-lightning'], 99: ['Thunderstorm, hail', 'cloud-lightning'],
  };
  const [label, icon] = map[code] || ['Unknown', 'cloud'];
  return { label, icon };
}

/* ---------- Card theme by weather + time of day ---------- */
const THEMES = {
  clearDay:   { bg: 'bg-sky-500',    hex: '#0ea5e9', label: 'Sunny' },
  partlyDay:  { bg: 'bg-blue-500',   hex: '#3b82f6', label: 'Partly cloudy' },
  cloudyDay:  { bg: 'bg-slate-500',  hex: '#64748b', label: 'Cloudy' },
  fog:        { bg: 'bg-stone-500',  hex: '#78716c', label: 'Foggy' },
  rainDay:    { bg: 'bg-slate-700',  hex: '#334155', label: 'Rainy' },
  snowDay:    { bg: 'bg-cyan-700',   hex: '#0e7490', label: 'Snowy' },
  storm:      { bg: 'bg-violet-900', hex: '#4c1d95', label: 'Stormy' },
  clearNight: { bg: 'bg-indigo-950', hex: '#1e1b4b', label: 'Clear night' },
  cloudyNight:{ bg: 'bg-slate-800',  hex: '#1e293b', label: 'Cloudy night' },
  rainNight:  { bg: 'bg-slate-900',  hex: '#0f172a', label: 'Rainy night' },
  snowNight:  { bg: 'bg-cyan-950',   hex: '#083344', label: 'Snowy night' },
};
const ALL_THEME_BGS = Object.values(THEMES).map((t) => t.bg).concat('bg-blue-600');

function cardTheme(code, isDay) {
  const day = isDay !== 0;
  if (code >= 95) return THEMES.storm;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return day ? THEMES.snowDay : THEMES.snowNight;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return day ? THEMES.rainDay : THEMES.rainNight;
  if (code === 45 || code === 48) return day ? THEMES.fog : THEMES.cloudyNight;
  if (code === 3) return day ? THEMES.cloudyDay : THEMES.cloudyNight;
  if (code === 2) return day ? THEMES.partlyDay : THEMES.cloudyNight;
  return day ? THEMES.clearDay : THEMES.clearNight;
}

function applyCardTheme(theme) {
  const card = $('currentCard');
  card.classList.remove(...ALL_THEME_BGS);
  card.classList.add(theme.bg);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.hex);
}

const iconColor = (icon) => {
  if (icon === 'sun') return 'text-amber-500';
  if (icon === 'moon' || icon === 'cloud-moon') return 'text-indigo-400';
  if (icon === 'cloud-sun') return 'text-amber-500';
  if (icon.includes('rain') || icon.includes('drizzle')) return 'text-blue-500';
  if (icon.includes('snow') || icon === 'snowflake' || icon === 'cloud-hail') return 'text-sky-400';
  if (icon.includes('lightning')) return 'text-violet-500';
  return 'text-slate-400';
};

/* ---------- Helpers ---------- */
const placeLabel = (p) => [p.admin1, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
const placeKey = (p) => `${(+p.latitude).toFixed(2)},${(+p.longitude).toFixed(2)}`;
const t = (v) => `${Math.round(v)}°`;
const windUnit = () => (state.unit === 'fahrenheit' ? 'mph' : 'km/h');
const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
const fmtHour = (iso) => {
  const h = parseInt(iso.slice(11, 13), 10);
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
};
const fmtClock = (iso) => {
  const h = parseInt(iso.slice(11, 13), 10), m = iso.slice(14, 16);
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};
const uvLabel = (u) => (u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme');
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showError(msg) {
  const box = $('errorBox');
  if (!msg) return box.classList.add('hidden');
  box.textContent = msg;
  box.classList.remove('hidden');
}

/* ---------- Data ---------- */
async function fetchWeather(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,uv_index,visibility',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    timezone: 'auto',
    forecast_days: 10,
    temperature_unit: state.unit,
    wind_speed_unit: state.unit === 'fahrenheit' ? 'mph' : 'kmh',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error('Could not load weather data.');
  return res.json();
}

/* ---------- Weather alerts ---------- */
const ALERT_DAYS = 5;
const dismissedAlerts = new Set();

function computeAlerts(d) {
  const f = state.unit === 'fahrenheit';
  const toUnit = (c) => (f ? c * 9 / 5 + 32 : c);
  const HEAT = toUnit(35), HEAT_EXTREME = toUnit(40);
  const FREEZE = toUnit(0), FREEZE_HARD = toUnit(-10);
  const days = d.daily.time.slice(0, ALERT_DAYS);
  const dayName = (i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(days[i] + 'T00:00').toLocaleDateString('en-US', { weekday: 'short' }));
  const list = (idx) => idx.map(dayName).join(', ');

  const storm = [], heat = [], freeze = [];
  days.forEach((_, i) => {
    const code = d.daily.weather_code[i];
    if (code >= 95) storm.push(i);
    if (d.daily.temperature_2m_max[i] >= HEAT) heat.push(i);
    if (d.daily.temperature_2m_min[i] <= FREEZE) freeze.push(i);
  });

  const alerts = [];
  if (storm.length) {
    const hail = storm.some((i) => d.daily.weather_code[i] >= 96);
    alerts.push({
      type: 'storm', severe: hail, icon: 'cloud-lightning',
      title: hail ? 'Thunderstorms with hail expected' : 'Thunderstorms expected',
      detail: `${list(storm)}. Stay indoors during lightning and watch for sudden heavy rain.`,
      days: storm,
    });
  }
  if (heat.length) {
    const peak = Math.max(...heat.map((i) => d.daily.temperature_2m_max[i]));
    const severe = peak >= HEAT_EXTREME;
    alerts.push({
      type: 'heat', severe, icon: 'thermometer-sun',
      title: severe ? 'Extreme heat warning' : 'Heat advisory',
      detail: `${list(heat)} · highs up to ${t(peak)}. Stay hydrated and limit time in direct sun.`,
      days: heat,
    });
  }
  if (freeze.length) {
    const low = Math.min(...freeze.map((i) => d.daily.temperature_2m_min[i]));
    const severe = low <= FREEZE_HARD;
    alerts.push({
      type: 'freeze', severe, icon: 'thermometer-snowflake',
      title: severe ? 'Hard freeze warning' : 'Freezing temperatures',
      detail: `${list(freeze)} · lows down to ${t(low)}. Watch for icy roads and protect pipes and plants.`,
      days: freeze,
    });
  }
  return alerts.sort((a, b) => b.severe - a.severe);
}

function renderAlerts(d) {
  const box = $('alerts');
  const key = placeKey(state.place);
  const alerts = computeAlerts(d).filter((a) => !dismissedAlerts.has(`${key}:${a.type}`));
  if (!alerts.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.className = 'space-y-2';
  box.innerHTML = alerts.map((a) => {
    const s = a.severe
      ? { wrap: 'bg-red-50 border-red-200', chip: 'bg-red-100 text-red-600', title: 'text-red-900', body: 'text-red-700', btn: 'hover:bg-red-100 text-red-600', tag: 'Warning' }
      : { wrap: 'bg-amber-50 border-amber-200', chip: 'bg-amber-100 text-amber-700', title: 'text-amber-900', body: 'text-amber-700', btn: 'hover:bg-amber-100 text-amber-700', tag: 'Advisory' };
    return `
      <div class="flex items-start gap-3 border rounded-xl p-3 sm:p-4 ${s.wrap}">
        <div class="w-9 h-9 rounded-lg grid place-items-center shrink-0 ${s.chip}"><i data-lucide="${a.icon}" class="w-5 h-5"></i></div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-sm font-semibold ${s.title}">${a.title}</span>
            <span class="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${s.chip}">${s.tag}</span>
          </div>
          <p class="text-sm mt-0.5 ${s.body}">${escapeHtml(a.detail)}</p>
        </div>
        <button data-alert="${a.type}" class="alert-dismiss p-1.5 rounded-md shrink-0 transition ${s.btn}" title="Dismiss" aria-label="Dismiss alert">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>`;
  }).join('');
  box.querySelectorAll('.alert-dismiss').forEach((b) => (b.onclick = () => {
    dismissedAlerts.add(`${key}:${b.dataset.alert}`);
    renderAlerts(d);
  }));
}

/* ---------- Shareable links ---------- */
function placeUrl(p) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('city', p.name);
  if (p.admin1) url.searchParams.set('region', p.admin1);
  if (p.country) url.searchParams.set('country', p.country);
  url.searchParams.set('lat', (+p.latitude).toFixed(4));
  url.searchParams.set('lon', (+p.longitude).toFixed(4));
  return url.toString();
}

function placeFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
  if (!q.get('city') || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: q.get('city').slice(0, 80), admin1: (q.get('region') || '').slice(0, 80), country: (q.get('country') || '').slice(0, 80), latitude: lat, longitude: lon };
}

function syncUrl(p) {
  try { history.replaceState(null, '', placeUrl(p)); } catch {}
}

let toastTimer;
function toast(msg, icon = 'check') {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium flex items-center gap-2 border border-slate-700 transition-all duration-200 opacity-0 translate-y-2 pointer-events-none';
    document.body.appendChild(el);
  }
  el.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 text-emerald-400"></i>${escapeHtml(msg)}`;
  refreshIcons();
  requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-y-2'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('opacity-0', 'translate-y-2'), 2400);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

async function shareForecast() {
  const d = state.data, p = state.place;
  if (!d) return;
  const c = d.current;
  const w = wx(c.weather_code, c.is_day);
  const unit = state.unit === 'fahrenheit' ? 'F' : 'C';
  const url = placeUrl(p);
  const title = `${p.name} weather — Vistasky`;
  const text = `${p.name}: ${Math.round(c.temperature_2m)}°${unit} and ${w.label.toLowerCase()}. High ${Math.round(d.daily.temperature_2m_max[0])}° / Low ${Math.round(d.daily.temperature_2m_min[0])}°.`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user cancelled
    }
  }
  const ok = await copyText(`${text}\n${url}`);
  if (ok) toast('Link copied to clipboard');
  else toast('Could not copy link', 'x');
}

async function loadPlace(place) {
  state.place = place;
  syncUrl(place);
  showError(null);
  $('alerts').classList.add('hidden');
  renderSkeleton();
  renderSaved();
  try {
    state.data = await fetchWeather(place);
    render();
  } catch (e) {
    showError(e.message || 'Something went wrong loading the weather.');
  }
}

/* ---------- Rendering ---------- */
function renderSkeleton() {
  $('current').innerHTML = `
    <div class="space-y-4">
      <div class="h-6 w-40 rounded bg-white/20"></div>
      <div class="h-20 w-48 rounded bg-white/20"></div>
      <div class="h-4 w-32 rounded bg-white/20"></div>
    </div>`;
  $('details').innerHTML = Array(8).fill('<div class="skeleton h-24 rounded-xl"></div>').join('');
  $('hourly').innerHTML = Array(10).fill('<div class="skeleton h-28 w-16 shrink-0"></div>').join('');
  $('daily').innerHTML = Array(6).fill('<div class="py-3"><div class="skeleton h-6"></div></div>').join('');
}

function render() {
  const d = state.data;
  if (!d) return;
  const c = d.current;
  const w = wx(c.weather_code, c.is_day);
  const theme = cardTheme(c.weather_code, c.is_day);
  applyCardTheme(theme);
  setWeatherEffect(c.weather_code, c.is_day);
  renderAlerts(d);
  const p = state.place;
  const isSaved = state.saved.some((s) => placeKey(s) === placeKey(p));
  const localTime = new Intl.DateTimeFormat('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: d.timezone }).format(new Date());

  $('current').innerHTML = `
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-white/75 text-sm"><i data-lucide="map-pin" class="w-4 h-4"></i><span class="truncate">${escapeHtml(placeLabel(p))}</span></div>
        <h1 class="text-2xl sm:text-3xl font-semibold mt-1 truncate">${escapeHtml(p.name)}</h1>
        <p class="text-white/75 text-sm mt-1 flex items-center gap-2">${localTime}<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 text-xs font-medium text-white"><i data-lucide="${c.is_day ? 'sun' : 'moon'}" class="w-3 h-3"></i>${theme.label}</span></p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button id="shareBtn" title="Share this forecast" aria-label="Share this forecast" class="h-10 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium flex items-center gap-2 transition">
          <i data-lucide="share-2" class="w-4 h-4"></i><span class="hidden sm:inline">Share</span>
        </button>
        <button id="saveBtn" class="h-10 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium flex items-center gap-2 transition">
          <i data-lucide="${isSaved ? 'bookmark-check' : 'bookmark-plus'}" class="w-4 h-4"></i><span class="hidden sm:inline">${isSaved ? 'Saved' : 'Save'}</span>
        </button>
      </div>
    </div>
    <div class="flex items-end justify-between gap-4 mt-8">
      <div>
        <div class="text-7xl sm:text-8xl font-light tracking-tight leading-none">${t(c.temperature_2m)}</div>
        <div class="mt-3 text-lg font-medium">${w.label}</div>
        <div class="text-white/75 text-sm">Feels like ${t(c.apparent_temperature)} · H ${t(d.daily.temperature_2m_max[0])} L ${t(d.daily.temperature_2m_min[0])}</div>
      </div>
      <i data-lucide="${w.icon}" class="w-24 h-24 sm:w-32 sm:h-32 text-white/90 stroke-[1.25]"></i>
    </div>`;
  $('saveBtn').onclick = toggleSave;
  $('shareBtn').onclick = shareForecast;

  const details = [
    ['wind', 'Wind', `${Math.round(c.wind_speed_10m)} <span class="text-sm text-slate-500">${windUnit()}</span>`, compass(c.wind_direction_10m)],
    ['droplets', 'Humidity', `${c.relative_humidity_2m}<span class="text-sm text-slate-500">%</span>`, 'Relative'],
    ['sun-medium', 'UV index', `${Math.round(c.uv_index ?? 0)}`, uvLabel(c.uv_index ?? 0)],
    ['gauge', 'Pressure', `${Math.round(c.pressure_msl)} <span class="text-sm text-slate-500">hPa</span>`, 'Sea level'],
    ['eye', 'Visibility', state.unit === 'fahrenheit' ? `${(c.visibility / 1609).toFixed(1)} <span class="text-sm text-slate-500">mi</span>` : `${(c.visibility / 1000).toFixed(1)} <span class="text-sm text-slate-500">km</span>`, 'Current'],
    ['umbrella', 'Precipitation', `${c.precipitation} <span class="text-sm text-slate-500">${state.unit === 'fahrenheit' ? 'in' : 'mm'}</span>`, `${d.daily.precipitation_probability_max[0] ?? 0}% chance today`],
    ['sunrise', 'Sunrise', fmtClock(d.daily.sunrise[0]), 'Today'],
    ['sunset', 'Sunset', fmtClock(d.daily.sunset[0]), 'Today'],
  ];
  $('details').innerHTML = details.map(([icon, label, value, sub]) => `
    <div class="bg-white border border-slate-200 rounded-xl p-4">
      <div class="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase tracking-wide"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i>${label}</div>
      <div class="text-2xl font-semibold mt-2">${value}</div>
      <div class="text-xs text-slate-500 mt-0.5">${sub}</div>
    </div>`).join('');

  // Hourly
  const nowKey = c.time.slice(0, 13);
  let start = d.hourly.time.findIndex((x) => x.slice(0, 13) >= nowKey);
  if (start < 0) start = 0;
  const hours = [];
  for (let i = start; i < Math.min(start + 24, d.hourly.time.length); i++) {
    const hw = wx(d.hourly.weather_code[i], d.hourly.is_day[i]);
    const pop = d.hourly.precipitation_probability[i] ?? 0;
    hours.push(`
      <div class="shrink-0 w-[68px] rounded-xl py-3 flex flex-col items-center gap-2 ${i === start ? 'bg-blue-50 border border-blue-200' : 'border border-transparent'}">
        <div class="text-xs font-medium ${i === start ? 'text-blue-700' : 'text-slate-500'}">${i === start ? 'Now' : fmtHour(d.hourly.time[i])}</div>
        <i data-lucide="${hw.icon}" class="w-6 h-6 ${iconColor(hw.icon)}"></i>
        <div class="font-semibold">${t(d.hourly.temperature_2m[i])}</div>
        <div class="text-[11px] text-blue-500 h-3">${pop >= 10 ? pop + '%' : ''}</div>
      </div>`);
  }
  $('hourly').innerHTML = hours.join('');
  try { renderTrendChart(d.hourly, start, state.unit); } catch (e) { console.warn('Chart failed', e); }

  // Daily
  const mins = d.daily.temperature_2m_min, maxs = d.daily.temperature_2m_max;
  const lo = Math.min(...mins), hi = Math.max(...maxs), span = hi - lo || 1;
  $('daily').innerHTML = d.daily.time.map((day, i) => {
    const dw = wx(d.daily.weather_code[i], 1);
    const date = new Date(day + 'T00:00');
    const name = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
    const sub = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const left = ((mins[i] - lo) / span) * 100;
    const width = Math.max(((maxs[i] - mins[i]) / span) * 100, 4);
    const pop = d.daily.precipitation_probability_max[i] ?? 0;
    return `
      <div class="grid grid-cols-[72px_40px_44px_1fr] sm:grid-cols-[110px_48px_56px_1fr] items-center gap-2 sm:gap-4 py-3">
        <div><div class="font-medium text-sm">${name}</div><div class="text-xs text-slate-500">${sub}</div></div>
        <i data-lucide="${dw.icon}" class="w-6 h-6 ${iconColor(dw.icon)}" title="${dw.label}"></i>
        <div class="text-xs text-blue-500 font-medium">${pop >= 10 ? `<span class="inline-flex items-center gap-0.5"><i data-lucide="droplet" class="w-3 h-3"></i>${pop}%</span>` : ''}</div>
        <div class="flex items-center gap-3">
          <span class="w-9 text-right text-sm text-slate-500">${t(mins[i])}</span>
          <div class="relative flex-1 h-1.5 rounded-full bg-slate-100">
            <div class="absolute h-full rounded-full bg-blue-500" style="left:${left}%;width:${width}%"></div>
          </div>
          <span class="w-9 text-sm font-semibold">${t(maxs[i])}</span>
        </div>
      </div>`;
  }).join('');

  const title = `${Math.round(c.temperature_2m)}° ${w.label} in ${p.name} — Vistasky Weather`;
  const desc = `${p.name} weather: ${Math.round(c.temperature_2m)}° and ${w.label.toLowerCase()} now, high ${t(d.daily.temperature_2m_max[0])}, low ${t(d.daily.temperature_2m_min[0])}. Hourly and 10-day forecast on Vistasky.`;
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', title);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', desc);
  refreshIcons();
}

function renderSaved() {
  const list = $('savedList');
  const items = state.saved.map((p, i) => {
    const active = placeKey(p) === placeKey(state.place);
    return `
      <div class="group flex items-center rounded-lg ${active ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'}">
        <button data-idx="${i}" class="saved-open flex-1 min-w-0 text-left px-3 py-2">
          <div class="text-sm font-medium truncate">${escapeHtml(p.name)}</div>
          <div class="text-xs ${active ? 'text-blue-500' : 'text-slate-500'} truncate">${escapeHtml(placeLabel(p))}</div>
        </button>
        <button data-idx="${i}" class="saved-remove opacity-0 group-hover:opacity-100 p-2 mr-1 rounded-md text-slate-400 hover:text-red-500 transition" title="Remove">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>`;
  });
  list.innerHTML = items.length ? items.join('') : '<p class="text-sm text-slate-500 px-1 py-2">No saved cities yet. Search a city and tap Save.</p>';
  if (!state.signedIn) {
    list.insertAdjacentHTML('beforeend', `
      <div class="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 flex items-start gap-2">
        <i data-lucide="cloud" class="w-3.5 h-3.5 mt-0.5 shrink-0"></i>
        <span><button id="sidebarSignIn" class="text-blue-600 font-medium hover:underline">Sign in with Puter</button> to keep your cities synced across devices.</span>
      </div>`);
    $('sidebarSignIn').onclick = signIn;
  }
  list.querySelectorAll('.saved-open').forEach((b) => (b.onclick = () => loadPlace(state.saved[+b.dataset.idx])));
  list.querySelectorAll('.saved-remove').forEach((b) => (b.onclick = () => {
    state.saved.splice(+b.dataset.idx, 1);
    persist();
    renderSaved();
    render();
  }));
  refreshIcons();
}

/* ---------- Puter cloud preferences ---------- */
async function persist() {
  if (!state.signedIn) return;
  try {
    await window.puter.kv.set(PREFERENCES_KEY, JSON.stringify({
      saved: state.saved,
      unit: state.unit,
      last: state.place,
      theme: isDark() ? 'dark' : 'light',
    }));
  } catch (error) {
    showError(`Could not save your synced weather preferences: ${error.message}`);
  }
}

async function loadPrefs() {
  try {
    const stored = await window.puter.kv.get(PREFERENCES_KEY);
    if (!stored) return persist();
    const preferences = typeof stored === 'string' ? JSON.parse(stored) : stored;
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      throw new Error('Saved weather preferences have an invalid format.');
    }
    if (Array.isArray(preferences.saved)) state.saved = preferences.saved;
    if (preferences.unit === 'celsius' || preferences.unit === 'fahrenheit') state.unit = preferences.unit;
    if (preferences.last) state.place = preferences.last;
    if (preferences.theme === 'dark' || preferences.theme === 'light') {
      document.documentElement.classList.toggle('dark', preferences.theme === 'dark');
      try { localStorage.setItem('skycast_theme', preferences.theme); } catch {}
    }
  } catch (error) {
    showError(`Could not load your synced weather preferences: ${error.message}`);
  }
}

function toggleSave() {
  const key = placeKey(state.place);
  const idx = state.saved.findIndex((s) => placeKey(s) === key);
  if (idx >= 0) state.saved.splice(idx, 1);
  else {
    const { name, admin1, country, latitude, longitude } = state.place;
    state.saved.unshift({ name, admin1, country, latitude, longitude });
  }
  persist();
  renderSaved();
  render();
}

/* ---------- Puter sign-in ---------- */
async function updateAuthUI() {
  if (!window.puter?.auth) throw new Error('Puter sign-in could not be loaded. Check your connection and try again.');
  state.signedIn = Boolean(window.puter.auth.isSignedIn());
  const btn = $('authBtn');
  btn.title = state.signedIn ? 'Sign out of Puter' : 'Sign in with Puter';
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = `<i data-lucide="${state.signedIn ? 'log-out' : 'user'}" class="w-4 h-4"></i><span id="authLabel" class="hidden md:inline">${state.signedIn ? 'Sign out' : 'Sign in with Puter'}</span>`;
  $('deleteDataBtn').classList.toggle('hidden', !state.signedIn);
  refreshIcons();
}

async function signIn() {
  try {
    if (!window.puter?.auth) throw new Error('Puter sign-in could not be loaded. Check your connection and try again.');
    await window.puter.auth.signIn();
    await updateAuthUI();
    if (!state.signedIn) throw new Error('Puter sign-in did not complete.');
    await loadPrefs();
    updateUnitButtons();
    renderSaved();
    loadPlace(state.place);
  } catch (error) {
    showError(`Could not sign in with Puter: ${error.message}`);
  }
}

async function signOut() {
  try {
    await window.puter.auth.signOut();
    state.signedIn = false;
    state.saved = [...DEFAULT_CITIES];
    state.unit = 'celsius';
    state.place = DEFAULT_CITIES[0];
    await updateAuthUI();
    renderSaved();
    updateUnitButtons();
    loadPlace(state.place);
  } catch (error) {
    showError(`Could not sign out: ${error.message}`);
  }
}

$('authBtn').onclick = async () => {
  if (state.signedIn) await signOut();
  else await signIn();
};
$('deleteDataBtn').onclick = async () => {
  if (!state.signedIn || !window.confirm('Permanently delete your synced saved cities and weather preferences?')) return;
  try {
    await window.puter.kv.del(PREFERENCES_KEY);
    state.saved = [...DEFAULT_CITIES];
    state.unit = 'celsius';
    state.place = DEFAULT_CITIES[0];
    document.documentElement.classList.toggle('dark', false);
    try { localStorage.setItem('skycast_theme', 'light'); } catch {}
    updateUnitButtons();
    renderSaved();
    loadPlace(state.place);
    toast('Synced weather data deleted');
  } catch (error) {
    showError(`Could not delete your synced weather data: ${error.message}`);
  }
};

/* ---------- Dark mode ---------- */
const isDark = () => document.documentElement.classList.contains('dark');
function setTheme(theme, save = true) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  if (save) {
    try { localStorage.setItem('skycast_theme', theme); } catch {}
    persist();
  }
  render(); // redraw chart with matching colors
}
$('themeBtn').onclick = () => setTheme(isDark() ? 'light' : 'dark');

/* ---------- Units ---------- */
function updateUnitButtons() {
  document.querySelectorAll('.unit-btn').forEach((b) => {
    const on = b.dataset.unit === state.unit;
    b.className = `unit-btn px-2.5 py-1 rounded-md transition ${on ? 'bg-white text-slate-900' : 'text-slate-500 hover:text-slate-700'}`;
  });
}
document.querySelectorAll('.unit-btn').forEach((b) => (b.onclick = () => {
  if (state.unit === b.dataset.unit) return;
  state.unit = b.dataset.unit;
  updateUnitButtons();
  persist();
  loadPlace(state.place);
}));

/* ---------- Search ---------- */
const input = $('search'), results = $('results');
let searchTimer, searchResults = [], activeIdx = -1, searchSeq = 0;

function closeResults() { results.classList.add('hidden'); activeIdx = -1; }

function renderResults() {
  if (!searchResults.length) {
    results.innerHTML = '<div class="px-4 py-3 text-sm text-slate-500">No cities found</div>';
  } else {
    results.innerHTML = searchResults.map((r, i) => `
      <button data-idx="${i}" class="result w-full text-left px-4 py-2.5 flex items-center gap-3 ${i === activeIdx ? 'bg-slate-100' : 'hover:bg-slate-50'}">
        <i data-lucide="map-pin" class="w-4 h-4 text-slate-400 shrink-0"></i>
        <div class="min-w-0"><div class="text-sm font-medium truncate">${escapeHtml(r.name)}</div><div class="text-xs text-slate-500 truncate">${escapeHtml(placeLabel(r))}</div></div>
      </button>`).join('');
    results.querySelectorAll('.result').forEach((b) => b.onmousedown = (e) => { e.preventDefault(); choose(+b.dataset.idx); });
  }
  results.classList.remove('hidden');
  refreshIcons();
}

function choose(i) {
  const r = searchResults[i];
  if (!r) return;
  input.value = '';
  input.blur();
  closeResults();
  loadPlace({ name: r.name, admin1: r.admin1, country: r.country, latitude: r.latitude, longitude: r.longitude });
  persist();
}

input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (q.length < 2) { closeResults(); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    $('searchSpin').classList.remove('hidden');
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
      const json = await res.json();
      if (seq !== searchSeq) return;
      searchResults = json.results || [];
      activeIdx = searchResults.length ? 0 : -1;
      renderResults();
    } catch { if (seq === searchSeq) { searchResults = []; renderResults(); } }
    finally { if (seq === searchSeq) $('searchSpin').classList.add('hidden'); }
  }, 250);
});

input.addEventListener('keydown', (e) => {
  if (results.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, searchResults.length - 1); renderResults(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderResults(); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(activeIdx); }
  else if (e.key === 'Escape') closeResults();
});
input.addEventListener('blur', () => setTimeout(closeResults, 100));
input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && searchResults.length) renderResults(); });

/* ---------- Geolocation ---------- */
$('locateBtn').onclick = () => {
  if (!navigator.geolocation) return showError('Location is not supported by your browser.');
  const btn = $('locateBtn');
  btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>';
  refreshIcons();
  const reset = () => { btn.innerHTML = '<i data-lucide="locate-fixed" class="w-5 h-5"></i>'; refreshIcons(); };
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    let place = { name: 'My location', admin1: '', country: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`, latitude, longitude };
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
      const j = await r.json();
      if (j.city || j.locality) place = { name: j.city || j.locality, admin1: j.principalSubdivision, country: j.countryName, latitude, longitude };
    } catch {}
    reset();
    loadPlace(place);
  }, () => { reset(); showError('Could not access your location. Check your browser permissions.'); }, { timeout: 10000 });
};

/* ---------- Init ---------- */
(async function init() {
  refreshIcons();
  updateUnitButtons();
  try {
    await updateAuthUI();
  } catch (error) {
    showError(`Could not connect to Puter sign-in: ${error.message}`);
  }
  const linked = placeFromUrl();
  if (state.signedIn) { await loadPrefs(); updateUnitButtons(); }
  if (linked) state.place = linked;
  renderSaved();
  loadPlace(state.place);
})();
