// Subtle canvas weather effects for the current-conditions card.
const canvas = document.getElementById('fx');
const flash = document.getElementById('flash');
const ctx = canvas.getContext('2d');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let mode = 'none';
let particles = [];
let raf = null;
let w = 0, h = 0, dpr = 1;
let nextBolt = 0;

function resize() {
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = r.width; h = r.height;
  canvas.width = Math.max(1, w * dpr);
  canvas.height = Math.max(1, h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed();
}
new ResizeObserver(resize).observe(canvas.parentElement);

const rand = (a, b) => a + Math.random() * (b - a);

function seed() {
  const area = (w * h) / 10000; // per 100x100 px
  particles = [];
  if (mode === 'rain' || mode === 'storm' || mode === 'drizzle') {
    const n = Math.round(area * (mode === 'drizzle' ? 1.2 : mode === 'storm' ? 3.2 : 2.4));
    for (let i = 0; i < n; i++) particles.push(newDrop(true));
  } else if (mode === 'snow') {
    const n = Math.round(area * 1.4);
    for (let i = 0; i < n; i++) particles.push(newFlake(true));
  } else if (mode === 'stars') {
    const n = Math.round(area * 1.1);
    for (let i = 0; i < n; i++) particles.push({ x: rand(0, w), y: rand(0, h), r: rand(0.4, 1.4), ph: rand(0, Math.PI * 2), sp: rand(0.6, 1.8), base: rand(0.25, 0.75) });
  } else if (mode === 'sun') {
    particles = [{ rays: 12 }];
  } else if (mode === 'clouds' || mode === 'fog') {
    const n = mode === 'fog' ? 6 : 4;
    for (let i = 0; i < n; i++) particles.push({ x: rand(-0.2 * w, w), y: rand(0.05 * h, mode === 'fog' ? h : 0.6 * h), s: rand(0.6, 1.3), v: rand(0.08, 0.25) });
  }
}

function newDrop(anywhere) {
  const heavy = mode === 'storm';
  return {
    x: rand(-20, w + 20),
    y: anywhere ? rand(-h, h) : rand(-60, -10),
    len: mode === 'drizzle' ? rand(6, 10) : rand(10, heavy ? 22 : 18),
    v: mode === 'drizzle' ? rand(3, 5) : rand(heavy ? 9 : 7, heavy ? 14 : 11),
    a: rand(0.15, 0.4),
  };
}
function newFlake(anywhere) {
  return { x: rand(0, w), y: anywhere ? rand(-h, h) : rand(-20, -5), r: rand(1, 3), v: rand(0.4, 1.1), drift: rand(0, Math.PI * 2), a: rand(0.4, 0.85) };
}

function drawCloud(x, y, s, alpha) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, 40 * s, 0, Math.PI * 2);
  ctx.arc(x + 45 * s, y - 15 * s, 50 * s, 0, Math.PI * 2);
  ctx.arc(x + 95 * s, y, 38 * s, 0, Math.PI * 2);
  ctx.arc(x + 45 * s, y + 15 * s, 40 * s, 0, Math.PI * 2);
  ctx.fill();
}

function frame(t) {
  ctx.clearRect(0, 0, w, h);
  const wind = mode === 'storm' ? 2.5 : 1.2;

  if (mode === 'rain' || mode === 'storm' || mode === 'drizzle') {
    ctx.lineCap = 'round';
    ctx.lineWidth = mode === 'drizzle' ? 1 : 1.3;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.strokeStyle = `rgba(255,255,255,${p.a})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - wind * (p.len / p.v), p.y - p.len);
      ctx.stroke();
      p.y += p.v; p.x += wind * 0.6;
      if (p.y - p.len > h || p.x > w + 30) particles[i] = newDrop(false);
    }
    if (mode === 'storm' && t > nextBolt) {
      nextBolt = t + rand(4000, 9000);
      flash.animate([{ opacity: 0 }, { opacity: 0.25 }, { opacity: 0.05 }, { opacity: 0.18 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' });
    }
  } else if (mode === 'snow') {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.drift += 0.012;
      p.y += p.v; p.x += Math.sin(p.drift) * 0.4;
      ctx.fillStyle = `rgba(255,255,255,${p.a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      if (p.y - p.r > h) particles[i] = newFlake(false);
    }
  } else if (mode === 'stars') {
    const s = t / 1000;
    for (const p of particles) {
      const a = p.base * (0.55 + 0.45 * Math.sin(s * p.sp + p.ph));
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  } else if (mode === 'sun') {
    const cx = w - Math.min(110, w * 0.18), cy = Math.min(90, h * 0.3);
    const rot = t / 30000;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    const n = 12, R = Math.max(w, h) * 1.2;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n * 0.55;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
      ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    const pulse = 0.08 + 0.03 * Math.sin(t / 1500);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.fill();
  } else if (mode === 'clouds' || mode === 'fog') {
    for (const p of particles) {
      p.x += p.v;
      if (p.x > w + 20) { p.x = -160 * p.s; p.y = rand(0.05 * h, mode === 'fog' ? h : 0.6 * h); }
      drawCloud(p.x, p.y, mode === 'fog' ? p.s * 1.6 : p.s, mode === 'fog' ? 0.06 : 0.07);
    }
  }
  raf = requestAnimationFrame(frame);
}

export function setWeatherEffect(code, isDay) {
  const day = isDay !== 0;
  let next = 'none';
  if (code >= 95) next = 'storm';
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) next = 'snow';
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) next = 'rain';
  else if (code >= 51 && code <= 57) next = 'drizzle';
  else if (code === 45 || code === 48) next = 'fog';
  else if (!day && code <= 2) next = 'stars';
  else if (code <= 1) next = 'sun';
  else next = 'clouds';

  if (reduceMotion) next = next === 'stars' ? 'stars' : 'none';
  if (next === mode && raf) return;
  mode = next;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  resize();
  if (mode !== 'none') {
    canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: 'ease-out' });
    raf = requestAnimationFrame(frame);
  } else ctx.clearRect(0, 0, w, h);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
  else if (mode !== 'none' && !raf) raf = requestAnimationFrame(frame);
});
