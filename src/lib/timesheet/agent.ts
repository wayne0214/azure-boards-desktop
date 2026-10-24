/**
 * Scripts injected into the TimeSheet page. Each operation is an async IIFE that
 * finds controls by their accessible labels (which the site keeps stable) and reports
 * back through the `timesheet_report` command.
 */

const HELPERS = `
// Hidden windows get no animation frames, and the site's grid waits for them. Fall back to timers.
await new Promise((resolve) => {
  if (window.__tsRafChecked) return resolve();
  window.__tsRafChecked = true;
  let fired = false;
  requestAnimationFrame(() => { fired = true; resolve(); });
  setTimeout(() => {
    if (fired) return;
    window.__tsRafPatched = true;
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    resolve();
  }, 400);
});
const __ts = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  text: (el) => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : ''),
  norm: (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(),
  async waitFor(fn, timeout = 15000, every = 120, what = 'the page') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { const v = fn(); if (v) return v; } catch (e) {}
      await this.sleep(every);
    }
    throw new Error('Timed out waiting for ' + what);
  },
  // Long project names may be cut short ("…") in the grid, and several can share a long prefix:
  // an exact match wins, a shortened one only counts when it fits a single row.
  sameProject(shown, want) {
    const a = __ts.norm(shown).replace(/(\u2026|\\.\\.\\.)$/, '').trim();
    const b = __ts.norm(want);
    if (!a || !b) return false;
    return a === b || (a.length >= 20 && b.startsWith(a)) || (b.length >= 20 && a.startsWith(b));
  },
  findProject(list, want, nameOf) {
    const exact = list.filter((x) => __ts.norm(nameOf(x)) === __ts.norm(want));
    if (exact.length) return exact[0];
    const near = list.filter((x) => __ts.sameProject(nameOf(x), want));
    return near.length === 1 ? near[0] : null;
  },
  isLogin() {
    return /\\/account\\/login/i.test(location.pathname) || !!Array.from(document.querySelectorAll('button, a')).find((b) => /login with/i.test(__ts.text(b)));
  },
  buttonByText(re, root = document) {
    return Array.from(root.querySelectorAll('button, a, [role=button]')).find((b) => re.test(__ts.text(b)) || re.test(b.getAttribute('aria-label') || '')) || null;
  },
  setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
    el.blur();
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  },
  dataRows() {
    // A data row is one that has a weekly-comment button (or editing controls) and a project cell.
    return Array.from(document.querySelectorAll('[role=grid] [role=row]')).filter((row) => {
      const cells = row.querySelectorAll('[role=gridcell]');
      if (cells.length < 9) return false;
      return !row.querySelector('[aria-label="Expand group"], [aria-label="Collapse group"]');
    });
  },
  options() {
    // Radzen moves the open dropdown panel to the end of <body>; closed, the options sit inside the combobox.
    return Array.from(document.querySelectorAll('[role=option]')).filter((o) => !o.closest('[role=columnheader]'));
  },
  async confirmDialog(re, timeout = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const btn = Array.from(document.querySelectorAll('[role=dialog] button, .rz-dialog button')).find((b) => re.test(__ts.text(b)));
      if (btn) { btn.click(); await this.sleep(400); return true; }
      await this.sleep(150);
    }
    return false;
  },
  parseHours(t) { const n = parseFloat(String(t).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; },
  readWeek() {
    const rows = [];
    const all = this.dataRows();
    for (const row of all) {
      const cells = Array.from(row.querySelectorAll('[role=gridcell]'));
      // Layout: [status/expander] [project] [sun..sat] [total] [note] [actions]
      const texts = cells.map((c) => __ts.text(c));
      const editing = !!row.querySelector('[aria-label="Project for this week"]');
      if (editing) continue;
      const projectIdx = cells.findIndex((c, i) => i > 0 && __ts.text(c) && !/^[0-9.—-]*$/.test(__ts.text(c)));
      if (projectIdx < 0) continue;
      const project = texts[projectIdx];
      const dayTexts = texts.slice(projectIdx + 1, projectIdx + 8);
      if (dayTexts.length < 7) continue;
      const hours = dayTexts.map((t) => __ts.parseHours(t === '—' ? '0' : t));
      const total = __ts.parseHours(texts[projectIdx + 8] || '0');
      const actionsText = texts.slice(projectIdx + 9).join(' ');
      const buttons = Array.from(row.querySelectorAll('button')).map((b) => __ts.text(b) || b.getAttribute('aria-label') || '');
      const status = /approved/i.test(actionsText) ? 'approved' : /submitted/i.test(actionsText) ? 'submitted' : /reject|needs/i.test(actionsText) ? 'rejected' : 'saved';
      const locked = !buttons.some((b) => /edit/i.test(b));
      rows.push({ project, hours, total, status, locked, buttons, index: all.indexOf(row) });
    }
    const heading = __ts.text(document.querySelector('main h1, main h2, main h3')) || '';
    return { url: location.href, heading, rows };
  },
  report(payload) {
    const json = JSON.stringify(payload);
    // Channel 1: the Tauri IPC (when the remote capability allows it).
    try { const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; if (inv) inv('timesheet_report', { payload }); } catch (e) {}
    // Channel 2: the app's own URL scheme, which needs no IPC at all.
    const q = '/r?p=' + encodeURIComponent(json);
    for (const base of ['tsbridge://localhost', 'http://tsbridge.localhost']) {
      try { fetch(base + q, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (e) {}
    }
    // Channel 3: a navigation the app intercepts and cancels before it happens.
    try { location.assign('tsreport://localhost' + q); } catch (e) {}
  },
};
`

export function opScript(id: string, body: string): string {
  return `(async () => {
  ${HELPERS}
  const __report = (data, error) => __ts.report({ id: ${JSON.stringify(id)}, ok: !error, data: data === undefined ? null : data, error: error ? String(error.message || error) : null, url: location.href });
  // A step the app should know about before the op ends (the page may not survive to report the end).
  const __progress = (step) => __ts.report({ id: ${JSON.stringify(id)} + ':progress', ok: true, data: step, error: null, url: location.href });
  try {
    const data = await (async () => { ${body} })();
    __report(data, null);
  } catch (e) {
    __report(null, e);
  }
})();`
}

/**
 * Wipe what the current page's origin keeps in the browser: storage, caches and service workers.
 * A stale service worker or cached bundle left over from a site update shows up as a blank page.
 */
export const clearSiteStorageBody = `
  const done = [];
  try { localStorage.clear(); done.push('local'); } catch (e) {}
  try { sessionStorage.clear(); done.push('session'); } catch (e) {}
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      done.push('sw:' + regs.length);
    }
  } catch (e) {}
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      done.push('caches:' + keys.length);
    }
  } catch (e) {}
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      done.push('idb:' + dbs.length);
    }
  } catch (e) {}
  return { origin: location.origin, done };
`

/** Where are we: login page, ready page, or still loading? */
export const probeBody = `
  return { login: __ts.isLogin(), ready: document.readyState === 'complete', hasGrid: !!document.querySelector('[role=grid]'), title: document.title, path: location.pathname, href: location.href, ipc: !!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke), rafPatched: !!window.__tsRafPatched };
`

/**
 * On the login page, press the site's "Login with …" button; with a live Entra session this signs in silently.
 * The press waits until this op has reported back: the report's tsreport:// navigation would
 * otherwise replace the form submission it starts, and the page would never leave the login screen.
 */
export const autoLoginBody = `
  if (!__ts.isLogin()) return { login: false, path: location.pathname };
  const btn = Array.from(document.querySelectorAll('button, a')).find((b) => /login with/i.test(__ts.text(b)));
  if (btn) setTimeout(() => { if (btn.form && btn.form.requestSubmit) btn.form.requestSubmit(btn); else btn.click(); }, 600);
  return { clicked: !!btn };
`

/** Read the project list by opening a new row and cancelling it. */
export const listProjectsBody = `
  if (__ts.isLogin()) throw new Error('login');
  await __ts.waitFor(() => document.querySelector('[role=grid]'), 20000);
  const existing = document.querySelector('[aria-label="Project for this week"]');
  let addInfo = 'existing';
  if (!existing) {
    const add = __ts.buttonByText(/add project/i);
    if (!add) throw new Error('Could not find the Add project button');
    addInfo = add.tagName + ':' + __ts.text(add);
    add.click();
  }
  let combo;
  try {
    combo = await __ts.waitFor(() => document.querySelector('[aria-label="Project for this week"]'), 10000);
  } catch (e) {
    throw new Error('No edit row after clicking ' + addInfo + '; cells=' + document.querySelectorAll('[role=gridcell]').length + '; raf=' + (await new Promise((r) => { let done = false; requestAnimationFrame(() => { done = true; r('yes'); }); setTimeout(() => !done && r('no'), 800); })) + '; main=' + __ts.text(document.querySelector('main')).slice(0, 160));
  }
  await __ts.sleep(300);
  let names = __ts.options().map((o) => __ts.text(o)).filter(Boolean);
  if (names.length === 0) { combo.click(); await __ts.sleep(400); names = __ts.options().map((o) => __ts.text(o)).filter(Boolean); document.body.click(); }
  const cancel = __ts.buttonByText(/^cancel$/i, combo.closest('[role=row]') || document);
  if (cancel) { cancel.click(); await __ts.confirmDialog(/^discard$/i); }
  await __ts.sleep(300);
  return names;
`

export const readWeekBody = `
  if (__ts.isLogin()) throw new Error('login');
  await __ts.waitFor(() => document.querySelector('[role=grid]'), 20000);
  await __ts.sleep(400);
  return __ts.readWeek();
`

/** Create or update one project-week row and press Save. */
export function saveRowBody(project: string, hours: number[], note: string): string {
  return `
  if (__ts.isLogin()) throw new Error('login');
  await __ts.waitFor(() => document.querySelector('[role=grid]'), 20000);
  const want = ${JSON.stringify(project)};
  const hours = ${JSON.stringify(hours)};
  const note = ${JSON.stringify(note)};
  // Step timings, shown in the app's run notes so a slow save says where the time went.
  const t0 = Date.now();
  const steps = [];
  const mark = (what) => steps.push(what + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  const dialogs = () => Array.from(document.querySelectorAll('[role=dialog], .rz-dialog, [role=alert], .rz-notification-message, .rz-message, .validation-message')).map((el) => __ts.text(el)).filter(Boolean).join(' · ').slice(0, 200);
  // Is this project already on the page?
  const before = __ts.findProject(__ts.readWeek().rows, want, (r) => r.project);
  // An edit row the site left open earlier is not ours; only one that appears after the click is.
  const stale = new Set(Array.from(document.querySelectorAll('[aria-label^="Sunday hours"]')));
  let isNew = true;
  if (before) {
    if (before.locked) return { skipped: true, reason: 'This row is ' + before.status + ' and cannot be changed.' };
    const row = __ts.dataRows()[before.index];
    const edit = row && __ts.buttonByText(/edit/i, row);
    if (!edit) throw new Error('Could not find the Edit button for ' + want);
    edit.click();
    isNew = false;
  } else {
    const add = __ts.buttonByText(/add project/i);
    if (!add) throw new Error('Could not find the Add project button');
    add.click();
  }
  const editRow = await __ts.waitFor(() => {
    const spin = Array.from(document.querySelectorAll('[aria-label^="Sunday hours"]')).find((el) => !stale.has(el));
    return spin ? spin.closest('[role=row]') : null;
  }, 10000, 120, 'the edit row');
  mark(isNew ? 'row added' : 'row opened');
  if (isNew) {
    const combo = editRow.querySelector('[aria-label="Project for this week"]');
    if (!combo) throw new Error('Project picker not found');
    combo.click();
    await __ts.sleep(350);
    // Prefer the option in the opened panel (appended to <body>) over the hidden template inside the combobox.
    const option = await __ts.waitFor(() => __ts.findProject(__ts.options().filter((o) => !combo.contains(o)), want, __ts.text) || __ts.findProject(__ts.options(), want, __ts.text), 6000, 120, 'the project in the list');
    option.click();
    await __ts.sleep(500);
    if (!__ts.sameProject(__ts.text(combo), want)) throw new Error('Could not select the project ' + want);
    mark('project picked');
  }
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (let i = 0; i < 7; i++) {
    const input = editRow.querySelector('[aria-label^="' + days[i] + ' hours"]');
    if (!input) throw new Error('Hour box for ' + days[i] + ' not found');
    __ts.setValue(input, hours[i] || 0);
    await __ts.sleep(120);
  }
  const noteBox = document.querySelector('[placeholder*="Describe this week"]');
  if (noteBox) { __ts.setValue(noteBox, note || ''); await __ts.sleep(150); }
  const save = __ts.buttonByText(/^save$/i, editRow) || __ts.buttonByText(/save/i, editRow);
  if (!save) throw new Error('Save button not found');
  mark('hours filled');
  save.click();
  __progress('saved');
  const confirmed = await __ts.confirmDialog(/^(save|yes|confirm|ok)$/i, 1500);
  mark(confirmed ? 'confirmed' : 'saved (no confirm)');
  const afterSave = dialogs();
  if (afterSave) steps.push('page says: ' + afterSave);
  // From here on the site may already hold the row: say what is on screen rather than "timed out",
  // so the app checks the week instead of entering everything a second time.
  // Done when this edit row closes, or the grid already shows the project with these hours; the site
  // may leave another edit row open (a fresh blank one), so "no hour boxes anywhere" can take forever.
  const landed = () => {
    const r = __ts.findProject(__ts.readWeek().rows, want, (x) => x.project);
    return r && r.hours.every((h, d) => Math.abs(h - (hours[d] || 0)) < 0.01);
  };
  let how = '';
  try {
    how = await __ts.waitFor(() => (!editRow.isConnected ? 'row replaced' : !editRow.querySelector('[aria-label^="Sunday hours"]') ? 'row closed' : landed() ? 'row in grid' : ''), 30000, 250);
  } catch (e) {
    const shown = dialogs();
    const open = document.querySelectorAll('[aria-label^="Sunday hours"]').length;
    throw new Error('Saving did not finish (' + steps.join(', ') + '; ' + open + ' edit row(s) still open' + (shown ? '; page says: ' + shown : '') + ')');
  }
  mark(how);
  await __ts.sleep(500);
  // The row closed or shows without complaint, so the site took it even if its name reads differently in the grid.
  return { saved: true, steps, row: __ts.findProject(__ts.readWeek().rows, want, (r) => r.project) };
  `
}

/** On the Saved entries page, submit everything that is saved. */
export const submitAllBody = `
  if (__ts.isLogin()) throw new Error('login');
  await __ts.waitFor(() => document.querySelector('[role=grid]'), 20000);
  await __ts.sleep(400);
  if (/no saved entries/i.test(__ts.text(document.querySelector('main')))) return { submitted: 0 };
  const btn = __ts.buttonByText(/submit all saved/i);
  if (!btn) throw new Error('Submit all saved button not found');
  btn.click();
  await __ts.confirmDialog(/^(yes|submit|confirm|ok|submit all)$/i, 3000);
  await __ts.waitFor(() => /no saved entries/i.test(__ts.text(document.querySelector('main'))), 20000);
  return { submitted: true };
`
