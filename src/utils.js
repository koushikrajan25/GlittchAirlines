const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function parseDuration(text) {
  const m = /^\s*(\d{1,4})\s*([mhd])\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (n <= 0) return null;
  return n * { m: MIN, h: HOUR, d: DAY }[m[2].toLowerCase()];
}

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / MIN));
  if (total === 0) return '0m';
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ');
}

function formatTime(ms, timeZone = 'UTC') {
  const text = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(ms));
  return `${text} (${timeZone})`;
}

module.exports = { MIN, HOUR, DAY, parseDuration, formatDuration, formatTime };
