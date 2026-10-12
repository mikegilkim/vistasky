// 48-hour temperature + precipitation probability chart
import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm';
Chart.register(...registerables);

let chart = null;

const fmtHour = (iso) => {
  const h = parseInt(iso.slice(11, 13), 10);
  return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
};
const fmtFull = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric' });
};

export function renderTrendChart(hourly, startIdx, unit) {
  const dark = document.documentElement.classList.contains('dark');
  const C = dark
    ? { grid: '#1e293b', tick: '#64748b', popTick: '#3b82f6', sep: '#334155', fill: 'rgba(59,130,246,0.22)', hoverBorder: '#0f172a', tip: '#1e293b' }
    : { grid: '#f1f5f9', tick: '#94a3b8', popTick: '#93c5fd', sep: '#e2e8f0', fill: 'rgba(59,130,246,0.15)', hoverBorder: '#fff', tip: '#0f172a' };
  const end = Math.min(startIdx + 48, hourly.time.length);
  const times = hourly.time.slice(startIdx, end);
  const temps = hourly.temperature_2m.slice(startIdx, end);
  const pops = hourly.precipitation_probability.slice(startIdx, end).map((v) => v ?? 0);
  const tMin = Math.min(...temps), tMax = Math.max(...temps);
  const pad = Math.max(2, (tMax - tMin) * 0.25);

  const data = {
    labels: times,
    datasets: [
      {
        label: 'Temperature',
        data: temps,
        yAxisID: 'yTemp',
        borderColor: '#f97316',
        backgroundColor: '#f97316',
        borderWidth: 2.5,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: C.hoverBorder,
        order: 1,
      },
      {
        label: 'Chance of rain',
        data: pops,
        yAxisID: 'yPop',
        borderColor: '#3b82f6',
        backgroundColor: C.fill,
        borderWidth: 1.5,
        fill: 'origin',
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBorderColor: C.hoverBorder,
        order: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: C.tip,
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
        boxWidth: 8, boxHeight: 8, boxPadding: 4,
        titleFont: { family: 'Inter', weight: '600', size: 12 },
        bodyFont: { family: 'Inter', size: 12 },
        callbacks: {
          title: (items) => (items[0].dataIndex === 0 ? 'Now' : fmtFull(items[0].label)),
          label: (ctx) => ctx.datasetIndex === 0
            ? ` ${Math.round(ctx.parsed.y)}°${unit === 'fahrenheit' ? 'F' : 'C'}`
            : ` ${ctx.parsed.y}% rain`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: C.tick,
          font: { family: 'Inter', size: 11 },
          maxRotation: 0,
          autoSkip: false,
          callback: function (val, i) {
            const iso = this.getLabelForValue(val);
            if (i === 0) return 'Now';
            const h = parseInt(iso.slice(11, 13), 10);
            if (h === 0) return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });
            const step = window.innerWidth < 640 ? 6 : 3;
            return h % step === 0 ? fmtHour(iso) : '';
          },
        },
      },
      yTemp: {
        position: 'left',
        suggestedMin: Math.floor(tMin - pad),
        suggestedMax: Math.ceil(tMax + pad),
        grid: { color: C.grid },
        border: { display: false },
        ticks: { color: C.tick, font: { family: 'Inter', size: 11 }, maxTicksLimit: 5, callback: (v) => `${Math.round(v)}°` },
      },
      yPop: {
        position: 'right',
        min: 0,
        max: 100,
        grid: { display: false },
        border: { display: false },
        ticks: { color: C.popTick, font: { family: 'Inter', size: 11 }, stepSize: 50, callback: (v) => `${v}%` },
      },
    },
  };

  // Vertical midnight separators
  const midnightLines = {
    id: 'midnightLines',
    beforeDatasetsDraw(c) {
      const { ctx, chartArea, scales } = c;
      ctx.save();
      ctx.strokeStyle = C.sep;
      ctx.setLineDash([3, 3]);
      times.forEach((iso, i) => {
        if (i > 0 && iso.slice(11, 13) === '00') {
          const x = scales.x.getPixelForValue(i);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
      });
      ctx.restore();
    },
  };

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('trendChart'), { type: 'line', data, options, plugins: [midnightLines] });
}
