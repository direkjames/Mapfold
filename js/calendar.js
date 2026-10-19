// Mapfold — custom calendars. Author: direk james
//
// A date is stored as ONE whole number: the day count since day 1 of year 0. The calendar only decides how
// that number is written (months, weekdays, eras), so date maths stays trivial and editing the calendar
// never corrupts what events point at. Pure functions only.

const MAX_MONTHS = 48, MAX_DAYS = 1000, MAX_WEEKDAYS = 30, MAX_ERAS = 12, MAX_YEAR = 1e6;

export function defaultCalendar() {
  return {
    name: 'Common reckoning',
    months: ['Deepwinter', 'Thawing', 'Seedtime', 'Bloom', 'Highsun', 'Harvest', 'Embertide', 'Leaffall', 'Frostwane', 'Longnight', 'Snowmoot', 'Yearsend']
      .map(name => ({ name, days: 30 })),
    weekdays: ['Moonday', 'Fireday', 'Waterday', 'Earthday', 'Windday', 'Starday', 'Sunday'],
    eras: [{ name: 'AR', from: -MAX_YEAR }],
  };
}

const int = (v, lo, hi, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const text = (v, d) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || d;

/** Make any stored or imported calendar safe to use: bounded sizes, no empty month lists, no NaN. */
export function cleanCalendar(raw) {
  const base = defaultCalendar();
  if (!raw || typeof raw !== 'object') return base;
  const months = (Array.isArray(raw.months) ? raw.months : []).slice(0, MAX_MONTHS)
    .map((m, i) => ({ name: text(m?.name, `Month ${i + 1}`), days: int(m?.days, 1, MAX_DAYS, 30) }));
  const weekdays = (Array.isArray(raw.weekdays) ? raw.weekdays : []).slice(0, MAX_WEEKDAYS).map((w, i) => text(w, `Day ${i + 1}`));
  const eras = (Array.isArray(raw.eras) ? raw.eras : []).slice(0, MAX_ERAS)
    .map(e => ({ name: text(e?.name, ''), from: int(e?.from, -MAX_YEAR, MAX_YEAR, 0) })).filter(e => e.name);
  return {
    name: text(raw.name, base.name),
    months: months.length ? months : base.months,
    weekdays: weekdays.length ? weekdays : base.weekdays,
    eras: eras.sort((a, b) => a.from - b.from),
  };
}

export const yearLength = cal => cal.months.reduce((n, m) => n + m.days, 0);
export const clampDay = n => int(n, -MAX_YEAR * 1e4, MAX_YEAR * 1e4, 0);
export const isDay = n => Number.isFinite(n) && Number.isInteger(n);

/** Break a day number into year, month index, day of month (1-based), weekday index and era. */
export function partsOf(day, cal) {
  const L = yearLength(cal);
  const year = Math.floor(day / L);
  let rest = day - year * L;
  let month = 0;
  while (month < cal.months.length - 1 && rest >= cal.months[month].days) { rest -= cal.months[month].days; month++; }
  const W = cal.weekdays.length;
  const weekday = (((day % W) + W) % W);
  const era = [...cal.eras].reverse().find(e => e.from <= year) || null;
  return { year, month, day: rest + 1, weekday, era: era ? era.name : '' };
}

/** The inverse: year, month index and day of month (clamped to what the month holds) to a day number. */
export function dayOf({ year, month, day }, cal) {
  const L = yearLength(cal);
  const y = int(year, -MAX_YEAR, MAX_YEAR, 0);
  const mi = int(month, 0, cal.months.length - 1, 0);
  const d = int(day, 1, cal.months[mi].days, 1);
  let n = y * L;
  for (let i = 0; i < mi; i++) n += cal.months[i].days;
  return n + d - 1;
}

/** "Moonday, 14 Highsun 1042 AR" */
export function formatDay(day, cal, { weekday = false } = {}) {
  if (!isDay(day)) return '';
  const p = partsOf(day, cal);
  const core = `${p.day} ${cal.months[p.month].name} ${p.year}${p.era ? ' ' + p.era : ''}`;
  return weekday ? `${cal.weekdays[p.weekday]}, ${core}` : core;
}

/** A range, kept short when both ends share a month: "3 to 9 Highsun 1042 AR". */
export function formatRange(a, b, cal) {
  if (!isDay(a)) return '';
  if (!isDay(b) || b <= a) return formatDay(a, cal);
  const pa = partsOf(a, cal), pb = partsOf(b, cal);
  if (pa.year === pb.year && pa.month === pb.month) return `${pa.day} to ${formatDay(b, cal)}`;
  return `${formatDay(a, cal)} to ${formatDay(b, cal)}`;
}

/** Dated events first (oldest first), then undated ones by name. */
export function byDate(a, b) {
  const da = isDay(a.day), db = isDay(b.day);
  if (da && db) return a.day - b.day || (a.endDay ?? a.day) - (b.endDay ?? b.day) || (a.name || '').localeCompare(b.name || '');
  if (da !== db) return da ? -1 : 1;
  return (a.name || '').localeCompare(b.name || '');
}
