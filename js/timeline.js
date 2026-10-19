// Mapfold — calendar editor, date pickers and the timeline view. Author: direk james
// Dates are day numbers (see calendar.js); this file only draws and reads them.
import { esc, $, $$, dialog } from './ui.js';
import { icon } from './icons.js';
import { displayName, typeOf, snippet } from './entries.js';
import { cleanCalendar, defaultCalendar, partsOf, dayOf, formatDay, formatRange, byDate, isDay, clampDay } from './calendar.js';

// ---------- date picker ----------

/** One date: year, month and day boxes, or a "Set date" button while empty (when the date is optional). */
export function dateRowHtml(key, label, day, cal, { optional = true } = {}) {
  const head = `<span class="dt-label">${esc(label)}</span>`;
  if (!isDay(day)) return `<div class="dt dt-empty" data-dt="${key}">${head}<button type="button" class="btn btn-sm" data-dt-set="${key}">${icon('plus')}Set a date</button></div>`;
  const p = partsOf(day, cal);
  return `<div class="dt" data-dt="${key}">${head}
    <div class="dt-box">
      <input type="number" class="dt-d" aria-label="Day" min="1" max="${cal.months[p.month].days}" value="${p.day}">
      <select class="dt-m" aria-label="Month">${cal.months.map((m, i) => `<option value="${i}" ${i === p.month ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      <input type="number" class="dt-y" aria-label="Year" step="1" value="${p.year}">
      ${p.era ? `<span class="dt-era">${esc(p.era)}</span>` : ''}
      ${optional ? `<button type="button" class="ph-btn" data-dt-clear="${key}" title="Remove this date">${icon('close')}</button>` : ''}
    </div>
    <small class="dt-read">${esc(cal.weekdays[p.weekday])}</small></div>`;
}

/** Wire every date row under root. onSet(key, day|null) is called after each change. */
export function bindDateRows(root, cal, anchor, onSet) {
  const at = k => { const d = typeof anchor === 'function' ? anchor(k) : anchor; return isDay(d) ? d : 0; };
  $$('[data-dt-set]', root).forEach(b => b.onclick = () => onSet(b.dataset.dtSet, at(b.dataset.dtSet)));
  $$('[data-dt-clear]', root).forEach(b => b.onclick = () => onSet(b.dataset.dtClear, null));
  $$('.dt:not(.dt-empty)', root).forEach(row => {
    const read = () => dayOf({ year: $('.dt-y', row).value, month: $('.dt-m', row).value, day: $('.dt-d', row).value }, cal);
    $$('input,select', row).forEach(i => i.onchange = () => onSet(row.dataset.dt, read()));
  });
}

// ---------- calendar editor ----------

export async function calendarDialog(world) {
  const cal = cleanCalendar(world.calendar);
  let today = isDay(world.currentDay) ? world.currentDay : 0;
  const body = `
    <label class="field"><span>Name of this calendar</span><input name="cname" value="${esc(cal.name)}" maxlength="40"></label>
    <div class="cal-sec"><h4>Months</h4><div class="cal-rows" id="cal-months"></div>
      <button type="button" class="btn btn-sm" id="cal-addm">${icon('plus')}Add a month</button></div>
    <label class="field"><span>Days of the week</span><input name="wdays" value="${esc(cal.weekdays.join(', '))}" placeholder="Comma separated"></label>
    <div class="cal-sec"><h4>Eras</h4><p class="cal-note">An era names the years from its starting year onward, like AR or Third Age.</p>
      <div class="cal-rows" id="cal-eras"></div><button type="button" class="btn btn-sm" id="cal-adde">${icon('plus')}Add an era</button></div>
    <div class="cal-sec"><h4>Today in your world</h4><div id="cal-today"></div></div>
    <p class="cal-warn" id="cal-warn"></p>`;
  let months = cal.months.map(m => ({ ...m })), eras = cal.eras.map(e => ({ ...e }));
  const { value, form } = await dialog({
    title: 'Calendar', wide: true, body,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save calendar', value: 'ok', primary: true, validate: f => !!$('[name=cname]', f).value.trim() }],
    onOpen: f => {
      const live = () => cleanCalendar({ months, weekdays: $('[name=wdays]', f).value.split(','), eras, name: 'x' });
      const paintToday = () => {
        const c = live();
        $('#cal-today', f).innerHTML = dateRowHtml('today', 'Current date', today, c, { optional: false });
        bindDateRows($('#cal-today', f), c, today, (k, d) => { today = d; paintToday(); });
      };
      const paint = () => {
        $('#cal-months', f).innerHTML = months.map((m, i) => `<div class="cal-row" data-i="${i}">
          <input class="cm-name" value="${esc(m.name)}" maxlength="40" aria-label="Month name">
          <input class="cm-days" type="number" min="1" max="1000" value="${m.days}" aria-label="Days in month"><span class="cal-unit">days</span>
          <button type="button" class="ph-btn" data-rm="${i}" title="Remove month" ${months.length < 2 ? 'disabled' : ''}>${icon('trash')}</button></div>`).join('');
        $('#cal-eras', f).innerHTML = eras.map((e, i) => `<div class="cal-row" data-i="${i}">
          <input class="ce-name" value="${esc(e.name)}" maxlength="40" aria-label="Era name" placeholder="AR">
          <span class="cal-unit">from year</span><input class="ce-from" type="number" step="1" value="${e.from}" aria-label="Starting year">
          <button type="button" class="ph-btn" data-rme="${i}" title="Remove era">${icon('trash')}</button></div>`).join('') || '<p class="cal-note">No eras: years are shown as plain numbers.</p>';
        const L = months.reduce((n, m) => n + (+m.days || 0), 0);
        $('#cal-warn', f).textContent = `A year has ${L} days. Events keep their day number, so changing month lengths can move their dates.`;
        paintToday();
      };
      f.addEventListener('input', ev => {
        const row = ev.target.closest('.cal-row'); if (!row) return;
        const i = +row.dataset.i;
        if (ev.target.classList.contains('cm-name')) months[i].name = ev.target.value;
        else if (ev.target.classList.contains('cm-days')) { months[i].days = ev.target.value; $('#cal-warn', f).textContent = `A year has ${months.reduce((n, m) => n + (+m.days || 0), 0)} days. Events keep their day number, so changing month lengths can move their dates.`; }
        else if (ev.target.classList.contains('ce-name')) eras[i].name = ev.target.value;
        else if (ev.target.classList.contains('ce-from')) eras[i].from = ev.target.value;
      });
      f.addEventListener('change', ev => { if (ev.target.closest('.cal-row')) paintToday(); });
      f.addEventListener('click', ev => {
        const rm = ev.target.closest('[data-rm]'), rme = ev.target.closest('[data-rme]');
        if (rm && months.length > 1) { months.splice(+rm.dataset.rm, 1); paint(); }
        else if (rme) { eras.splice(+rme.dataset.rme, 1); paint(); }
        else if (ev.target.closest('#cal-addm') && months.length < 48) { months.push({ name: `Month ${months.length + 1}`, days: 30 }); paint(); $$('.cm-name', f).at(-1)?.select(); }
        else if (ev.target.closest('#cal-adde') && eras.length < 12) { eras.push({ name: '', from: 0 }); paint(); $$('.ce-name', f).at(-1)?.focus(); }
      });
      paint();
    },
  });
  if (value !== 'ok') return null;
  const out = cleanCalendar({
    name: $('[name=cname]', form).value, months: $$('.cal-row', $('#cal-months', form)).map(r => ({ name: $('.cm-name', r).value, days: $('.cm-days', r).value })),
    weekdays: $('[name=wdays]', form).value.split(','),
    eras: $$('.cal-row', $('#cal-eras', form)).map(r => ({ name: $('.ce-name', r).value, from: $('.ce-from', r).value })),
  });
  return { calendar: out, currentDay: clampDay(today) };
}

// ---------- timeline ----------

/** Events grouped by year, oldest first, with a marker where "today" falls. */
export function timelineHtml(events, cal, { today = null, placeId = '', byId, selected = '' } = {}) {
  const shown = events.filter(e => !placeId || (e.placeIds || []).includes(placeId)).sort(byDate);
  const dated = shown.filter(e => isDay(e.day)), undated = shown.filter(e => !isDay(e.day));
  const card = e => {
    const places = (e.placeIds || []).map(id => byId.get(id)).filter(Boolean);
    return `<button type="button" class="tl-card ${e.id === selected ? 'on' : ''}" data-id="${e.id}">
      <span class="tl-date">${esc(isDay(e.day) ? formatRange(e.day, e.endDay, cal) : 'No date yet')}</span>
      <strong>${esc(displayName(e))}${e.secret ? ` <span class="tl-lock">${icon('lock')}</span>` : ''}</strong>
      ${places.length ? `<span class="tl-places">${icon('pin')}${places.map(p => esc(displayName(p))).join(', ')}</span>` : ''}
      ${e.body.trim() ? `<small>${esc(snippet(e.body, 110))}</small>` : ''}</button>`;
  };
  const parts = [];
  let lastYear = null, todayDone = !isDay(today);
  const todayMark = () => `<div class="tl-today">${icon('clock')}<span>Today, ${esc(formatDay(today, cal, { weekday: true }))}</span></div>`;
  for (const e of dated) {
    if (!todayDone && e.day > today) { parts.push(todayMark()); todayDone = true; }
    const p = partsOf(e.day, cal);
    if (p.year !== lastYear) { lastYear = p.year; parts.push(`<h3 class="tl-year">Year ${p.year}${p.era ? ' ' + esc(p.era) : ''}</h3>`); }
    parts.push(card(e));
  }
  if (!todayDone) parts.push(todayMark());
  const empty = !shown.length ? `<div class="wk-empty"><p><strong>${placeId ? 'No events at this place yet.' : 'The timeline is empty.'}</strong></p><p>Create an Event in the wiki, give it a date and the places it happened. It will appear here in order.</p></div>` : '';
  return `${parts.length ? `<div class="tl-track">${parts.join('')}</div>` : ''}
    ${undated.length ? `<h3 class="tl-year tl-und">Undated</h3><div class="tl-track tl-flat">${undated.map(card).join('')}</div>` : ''}${empty}`;
}
