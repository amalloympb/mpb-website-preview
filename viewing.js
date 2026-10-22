/* Viewing picker: shows diary-based viewing times from /api/availability and books through /api/viewings.
   Loaded after common.js. If the API is missing or has no times, load() resolves null and the page keeps its normal enquiry form. */
(() => {
  'use strict';
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const utcDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
  const fmt = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o });
  const wk = fmt({ weekday: 'short' }), dm = fmt({ day: 'numeric', month: 'short' }), long = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const ukKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);

  const dayLabel = key => {
    if (key === ukKey(new Date())) return 'Today';
    if (key === ukKey(new Date(Date.now() + 864e5))) return 'Tomorrow';
    return wk.format(utcDate(key));
  };

  const fetchDays = async id => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(`api/availability?property=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, signal: ctl.signal });
      if (!r.ok) return null;
      const j = await r.json();
      return j && Array.isArray(j.days) && j.days.length ? j : null;
    } catch (e) { return null; } finally { clearTimeout(timer); }
  };

  async function load(id, { host, onChange = () => {} }) {
    let data = await fetchDays(id);
    if (!data) return null;
    let sel = null, dayKey = null;

    const head = el('div', 'vp-head');
    head.append(el('span', 'vp-title', 'Choose a day and time'));
    const daysEl = el('div', 'vp-days'); daysEl.setAttribute('role', 'radiogroup'); daysEl.setAttribute('aria-label', 'Viewing day');
    const timesEl = el('div', 'vp-times'); timesEl.setAttribute('role', 'radiogroup'); timesEl.setAttribute('aria-label', 'Viewing time');
    const selEl = el('p', 'vp-sel'); selEl.setAttribute('aria-live', 'polite');
    const note = el('p', 'vp-note', 'UK time. Viewings are 30 minutes and a member of the team will confirm your time.');
    const legend = el('p', 'vp-legend'); legend.hidden = true;
    legend.append(el('i', 'vp-dot'), ' Our team is already in the area at this time');
    host.setAttribute('data-skip', '');
    host.replaceChildren(head, daysEl, timesEl, selEl, legend, note);

    const radio = (name, value, checked) => { const i = el('input'); i.type = 'radio'; i.name = name; i.value = value; i.checked = checked; return i; };

    const renderTimes = () => {
      const day = data.days.find(d => d.date === dayKey);
      timesEl.replaceChildren(...day.slots.map(s => {
        const lab = el('label', 'vp-time');
        const i = radio('vp_time', s.start, !!sel && sel.start === s.start);
        const sp = el('span', s.nearby ? 'near' : '', s.t);
        i.addEventListener('change', () => {
          const lab2 = dayLabel(day.date);
          const when = lab2 === 'Today' || lab2 === 'Tomorrow' ? lab2 : dm.format(utcDate(day.date));
          sel = { start: s.start, t: s.t, date: day.date, short: `${when} at ${s.t}`, long: `${long.format(utcDate(day.date))} at ${s.t}` };
          selEl.textContent = sel.long;
          track('mpb_slot_pick', { id, nearby: s.nearby });
          onChange();
        });
        lab.append(i, sp);
        return lab;
      }));
      legend.hidden = !day.slots.some(s => s.nearby);
    };

    const renderDays = () => {
      daysEl.replaceChildren(...data.days.map(d => {
        const lab = el('label', 'vp-day');
        const i = radio('vp_day', d.date, d.date === dayKey);
        i.addEventListener('change', () => { dayKey = d.date; sel = null; selEl.textContent = ''; renderTimes(); onChange(); });
        const sp = el('span');
        sp.append(el('b', '', dayLabel(d.date)), el('i', '', dm.format(utcDate(d.date))));
        lab.append(i, sp);
        return lab;
      }));
    };

    const build = () => { if (!data.days.some(d => d.date === dayKey)) dayKey = data.days[0].date; renderDays(); renderTimes(); };
    build();
    if (data.mode === 'demo') {
      const d = el('span', 'vp-demo', 'Demo availability');
      d.title = 'Sample diary data for demonstration. Real times will come from the live diary.';
      head.append(d);
    }
    track('mpb_slot_view', { id, days: data.days.length, mode: data.mode });

    return {
      selected: () => sel,
      async refresh() {
        const next = await fetchDays(id);
        if (!next) return false;
        data = next; sel = null; selEl.textContent = ''; build(); onChange();
        return true;
      },
      async book(fields) {
        if (!sel) throw Object.assign(new Error('no slot'), { code: 'no_slot' });
        let r, j = {};
        try {
          r = await fetch('api/viewings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, property: id, start: sel.start, attribution }) });
          j = await r.json().catch(() => ({}));
        } catch (e) { throw Object.assign(new Error('network'), { code: 'network' }); }
        if (r.status === 409) { await this.refresh(); throw Object.assign(new Error('taken'), { code: 'taken' }); }
        if (r.status === 429) throw Object.assign(new Error('rate'), { code: 'rate' });
        if (!r.ok || !j.ok) throw Object.assign(new Error('failed'), { code: 'failed' });
        return j;
      }
    };
  }

  window.MPBViewing = { load };
})();
