// Resdagboken – lokal-först resdagbok med synk via Supabase.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

window.__appStarted = true;
const SB_URL = 'https://rqhysvxalunvsrogxtym.supabase.co';
const SB_KEY = 'sb_publishable_qDSkuip40JzdYWaQ0bxTlw_EckWSSHm';
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

/* ---------------- konstanter ---------------- */
const MODES = {
  bil:   { n: 'Egen bil', c: '#e4572e', d: 'solid', w: 4,   r: 'car' },
  hyrbil:{ n: 'Hyrbil',   c: '#9a4a14', d: 'solid', w: 4,   r: 'car' },
  taxi:  { n: 'Taxi',     c: '#c99700', d: 'solid', w: 3.5, r: 'car' },
  buss:  { n: 'Buss',     c: '#2a9d8f', d: 'dash',  w: 4,   r: 'car' },
  tag:   { n: 'Tåg',      c: '#3d3dbd', d: 'solid', w: 5,   r: 'rail' },
  flyg:  { n: 'Flyg',     c: '#d6127e', d: 'dash',  w: 3,   r: 'air' },
  bat:   { n: 'Båt',      c: '#0096c7', d: 'dot',   w: 4,   r: 'sea' },
  cykel: { n: 'Cykel',    c: '#3c8d2f', d: 'dot',   w: 3.5, r: 'bike' },
  ga:    { n: 'Gå/vandra', c: '#6b5a45', d: 'dot',   w: 3,   r: 'foot' }
};
const KINDS = ['Dagbok', 'Upplevelse', 'Mat', 'Boende', 'Sevärdhet'];
const MEMBER_COLORS = ['#c46a00', '#2f5fc4', '#7a3fb0', '#2a7a2a'];
const BOTH_COLOR = '#1f6f78';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const COUNTRIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_admin_0_countries.geojson';

/* ---------------- hjälpare ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
const today = () => new Date().toISOString().slice(0, 10);
const fmtD = d => d ? new Date(d + 'T12:00').toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const fmtShort = d => d ? new Date(d + 'T12:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) : '';
const nf = n => Math.round(n).toLocaleString('sv-SE');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = Math.PI / 180;
function hav(a, b) { const dLa = (b[1] - a[1]) * R, dLo = (b[0] - a[0]) * R; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * R) * Math.cos(b[1] * R) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.min(1, Math.sqrt(h))); }
const lineKm = cs => { let s = 0; for (let i = 1; i < cs.length; i++) s += hav(cs[i - 1], cs[i]); return s; };
let regionNames; try { regionNames = new Intl.DisplayNames(['sv'], { type: 'region' }); } catch (e) {}
const cName = cc => { try { return regionNames ? regionNames.of(cc) : cc; } catch (e) { return cc; } };
const flag = cc => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => c.charCodeAt(0) + 127397)) : '';
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }

/* ---------------- IndexedDB ---------------- */
let dbp;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('resdagboken', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('docs', { keyPath: 'id' }); d.createObjectStore('kv'); d.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
const idbGet = (s, k) => idb(s, 'readonly', o => o.get(k));
const idbPut = (s, v, k) => idb(s, 'readwrite', o => k === undefined ? o.put(v) : o.put(v, k));
const idbDel = (s, k) => idb(s, 'readwrite', o => o.delete(k));
const idbAll = s => idb(s, 'readonly', o => o.getAll());
const idbClear = s => idb(s, 'readwrite', o => o.clear());

/* ---------------- tillstånd ---------------- */
const S = { user: null, group: null, joinCode: '', members: [], docs: new Map(), trip: null, view: 'karta', lastPull: null, syncing: false, lastSync: null, syncErr: '' };
const live = d => d && !d.deleted;
const ofKind = k => [...S.docs.values()].filter(d => d.kind === k && live(d));
const trips = () => ofKind('trip').sort((a, b) => (tripRange(b)[0] || b.data.created || '').localeCompare(tripRange(a)[0] || a.data.created || ''));
const stopsOf = t => ofKind('stop').filter(s => s.data.trip === t).sort((a, b) => (a.data.seq || 0) - (b.data.seq || 0));
const entriesOf = t => ofKind('entry').filter(e => e.data.trip === t);
const photosOfTrip = t => ofKind('photo').filter(p => p.data.trip === t);
const videosOf = t => ofKind('video').filter(v => v.data.trip === t);
function tripRange(t) { const ds = ofKind('stop').filter(s => s.data.trip === t.id && s.data.date).map(s => s.data.date).sort(); return [ds[0], ds[ds.length - 1]]; }
const curTrip = () => { const t = S.docs.get(S.trip); return live(t) ? t : trips()[0]; };
const PERSON_COLORS = ['#c46a00', '#2f5fc4', '#7a3fb0', '#2a7a2a', '#c2185b', '#00838f', '#6d4c41', '#5c6bc0', '#9e9d24', '#d84315'];
const persons = () => ofKind('person').sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99) || (a.data.name || '').localeCompare(b.data.name || '', 'sv'));
const personById = id => { const p = S.docs.get(id); return live(p) && p.kind === 'person' ? p : null; };
const personForUser = uid => persons().find(p => p.data.user_id === uid) || null;
const pidForUser = uid => 'a0' + uid.slice(2);
const toPid = id => personById(id) ? id : (personForUser(id) || {}).id;
const personName = id => { const p = personById(id) || personForUser(id); return p ? p.data.name : ((S.members.find(m => m.user_id === id) || {}).name || '?'); };
const personColor = id => { const p = personById(id) || personForUser(id); return (p && p.data.color) || PERSON_COLORS[0]; };
const memberName = personName, memberColor = personColor;
const allIds = () => persons().map(p => p.id);
const allLabel = () => persons().length > 2 ? 'Alla' : 'Båda';
const initials = n => (n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const travelersOf = tr => { const ids = allIds(); if (!tr || !tr.length) return ids; const r = [...new Set(tr.map(toPid).filter(Boolean))]; return r.length ? r : ids; };
const isAll = tr => { const ids = allIds(), t = travelersOf(tr); return ids.every(id => t.includes(id)); };
function whoBadge(tr) {
  if (persons().length <= 1) return '';
  const ids = travelersOf(tr);
  if (isAll(tr)) return `<span class="who all">${allLabel()}</span>`;
  if (ids.length <= 2) return ids.map(id => `<span class="who" style="color:${personColor(id)}">${esc(personName(id))}</span>`).join(' ');
  return `<span class="pdots">${ids.map(id => `<span class="pdot" style="background:${personColor(id)}" title="${esc(personName(id))}">${esc(initials(personName(id)))}</span>`).join('')}</span>`;
}
function whoPicker(el, initial) {
  let sel = travelersOf(initial);
  if (persons().length <= 1) { const w = el.closest('.whowrap'); if (w) w.remove(); return () => allIds(); }
  const draw = () => {
    const all = isAll(sel);
    el.innerHTML = `<button type="button" class="chip${all ? ' on' : ''}" data-w="all" style="${all ? `background:${BOTH_COLOR};border-color:${BOTH_COLOR}` : ''}">${allLabel()}</button>` +
      persons().map(p => { const on = !all && sel.includes(p.id); return `<button type="button" class="chip${on ? ' on' : ''}" data-w="${p.id}" style="${on ? `background:${p.data.color};border-color:${p.data.color}` : `color:${p.data.color};border-color:${p.data.color}`}">${esc(p.data.name)}</button>`; }).join('');
  };
  el.onclick = e => {
    const x = e.target.closest('[data-w]'); if (!x) return;
    if (x.dataset.w === 'all') sel = allIds();
    else if (isAll(sel)) sel = [x.dataset.w];
    else { const st = new Set(sel); st.has(x.dataset.w) ? st.delete(x.dataset.w) : st.add(x.dataset.w); sel = st.size ? [...st] : allIds(); }
    draw();
  };
  draw();
  return () => sel.slice();
}
let peopleBusy = false;
async function ensurePeople() {
  if (peopleBusy || !S.group || !S.members.length || !S.user) return;
  peopleBusy = true;
  try {
    let changed = false;
    for (const m of S.members) {
      if (!personForUser(m.user_id)) {
        const used = persons().map(p => p.data.color);
        await saveDoc('person', { name: m.name, color: PERSON_COLORS.find(c => !used.includes(c)) || PERSON_COLORS[0], user_id: m.user_id, order: persons().length }, pidForUser(m.user_id));
        changed = true;
      }
    }
    const meta = S.docs.get(S.group);
    if (!(meta && meta.data && meta.data.peopleV1)) {
      for (const st of ofKind('stop')) {
        const tr = st.data.travelers || [], nt = travelersOf(tr);
        if (!tr.length || tr.some(id => !personById(id))) await saveDoc('stop', { travelers: nt }, st.id);
      }
      await saveDoc('meta', { ...((meta && meta.data) || {}), peopleV1: true }, S.group);
      changed = true;
    }
    if (changed) render();
    if (await idbGet('kv', 'askWho')) { await idbDel('kv', 'askWho'); whoAmIDlg(); }
  } finally { peopleBusy = false; }
}
function whoAmIDlg() {
  const mine = personForUser(S.user.id), free = persons().filter(p => !p.data.user_id);
  if (!free.length) return;
  openDlg(`<h2>Vem är du?</h2><p class="small mute">Finns du redan med som person i dagboken? Välj dig själv, så kopplas dina tidigare resor till ditt konto.</p>
    <div id="mel" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${free.map(p => `<button data-me="${p.id}" style="justify-content:flex-start"><span class="dot" style="background:${p.data.color}"></span>${esc(p.data.name)}</button>`).join('')}<button data-me="" class="pri">Jag är ny i dagboken</button></div>`);
  $('#mel').onclick = async e => {
    const b = e.target.closest('[data-me]'); if (!b) return;
    const pid = b.dataset.me;
    if (pid) {
      await saveDoc('person', { user_id: S.user.id }, pid);
      if (mine && mine.id !== pid) {
        for (const st of ofKind('stop')) if ((st.data.travelers || []).includes(mine.id)) await saveDoc('stop', { travelers: st.data.travelers.map(x => x === mine.id ? pid : x) }, st.id);
        await deleteDoc(mine.id);
      }
    }
    closeDlg(); render();
  };
}
const homeOf = () => { const d = S.user && S.docs.get(S.user.id); return live(d) && d.kind === 'home' && d.data.lat != null ? d.data : null; };

async function saveDoc(kind, data, id) {
  const old = id && S.docs.get(id);
  const d = { id: id || uid(), kind, data: old ? { ...old.data, ...data } : data, deleted: false, dirty: 1, updated_at: old ? old.updated_at : null };
  S.docs.set(d.id, d); await idbPut('docs', d); scheduleSync(); return d;
}
async function deleteDoc(id) { const d = S.docs.get(id); if (!d) return; d.deleted = true; d.dirty = 1; await idbPut('docs', d); scheduleSync(); }

/* ---------------- geometri ---------------- */
function gc(a, b, n = 64) {
  const [l1, p1] = [a[0] * R, a[1] * R], [l2, p2] = [b[0] * R, b[1] * R];
  const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)], v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
  const om = Math.acos(Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2])));
  if (om < 1e-6) return [a, b];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * om) / Math.sin(om), B = Math.sin(f * om) / Math.sin(om);
    const x = A * v1[0] + B * v2[0], y = A * v1[1] + B * v2[1], z = A * v1[2] + B * v2[2];
    out.push([Math.atan2(y, x) / R, Math.atan2(z, Math.hypot(x, y)) / R]);
  }
  for (let i = 1; i < out.length; i++) { while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360; while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360; }
  return out;
}
function bez(a, b, bend, n = 40) {
  const dx = b[0] - a[0], dy = b[1] - a[1], cx = (a[0] + b[0]) / 2 - dy * bend, cy = (a[1] + b[1]) / 2 + dx * bend, o = [];
  for (let i = 0; i <= n; i++) { const u = i / n, v = 1 - u; o.push([v * v * a[0] + 2 * v * u * cx + u * u * b[0], v * v * a[1] + 2 * v * u * cy + u * u * b[1]]); }
  return o;
}
const hasPos = s => s && s.data.lat != null && s.data.lon != null;
const pos = s => [s.data.lon, s.data.lat];
const routeKey = (a, b) => [b.data.mode, a.data.lat, a.data.lon, b.data.lat, b.data.lon, (b.data.via || []).map(v => v.lat + ',' + v.lon).join(';'), ].join('|') + ((b.data.pass || []).length ? '|p:' + b.data.pass.map(v => v.lat + ',' + v.lon).join(';') : '');
function fallbackGeom(a, b) {
  const m = MODES[b.data.mode] || MODES.bil;
  if (m.r === 'air') { const pts = [pos(a), ...(b.data.via || []).map(v => [v.lon, v.lat]), pos(b)]; let o = []; for (let i = 1; i < pts.length; i++) { const seg = gc(pts[i - 1], pts[i]); if (o.length) { const last = o[o.length - 1]; const sh = Math.round((last[0] - seg[0][0]) / 360) * 360; seg.forEach(p => p[0] += sh); seg.shift(); } o = o.concat(seg); } return o; }
  if (m.r === 'sea') return bez(pos(a), pos(b), .12);
  return [pos(a), ...(b.data.pass || []).map(v => [v.lon, v.lat]), pos(b)];
}
function legs(t) {
  const st = stopsOf(t.id).filter(hasPos), out = [];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i], m = MODES[b.data.mode] || MODES.bil;
    let routed = !b.data.straight && b.data.route && b.data.route_key === routeKey(a, b), detour = false;
    const fb = fallbackGeom(a, b);
    if (routed) { const d = lineKm(fb); if (d > 3 && lineKm(b.data.route) > d * 3 + 10) { routed = false; detour = true; } }
    const coords = routed ? b.data.route : fb;
    out.push({ a, b, m, mode: b.data.mode || 'bil', coords, km: lineKm(coords), routed, detour, tr: b.data.travelers || [], via: b.data.via || [] });
  }
  return out;
}

/* ---------------- ruttsökning ---------------- */
async function fetchRoute(a, b) {
  const m = MODES[b.data.mode] || MODES.bil, P = [pos(a), ...(b.data.pass || []).map(v => [v.lon, v.lat]), pos(b)];
  if (m.r === 'car' || m.r === 'bike' || m.r === 'foot') {
    const prof = { car: 'routed-car', bike: 'routed-bike', foot: 'routed-foot' }[m.r];
    const r = await fetch(`https://routing.openstreetmap.de/${prof}/route/v1/driving/${P.map(p => p.join(',')).join(';')}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('route ' + r.status);
    const j = await r.json(); return j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
  }
  if (m.r === 'rail') {
    const r = await fetch(`https://brouter.de/brouter?lonlats=${P.map(p => p.join(',')).join('|')}&profile=rail&alternativeidx=0&format=geojson`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('rail ' + r.status);
    const j = await r.json(); const c = j.features && j.features[0] && j.features[0].geometry.coordinates;
    return c && c.map(p => [p[0], p[1]]);
  }
  return null;
}
async function locateTyped() {
  for (const t of trips()) {
    const st = stopsOf(t.id);
    for (let i = 0; i < st.length; i++) {
      const s = st[i], q = (s.data.name || '').trim();
      if (hasPos(s) || !q || s.data.geo_fail === q) continue;
      const nb = [...st.slice(0, i).reverse(), ...st.slice(i + 1)].find(hasPos);
      let hit = null;
      try { hit = (await searchPlaces(q, nb ? pos(nb) : (homeOf() ? [homeOf().lon, homeOf().lat] : null)))[0]; } catch (e) { if (!navigator.onLine) return; }
      if (hit) await saveDoc('stop', { lat: hit.lat, lon: hit.lon, cc: hit.cc, sub: hit.sub, geoGuess: true, geo_fail: null }, s.id);
      else await saveDoc('stop', { geo_fail: q }, s.id);
      if (S.view === 'etapper' || S.view === 'karta') render();
      await sleep(1100);
    }
  }
}
async function nameCheckins() {
  await locateTyped();
  for (const st of ofKind('stop').filter(x => x.data.needsName && hasPos(x))) {
    const r = await reverseCountry(st.data.lat, st.data.lon); if (!r) continue;
    await saveDoc('stop', { ...(r.name && /^Plats /.test(st.data.name || '') ? { name: r.name } : {}), cc: r.cc || st.data.cc, needsName: false }, st.id);
    await sleep(1100);
  }
}
let routeBusy = false, routeAgain = false;
async function routePending() {
  if (routeBusy) { routeAgain = true; return; } routeBusy = true;
  try { do { routeAgain = false; await routeWork(); } while (routeAgain); } finally { routeBusy = false; }
}
async function routeWork() {
  await nameCheckins();
  for (const t of trips()) {
    const st = stopsOf(t.id).filter(hasPos);
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i], m = MODES[b.data.mode] || MODES.bil;
      if (!['car', 'bike', 'foot', 'rail'].includes(m.r) || b.data.straight) continue;
      const key = routeKey(a, b);
      if (b.data.route_key === key || b.data.route_fail === key) continue;
      if (hav(pos(a), pos(b)) > 2500) { await saveDoc('stop', { route_fail: key }, b.id); continue; }
      try {
        const c = await fetchRoute(a, b);
        if (c && c.length > 1) await saveDoc('stop', { route: simplify(c), route_key: key, route_fail: null }, b.id);
        else await saveDoc('stop', { route_fail: key }, b.id);
        if (S.trip === t.id) drawTrip(false);
      } catch (e) { if (!navigator.onLine) return; await saveDoc('stop', { route_fail: key }, b.id); }
      await sleep(1100);
    }
  }
}
function simplify(c, tol = 0.0004) {
  if (c.length < 3) return c;
  const out = [c[0]]; let last = c[0];
  for (let i = 1; i < c.length - 1; i++) { if (Math.abs(c[i][0] - last[0]) > tol || Math.abs(c[i][1] - last[1]) > tol) { out.push([+c[i][0].toFixed(5), +c[i][1].toFixed(5)]); last = c[i]; } }
  out.push(c[c.length - 1]); return out;
}

/* ---------------- platssökning ---------------- */
async function searchPlaces(q, near) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${near ? `&lat=${near[1]}&lon=${near[0]}&location_bias_scale=0.3` : ''}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('search');
  const j = await r.json();
  return (j.features || []).map(f => {
    const p = f.properties || {}, c = f.geometry.coordinates;
    const sub = [p.osm_value === 'aerodrome' ? 'Flygplats' : '', p.city !== p.name ? p.city : '', p.state, p.country].filter(Boolean).join(', ');
    return { name: p.name || p.city || p.street || q, sub, lat: +c[1].toFixed(5), lon: +c[0].toFixed(5), cc: (p.countrycode || '').toUpperCase() };
  });
}
async function reverseCountry(lat, lon) {
  try { const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`); const j = await r.json(); const p = j.features && j.features[0] && j.features[0].properties; return p ? { cc: (p.countrycode || '').toUpperCase(), name: p.city || p.locality || p.district || p.name || p.county || '' } : null; } catch (e) { return null; }
}
function searchBox(el, onPick, placeholder) {
  el.innerHTML = `<input type="search" placeholder="${esc(placeholder || 'Sök ort, adress eller flygplats')}" autocomplete="off" enterkeyhint="search"><div class="results" hidden></div>`;
  const inp = el.querySelector('input'), res = el.querySelector('.results'); let tm, list = [];
  inp.addEventListener('input', () => {
    clearTimeout(tm); const q = inp.value.trim();
    if (q.length < 2) { res.hidden = true; return; }
    tm = setTimeout(async () => {
      if (!navigator.onLine) { res.hidden = false; res.innerHTML = '<div class="pad small mute">Sökningen kräver nät. Du kan spara platsen med bara namnet och lägga till position senare.</div>'; list = []; return; }
      try { list = await searchPlaces(q); } catch (e) { list = []; }
      res.hidden = false;
      res.innerHTML = list.length ? list.map((p, i) => `<button type="button" data-i="${i}">${flag(p.cc)} ${esc(p.name)}<small>${esc(p.sub)}</small></button>`).join('') : '<div class="pad small mute">Inga träffar</div>';
    }, 350);
  });
  res.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; const p = list[+b.dataset.i]; res.hidden = true; inp.value = p.name; onPick(p); });
  return inp;
}

/* ---------------- bilder ---------------- */
const urlCache = new Map();
async function shrink(file, max, q = .82) {
  let img; try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { img = await createImageBitmap(file); }
  const r = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * r); c.height = Math.round(img.height * r); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', q));
}
let exifr;
async function readExif(file) {
  try {
    if (!exifr) exifr = (await import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/+esm')).default;
    const x = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'] });
    if (!x) return {};
    const dt = x.DateTimeOriginal || x.CreateDate;
    return { lat: x.latitude != null ? +x.latitude.toFixed(5) : null, lon: x.longitude != null ? +x.longitude.toFixed(5) : null, taken: dt instanceof Date && !isNaN(dt) ? dt.toISOString() : null };
  } catch (e) { return {}; }
}
async function mediaUrl(id, size = 'thumb') {
  const key = size + ':' + id; if (urlCache.has(key)) return urlCache.get(key);
  let blob = await idbGet('blobs', key);
  if (!blob) {
    const d = S.docs.get(id); const path = d && (size === 'thumb' ? d.data.tpath : d.data.path);
    if (!path || !navigator.onLine) return null;
    const { data, error } = await sb.storage.from('media').download(path);
    if (error || !data) return null;
    blob = data; if (size === 'thumb') await idbPut('blobs', blob, key);
  }
  const u = URL.createObjectURL(blob); urlCache.set(key, u); return u;
}
function hydrate(root = document) {
  root.querySelectorAll('img[data-photo]:not([src])').forEach(async img => { const u = await mediaUrl(img.dataset.photo, img.dataset.size || 'thumb'); if (u) img.src = u; });
}

/* ---------------- synk ---------------- */
let syncT;
function scheduleSync(ms = 800) { clearTimeout(syncT); syncT = setTimeout(sync, ms); updateSyncLabel(); }
const pendingCount = () => [...S.docs.values()].filter(d => d.dirty).length;
function updateSyncLabel() {
  const el = $('#sync'); if (!el) return;
  const p = pendingCount();
  el.textContent = !navigator.onLine ? `Offline${p ? ' · ' + p + ' väntar' : ''}` : S.syncing ? 'Synkar…' : p ? p + ' väntar' : 'Synkad';
}
async function uploadMedia() {
  for (const d of [...S.docs.values()].filter(d => live(d) && d.data.pending && (d.kind === 'photo' || d.kind === 'video'))) {
    try {
      if (d.kind === 'photo') {
        const full = await idbGet('blobs', 'full:' + d.id), th = await idbGet('blobs', 'thumb:' + d.id);
        if (!full || !th) continue;
        const p = `${S.group}/${d.id}.jpg`, tp = `${S.group}/${d.id}_t.jpg`;
        let r = await sb.storage.from('media').upload(p, full, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error;
        r = await sb.storage.from('media').upload(tp, th, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error;
        await saveDoc('photo', { pending: false, path: p, tpath: tp }, d.id);
        await idbDel('blobs', 'full:' + d.id);
      } else {
        const v = await idbGet('blobs', 'video:' + d.id); if (!v) continue;
        const p = `${S.group}/${d.id}.${d.data.ext || 'webm'}`;
        const r = await sb.storage.from('media').upload(p, v, { contentType: d.data.mime || 'video/webm', upsert: true }); if (r.error) throw r.error;
        await saveDoc('video', { pending: false, path: p }, d.id);
      }
    } catch (e) { S.syncErr = 'Kunde inte ladda upp: ' + (e.message || e); }
  }
}
async function sync() {
  if (S.syncing || !S.user || !S.group) return updateSyncLabel();
  if (!navigator.onLine) return updateSyncLabel();
  S.syncing = true; S.syncErr = ''; updateSyncLabel();
  try {
    await uploadMedia();
    const dirty = [...S.docs.values()].filter(d => d.dirty);
    if (dirty.length) {
      const rows = dirty.map(d => ({ id: d.id, group_id: S.group, kind: d.kind, data: d.data, deleted: !!d.deleted }));
      const { error } = await sb.from('docs').upsert(rows);
      if (error) throw error;
      for (const d of dirty) { const cur = S.docs.get(d.id); if (cur === d) { d.dirty = 0; await idbPut('docs', d); } }
    }
    let q = sb.from('docs').select('id,kind,data,deleted,updated_at').eq('group_id', S.group).order('updated_at', { ascending: true }).limit(1000);
    if (S.lastPull) q = q.gt('updated_at', S.lastPull);
    const { data, error } = await q; if (error) throw error;
    let changed = false;
    for (const r of data || []) {
      const loc = S.docs.get(r.id);
      if (!loc || !loc.dirty) { const d = { id: r.id, kind: r.kind, data: r.data, deleted: r.deleted, dirty: 0, updated_at: r.updated_at }; S.docs.set(r.id, d); await idbPut('docs', d); changed = true; }
      S.lastPull = r.updated_at;
    }
    if (data && data.length) await idbPut('kv', S.lastPull, 'lastPull');
    await loadMembers();
    await ensurePeople();
    S.lastSync = new Date();
    if (changed) render();
    if (data && data.length === 1000) setTimeout(sync, 100);
    routePending().catch(() => {});
  } catch (e) { S.syncErr = e.message || String(e); }
  S.syncing = false; updateSyncLabel();
}
async function loadMembers() {
  let r = await sb.from('members').select('user_id,name,joined_at,role').eq('group_id', S.group).order('joined_at');
  if (r.error) r = await sb.from('members').select('user_id,name,joined_at').eq('group_id', S.group).order('joined_at');
  if (r.data) { S.members = r.data; await idbPut('kv', r.data, 'members'); }
  const g = await sb.from('groups').select('join_code').eq('id', S.group).maybeSingle();
  if (g.data) { S.joinCode = g.data.join_code; await idbPut('kv', S.joinCode, 'joinCode'); }
}

/* ---------------- dialog ---------------- */
function openDlg(html, cls = '') { const b = $('#box'); b.className = 'box ' + cls; b.innerHTML = html; $('#ov').classList.add('show'); return b; }
function closeDlg() { $('#ov').classList.remove('show'); $('#box').innerHTML = ''; }
$('#ov').addEventListener('click', e => { if (e.target.id === 'ov' || e.target.closest('[data-close]')) closeDlg(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDlg(); });
function confirmDlg(title, text, yes, fn) {
  openDlg(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row end"><button data-close>Avbryt</button><button class="pri" id="yes">${esc(yes)}</button></div>`);
  $('#yes').onclick = async () => { closeDlg(); await fn(); };
}

/* ---------------- inloggning ---------------- */
const inviteCode = () => { try { return localStorage.getItem('rdJoin') || ''; } catch (e) { return ''; } };
const clearInvite = () => { try { localStorage.removeItem('rdJoin'); } catch (e) {} };
function renderAuth(msg = '') {
  $('#app').innerHTML = `<div class="center" style="max-width:420px;margin:0 auto;text-align:left;align-items:stretch">
    <h1>Resdagboken</h1><p class="mute">${inviteCode() ? 'Du har blivit inbjuden till en resdagbok. Skapa ett konto eller logga in för att gå med.' : 'Logga in för att spara och dela era resor.'}</p>
    <form id="af"><label for="em">E-post</label><input id="em" type="email" autocomplete="email" required>
    <label for="pw">Lösenord</label><input id="pw" type="password" autocomplete="current-password" minlength="6" required>
    <div class="row" style="margin-top:16px"><button class="pri" style="flex:1">Logga in</button><button type="button" id="su" style="flex:1">Skapa konto</button></div></form>
    <p class="small mute" id="am">${esc(msg)}</p></div>`;
  const go = async signup => {
    const email = $('#em').value.trim(), password = $('#pw').value;
    if (!email || password.length < 6) { $('#am').textContent = 'Fyll i e-post och ett lösenord på minst 6 tecken.'; return; }
    $('#am').textContent = 'Vänta…';
    const r = signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
    if (r.error) { $('#am').textContent = r.error.message === 'Invalid login credentials' ? 'Fel e-post eller lösenord.' : r.error.message; return; }
    if (signup && !r.data.session) { $('#am').textContent = 'Kontot är skapat. Bekräfta via länken i mejlet och logga sedan in.'; return; }
    await afterLogin(r.data.session.user);
  };
  $('#af').onsubmit = e => { e.preventDefault(); go(false); };
  $('#su').onclick = () => go(true);
}
function renderOnboard() {
  $('#app').innerHTML = `<div class="center" style="max-width:420px;margin:0 auto;text-align:left;align-items:stretch">
    <h1>Välkommen</h1><label for="nm">Ditt namn</label><input id="nm" placeholder="t.ex. Rickard">
    <div class="card"${inviteCode() ? ' style="margin-top:16px"' : ' style="margin-top:16px;order:-1"'}><h3>${inviteCode() ? 'Gå med i dagboken du blivit inbjuden till' : 'Gå med med kod'}</h3><input id="jc" placeholder="Kod, t.ex. 4F2A9C" autocapitalize="characters" value="${esc(inviteCode())}"><button id="jg" class="${inviteCode() ? 'pri' : ''}" style="width:100%;margin-top:8px">Gå med</button></div>
    <div class="card"><h3>Ny dagbok</h3><p class="small mute">För dig själv, för er två eller för hela familjen. Fler kan bjudas in senare.</p><button class="${inviteCode() ? '' : 'pri'}" id="cg" style="width:100%">Skapa dagbok</button></div>
    <p class="small mute" id="om"></p><button class="ghost" id="lo">Logga ut</button></div>`;
  const nm = () => $('#nm').value.trim();
  $('#cg').onclick = async () => { if (!nm()) return $('#om').textContent = 'Skriv ditt namn först.'; const { data, error } = await sb.rpc('create_group', { p_member_name: nm() }); if (error) return $('#om').textContent = error.message; clearInvite(); await setGroup(data); };
  $('#jg').onclick = async () => { if (!nm()) return $('#om').textContent = 'Skriv ditt namn först.'; const { data, error } = await sb.rpc('join_group', { p_code: $('#jc').value, p_member_name: nm() }); if (error) return $('#om').textContent = error.message === 'Fel kod' ? 'Koden stämmer inte.' : error.message; clearInvite(); await idbPut('kv', true, 'askWho'); await setGroup(data); };
  $('#lo').onclick = logout;
}
async function setGroup(g) { S.group = g; await idbPut('kv', g, 'group'); await sync(); startApp(); }
async function afterLogin(user) {
  S.user = user; await idbPut('kv', user.id, 'uid');
  if (!S.group) {
    const { data, error } = await sb.from('members').select('group_id').eq('user_id', user.id).limit(1);
    if (error) { renderAuth('Kunde inte nå servern: ' + error.message); return; }
    if (!data.length) return renderOnboard();
    S.group = data[0].group_id; await idbPut('kv', S.group, 'group');
  }
  if (inviteCode()) { clearInvite(); setTimeout(() => toast('Du är redan med i en dagbok'), 800); }
  startApp(); sync();
}
async function logout() {
  await sb.auth.signOut().catch(() => {});
  await Promise.all(['docs', 'kv', 'blobs'].map(idbClear));
  location.reload();
}

/* ---------------- skal ---------------- */
const VIEWS = [['karta', 'Karta'], ['etapper', 'Etapper'], ['dagbok', 'Dagbok'], ['varlden', 'Världen'], ['topp', 'Topplistor'], ['mer', 'Mer']];
let shellBuilt = false;
function startApp() {
  if (!shellBuilt) {
    $('#app').innerHTML = `<div id="shell"><header id="top"></header><main id="main"></main><nav id="nav">${VIEWS.map(([k, n]) => `<a href="#${k}" data-v="${k}">${n}</a>`).join('')}</nav></div>`;
    shellBuilt = true;
  }
  render();
}
window.addEventListener('hashchange', () => { if (shellBuilt) render(); });
function render() {
  if (!shellBuilt) return;
  const v = (location.hash.slice(1) || 'karta'); S.view = VIEWS.some(x => x[0] === v) || v === 'pass' ? v : 'karta';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === S.view));
  const t = curTrip(); if (t) S.trip = t.id;
  const tripView = ['karta', 'etapper', 'dagbok'].includes(S.view);
  $('#top').innerHTML = tripView
    ? `<select id="tsel" aria-label="Välj resa">${trips().map(x => `<option value="${x.id}" ${t && x.id === t.id ? 'selected' : ''}>${esc(x.data.title)}</option>`).join('') || '<option>Ingen resa ännu</option>'}</select>
       ${t ? '<button class="sm" id="tedit" aria-label="Ändra resa">Ändra</button>' : ''}<button class="sm pri" id="tnew">+ Resa</button><span id="sync"></span>`
    : `${S.view === 'pass' ? '<a href="#varlden" class="btn sm" aria-label="Tillbaka">←</a>' : ''}<h2 style="flex:1">${S.view === 'pass' ? 'Pass och utmärkelser' : VIEWS.find(x => x[0] === S.view)[1]}</h2><span id="sync"></span>`;
  updateSyncLabel();
  if ($('#tsel')) $('#tsel').onchange = e => { S.trip = e.target.value; idbPut('kv', S.trip, 'trip'); stopPlay(); render(); };
  if ($('#tnew')) $('#tnew').onclick = () => tripDlg();
  if ($('#tedit')) $('#tedit').onclick = () => tripDlg(curTrip());
  const main = $('#main');
  if (S.view !== 'karta') detachMap();
  if (S.view !== 'varlden' && wmap) { try { wmap.remove(); } catch (e) {} wmap = null; wReady = false; }
  ({ karta: viewKarta, etapper: viewEtapper, dagbok: viewDagbok, varlden: viewVarlden, topp: viewTopp, mer: viewMer, pass: viewPass })[S.view](main, t);
  hydrate(main);
}
const noTrip = () => `<div class="pad"><div class="empty"><p>Ingen resa ännu.</p><button class="pri" onclick="document.getElementById('tnew').click()">Skapa din första resa</button></div></div>`;

/* ---------------- resa ---------------- */
function tripDlg(t) {
  const b = openDlg(`<h2>${t ? 'Ändra resa' : 'Ny resa'}</h2><form id="f">
    <label for="tt">Namn</label><input id="tt" required value="${esc(t ? t.data.title : '')}" placeholder="t.ex. Rivieran 2027">
    ${!t && homeOf() ? `<label style="display:flex;gap:10px;align-items:center;font-weight:600"><input type="checkbox" id="th" checked style="width:22px;min-height:22px"> Resan startar hemma i ${esc(homeOf().name)}</label><label for="tdd">Avresedatum</label><input id="tdd" type="date" value="${today()}">` : ''}
    <label for="ta">Länk till fotoalbum (valfritt)</label><input id="ta" type="url" value="${esc(t ? t.data.album || '' : '')}" placeholder="Delad länk från Google Foto eller iCloud">
    <div class="row end" style="margin-top:16px">${t ? '<button type="button" id="del">Ta bort</button>' : ''}<button type="button" data-close>Avbryt</button><button class="pri">Spara</button></div></form>`);
  $('#f', b).onsubmit = async e => {
    e.preventDefault(); const title = $('#tt').value.trim(); if (!title) return;
    const d = await saveDoc('trip', { title, album: $('#ta').value.trim(), created: t ? t.data.created : new Date().toISOString() }, t && t.id);
    if (!t && $('#th') && $('#th').checked) { const h = homeOf(); await saveDoc('stop', { trip: d.id, name: h.name, sub: h.sub || '', lat: h.lat, lon: h.lon, cc: h.cc, date: $('#tdd').value, mode: '', travelers: allIds(), via: [], seq: 1 }); }
    S.trip = d.id; idbPut('kv', d.id, 'trip'); closeDlg(); if (!t) location.hash = 'etapper'; render();
  };
  if (t) $('#del').onclick = () => confirmDlg(`Ta bort ”${t.data.title}”?`, 'Resan, dess platser och inlägg tas bort för er båda.', 'Ta bort', async () => {
    for (const d of [...S.docs.values()].filter(d => d.data && d.data.trip === t.id)) await deleteDoc(d.id);
    await deleteDoc(t.id); S.trip = null; render();
  });
}

/* ---------------- karta ---------------- */
let map, mapReady = false, photoMarkers = [], playing = null, mapHolder;
function ensureMap() {
  if (map || !window.maplibregl || !mapHolder) return;
  try {
    map = new maplibregl.Map({ container: mapHolder.querySelector('#map'), style: STYLE_URL, center: [12, 50], zoom: 3, attributionControl: { compact: true }, preserveDrawingBuffer: true });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('legs', { type: 'geojson', data: fc([]) });
      map.addSource('stops', { type: 'geojson', data: fc([]) });
      map.addSource('mover', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'legs-case', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['+', ['get', 'w'], 3], 'line-opacity': .85 } });
      map.addLayer({ id: 'legs-solid', type: 'line', source: 'legs', filter: ['==', ['get', 'd'], 'solid'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'] } });
      map.addLayer({ id: 'legs-dash', type: 'line', source: 'legs', filter: ['==', ['get', 'd'], 'dash'], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-dasharray': [2.2, 1.6] } });
      map.addLayer({ id: 'legs-dot', type: 'line', source: 'legs', filter: ['==', ['get', 'd'], 'dot'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-dasharray': [0.1, 2] } });
      map.addLayer({ id: 'stops-c', type: 'circle', source: 'stops', paint: { 'circle-radius': ['case', ['get', 'via'], 4, 6], 'circle-color': ['case', ['get', 'via'], '#ffffff', '#13242e'], 'circle-stroke-color': ['case', ['get', 'via'], '#d6127e', '#ffffff'], 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'stops-l', type: 'symbol', source: 'stops', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#13242e', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      map.addLayer({ id: 'mover-c', type: 'circle', source: 'mover', paint: { 'circle-radius': 9, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
      map.addLayer({ id: 'mover-l', type: 'symbol', source: 'mover', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-offset': [0, -1.6], 'text-anchor': 'bottom', 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'c'], 'text-halo-width': 3 } });
      mapReady = true; drawTrip(true);
    });
    map.on('error', e => { if (e && e.error && /Failed to fetch|NetworkError/.test(String(e.error.message))) return; });
  } catch (e) { map = null; }
}
function detachMap() { stopPlay(); photoMarkers.forEach(m => m.remove()); photoMarkers = []; if (map) { try { map.remove(); } catch (e) {} } map = null; mapReady = false; if (mapHolder && mapHolder.parentNode) mapHolder.remove(); mapHolder = null; }
const fc = f => ({ type: 'FeatureCollection', features: f });
function legFeature(L, coords) { return { type: 'Feature', properties: { c: L.m.c, w: L.m.w, d: L.m.d }, geometry: { type: 'LineString', coordinates: coords } }; }
function stopFeatures(t) {
  const out = [], seen = new Set();
  for (const s of stopsOf(t.id).filter(hasPos)) { const k = s.data.name + s.data.lat; if (seen.has(k)) continue; seen.add(k); out.push({ type: 'Feature', properties: { name: s.data.name, via: false }, geometry: { type: 'Point', coordinates: pos(s) } }); for (const v of s.data.via || []) out.push({ type: 'Feature', properties: { name: v.name, via: true }, geometry: { type: 'Point', coordinates: [v.lon, v.lat] } }); }
  return out;
}
function boundsOf(coords) { const b = new maplibregl.LngLatBounds(); coords.forEach(c => b.extend(c)); return b; }
function drawTrip(fit) {
  if (!map || !mapReady) return;
  const t = curTrip(); if (!t) { map.getSource('legs').setData(fc([])); map.getSource('stops').setData(fc([])); return; }
  const L = legs(t);
  map.getSource('legs').setData(fc(L.map(l => legFeature(l, l.coords))));
  map.getSource('stops').setData(fc(stopFeatures(t)));
  map.getSource('mover').setData(fc([]));
  drawPhotoMarkers(t);
  if (fit) { const all = L.flatMap(l => l.coords).concat(stopsOf(t.id).filter(hasPos).map(pos)); if (all.length) map.fitBounds(boundsOf(all), { padding: 50, maxZoom: 13, duration: 0 }); }
}
function drawPhotoMarkers(t) {
  photoMarkers.forEach(m => m.remove()); photoMarkers = [];
  const groups = new Map();
  for (const p of photosOfTrip(t.id).filter(p => p.data.lat != null)) { const k = p.data.lat.toFixed(2) + ',' + p.data.lon.toFixed(2); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  for (const ps of groups.values()) {
    const el = document.createElement('button'); el.className = 'pm'; el.setAttribute('aria-label', ps.length + ' bilder');
    if (ps.length > 1) el.innerHTML = `<b>${ps.length}</b>`;
    mediaUrl(ps[0].id).then(u => { if (u) el.style.backgroundImage = `url("${u}")`; });
    el.onclick = () => { const e = S.docs.get(ps[0].data.entry); if (live(e)) { location.hash = 'dagbok'; setTimeout(() => { const n = document.getElementById('e-' + e.id); if (n) n.scrollIntoView({ block: 'start' }); }, 50); } else showPhoto(ps[0].id); };
    photoMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([ps[0].data.lon, ps[0].data.lat]).addTo(map));
  }
}
function viewKarta(main, t) {
  if (!t) { main.innerHTML = noTrip(); return; }
  const L = legs(t), vids = videosOf(t.id);
  main.innerHTML = `<div id="mapslot"></div><div class="pad">
    <button id="chk" style="width:100%;margin-bottom:8px">Checka in här</button>
    <div class="row"><button class="pri" id="play" style="flex:1">Spela upp resan</button><button id="rec" style="flex:1">Spara som video</button></div>
    <div class="row" style="margin-top:8px"><span class="small mute">Fart</span><div class="seg" id="speed" style="flex:1"><button data-s="0.6">Lugn</button><button data-s="1" class="on">Normal</button><button data-s="2">Snabb</button></div></div>
    <div class="legend">${Object.values(MODES).map(m => `<span><svg width="24" height="8" aria-hidden="true"><line x1="2" y1="4" x2="22" y2="4" stroke="${m.c}" stroke-width="${m.w}" stroke-linecap="round" ${m.d === 'dash' ? 'stroke-dasharray="7 4"' : m.d === 'dot' ? 'stroke-dasharray="0.1 7"' : ''}/></svg>${m.n}</span>`).join('')}</div>
    <p class="small mute">${L.length} etapper · ${nf(L.reduce((s, l) => s + l.km, 0))} km${L.some(l => !l.routed && !l.detour && !l.b.data.straight && ['car', 'bike', 'foot', 'rail'].includes(l.m.r)) ? ' · vissa rutter räknas ut när du är uppkopplad' : ''}</p>
    ${vids.length ? `<h3 style="margin-top:12px">Videor</h3>${vids.map(v => `<div class="spread card" style="padding:10px 14px;margin:8px 0 0"><span>${esc(new Date(v.data.created).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }))}${v.data.pending ? ' <span class="small mute">· laddas upp</span>' : ''}</span><button class="sm" data-vid="${v.id}">Visa</button></div>`).join('')}` : ''}
  </div>`;
  detachMap();
  mapHolder = document.createElement('div'); mapHolder.id = 'mapbox'; mapHolder.innerHTML = '<div id="map"></div><div id="cap"></div>';
  $('#mapslot').replaceWith(mapHolder);
  if (!window.maplibregl) mapHolder.innerHTML = '<div class="mapmsg">Kartan kunde inte laddas. Den behöver nät första gången.</div>';
  else ensureMap();
  let speed = 1;
  $('#speed').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; speed = +b.dataset.s; $('#speed').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (playing) playing.speed = speed; };
  $('#play').onclick = () => playing ? stopPlay() : play(t, speed, false);
  $('#chk').onclick = () => checkIn(t);
  $('#rec').onclick = () => playing ? stopPlay() : play(t, speed, true);
  main.querySelectorAll('[data-vid]').forEach(b => b.onclick = () => showVideo(b.dataset.vid));
}
function pointAt(coords, cum, f) {
  const target = f * cum[cum.length - 1]; let i = 1; while (i < cum.length - 1 && cum[i] < target) i++;
  const seg = cum[i] - cum[i - 1] || 1, u = Math.min(1, Math.max(0, (target - cum[i - 1]) / seg));
  const a = coords[i - 1], b = coords[i]; return { i, p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] };
}
function stopPlay() {
  if (!playing) return; playing.cancel = true;
  if (playing.rec && playing.rec.state !== 'inactive') playing.rec.stop();
  playing = null; const p = $('#play'), r = $('#rec'); if (p) p.textContent = 'Spela upp resan'; if (r) r.textContent = 'Spara som video';
  const c = $('#cap'); if (c) c.style.display = 'none'; drawTrip(false);
}
async function play(t, speed, record) {
  if (!map || !mapReady) { toast('Kartan är inte klar ännu'); return; }
  const L = legs(t); if (!L.length) { toast('Lägg till minst två platser först'); return; }
  const P = playing = { speed, cancel: false };
  $(record ? '#rec' : '#play').textContent = 'Stoppa';
  if (record) {
    try {
      const stream = map.getCanvas().captureStream(30);
      const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error('Den här webbläsaren kan inte spela in video.');
      const chunks = []; P.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4e6 });
      P.rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      P.rec.onstop = async () => {
        const blob = new Blob(chunks, { type: mime.split(';')[0] }); if (!blob.size) return;
        const id = uid(); await idbPut('blobs', blob, 'video:' + id);
        await saveDoc('video', { trip: t.id, created: new Date().toISOString(), mime: mime.split(';')[0], ext: mime.includes('mp4') ? 'mp4' : 'webm', pending: true }, id);
        toast('Videon är sparad i resan'); if (S.view === 'karta') render();
      };
      P.rec.start(500);
    } catch (e) { toast(e.message || 'Inspelning stöds inte här'); P.rec = null; }
  }
  const src = map.getSource('legs'), mover = map.getSource('mover'), cap = $('#cap');
  const done = [];
  src.setData(fc([])); photoMarkers.forEach(m => m.getElement().style.visibility = 'hidden');
  const all = L.flatMap(l => l.coords);
  map.fitBounds(boundsOf(all), { padding: 50, maxZoom: 12, duration: 1200 }); await sleep(1400);
  for (const l of L) {
    if (P.cancel) return;
    cap.style.display = 'block'; cap.innerHTML = `<span style="color:${l.m.c}">●</span> ${esc(fmtShort(l.b.data.date))} · ${esc(l.m.n)}: ${esc(l.a.data.name)} → ${esc(l.b.data.name)} · ${nf(l.km)} km`;
    map.fitBounds(boundsOf(l.coords), { padding: 70, maxZoom: l.km < 30 ? 13 : 11, duration: 1000 }); await sleep(1100);
    const cum = [0]; for (let i = 1; i < l.coords.length; i++) cum.push(cum[i - 1] + hav(l.coords[i - 1], l.coords[i]) + 1e-9);
    const dur = Math.min(6000, Math.max(1800, 420 * Math.sqrt(l.km)));
    let f = 0, last = performance.now();
    await new Promise(res => {
      const step = now => {
        if (P.cancel) return res();
        f = Math.min(1, f + (now - last) / (dur / P.speed)); last = now;
        const { i, p } = pointAt(l.coords, cum, f);
        src.setData(fc([...done, legFeature(l, [...l.coords.slice(0, i), p])]));
        mover.setData(fc([{ type: 'Feature', properties: { c: l.m.c, label: l.m.n }, geometry: { type: 'Point', coordinates: p } }]));
        if (f >= 1) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    done.push(legFeature(l, l.coords));
  }
  if (P.cancel) return;
  mover.setData(fc([])); cap.innerHTML = `Klart · ${L.length} etapper · ${nf(L.reduce((s, l) => s + l.km, 0))} km`;
  map.fitBounds(boundsOf(all), { padding: 50, maxZoom: 12, duration: 1200 }); await sleep(1800);
  if (P.rec && P.rec.state !== 'inactive') P.rec.stop();
  P.rec = null; stopPlay();
}
async function showVideo(id) {
  const d = S.docs.get(id); let blob = await idbGet('blobs', 'video:' + id);
  if (!blob && d.data.path) { if (!navigator.onLine) return toast('Videon behöver nät första gången'); const r = await sb.storage.from('media').download(d.data.path); blob = r.data; if (blob) await idbPut('blobs', blob, 'video:' + id); }
  if (!blob) return toast('Videon hittades inte');
  const u = URL.createObjectURL(blob);
  openDlg(`<video src="${u}" controls playsinline autoplay></video><a class="btn x" style="left:10px;right:auto;position:absolute;top:calc(10px + var(--safe-t))" href="${u}" download="resa.${d.data.ext || 'webm'}">Spara</a><button class="x" data-close>Stäng</button>`, 'media');
}
function showPhoto(id) { openDlg(`<img data-photo="${id}" data-size="full" alt=""><button class="x" data-close>Stäng</button>`, 'media'); hydrate($('#box')); }

/* ---------------- etapper ---------------- */
function viewEtapper(main, t) {
  if (!t) { main.innerHTML = noTrip(); return; }
  const st = stopsOf(t.id);
  const L = legs(t), byStop = new Map(L.map(l => [l.b.id, l]));
  const home = homeOf(), lastSt = st[st.length - 1];
  const homeBtn = home && lastSt && !(hasPos(lastSt) && hav(pos(lastSt), [home.lon, home.lat]) < 5);
  let html = `<div class="pad"><div class="spread"><p class="small mute" style="margin:0">${st.length} platser · ${L.length} etapper</p><div class="row"><button class="sm" id="chk">Checka in här</button>${homeBtn ? '<button class="sm" id="addhome">+ Hemresa</button>' : ''}<button class="sm" id="addfl">+ Flyg</button><button class="pri sm" id="add">+ Ny plats</button></div></div>`;
  if (!st.length) html += `<div class="empty">Börja med platsen ni reste från, till exempel hemorten.</div>`;
  else html += `<p class="small mute" style="margin:6px 0 0">Håll i ≡ och dra för att flytta en plats.</p>`;
  html += '<div id="slist">';
  let lastDay = null;
  st.forEach((s, i) => {
    const day = s.data.date || '';
    if (day !== lastDay) { html += `<div class="day">${day ? esc(fmtD(day)) : 'Utan datum'}</div>`; lastDay = day; }
    const l = byStop.get(s.id), m = MODES[s.data.mode] || MODES.bil;
    const via = (s.data.via || []).map(v => v.name).join(', ');
    html += `<div class="leg srow" data-s="${s.id}"><span class="grip" aria-label="Dra för att flytta" role="button" tabindex="-1">≡</span><div class="bar" style="background:${i ? m.c : '#13242e'}"></div>
      <div class="open"><div class="t">${i ? `${esc(st[i - 1].data.name)} → ` : ''}${esc(s.data.name)} ${flag(s.data.cc)}</div>
      <div class="s">${i ? esc(m.n) : 'Start'}${l ? ' · ' + nf(l.km) + ' km' : ''}${via ? ` · <span class="via">mellanlandning ${esc(via)}</span>` : ''}${!hasPos(s) ? (s.data.geo_fail === (s.data.name || '').trim() ? ' · <b>hittades inte – tryck och sök</b>' : ' · <b>saknar position</b> – söks upp när du har nät') : ''}${s.data.geoGuess ? ' · <span class="via">plats hittad automatiskt – tryck och kontrollera</span>' : ''}${i && s.data.straight ? ' · rak linje' : ''}${i && (s.data.pass || []).length ? ` · via ${esc(s.data.pass.map(v => v.name).join(', '))}` : ''}${l && l.detour ? ' · <span class="via">vägen blev en stor omväg – rak linje visas</span>' : ''}</div></div>
      <div class="open">${whoBadge(s.data.travelers)}</div></div>`;
  });
  main.innerHTML = html + '</div></div>';
  $('#add').onclick = () => stopDlg(t, null);
  $('#addfl').onclick = () => flightDlg(t);
  $('#chk').onclick = () => checkIn(t);
  if ($('#addhome')) $('#addhome').onclick = () => stopDlg(t, null, home);
  main.querySelectorAll('.srow .open').forEach(b => b.onclick = () => stopDlg(t, S.docs.get(b.closest('.srow').dataset.s)));
  if (window.Sortable && st.length > 1) {
    Sortable.create($('#slist'), {
      handle: '.grip', draggable: '.srow', animation: 150, ghostClass: 'drag-ghost', forceFallback: true, fallbackTolerance: 3,
      onEnd: async () => {
        const ids = [...document.querySelectorAll('#slist .srow')].map(e => e.dataset.s);
        let changed = false;
        for (const [i, id] of ids.entries()) { const d = S.docs.get(id); if (d && d.data.seq !== i + 1) { await saveDoc('stop', { seq: i + 1 }, id); changed = true; } }
        if (changed) { toast('Ordningen är sparad'); render(); }
      }
    });
  }
}

/* ---------------- checka in ---------------- */
function checkIn(t) {
  if (!t) return toast('Skapa en resa först');
  if (!navigator.geolocation) return toast('Telefonen kan inte ge position här');
  toast('Hämtar position…', 10000);
  navigator.geolocation.getCurrentPosition(async p => {
    const lat = +p.coords.latitude.toFixed(5), lon = +p.coords.longitude.toFixed(5);
    const st = stopsOf(t.id), last = st[st.length - 1];
    if (last && hasPos(last) && hav(pos(last), [lon, lat]) < 0.5) { toast('Du är redan incheckad här'); return; }
    let name = '', cc = '';
    if (navigator.onLine) { const r = await reverseCountry(lat, lon); if (r) { name = r.name; cc = r.cc; } }
    toast('Position hittad', 1200);
    stopDlg(t, null, { name: name || 'Plats ' + new Date().toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), sub: name ? '' : 'Namnet hämtas när du har nät', lat, lon, cc, date: today(), needsName: !cc });
  }, err => toast(err.code === 1 ? 'Appen får inte se din position. Tillåt plats för webbplatsen i telefonens inställningar.' : 'Kunde inte hitta din position, försök igen'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

/* ---------------- flyg via flygnummer ---------------- */
const AIRLINE_ICAO = { SK: 'SAS', DY: 'NOZ', D8: 'NSZ', DK: 'VKG', LH: 'DLH', QR: 'QTR', EK: 'UAE', EY: 'ETD', AI: 'AIC', '6E': 'IGO', UK: 'VTI', BA: 'BAW', AF: 'AFR', KL: 'KLM', LX: 'SWR', OS: 'AUA', SN: 'BEL', AY: 'FIN', TK: 'THY', LO: 'LOT', FR: 'RYR', U2: 'EZY', W6: 'WZZ', IB: 'IBE', VY: 'VLG', TP: 'TAP', AZ: 'ITY', EI: 'EIN', UA: 'UAL', DL: 'DAL', AA: 'AAL', AC: 'ACA', SQ: 'SIA', TG: 'THA', CX: 'CPA', NH: 'ANA', JL: 'JAL', BT: 'BTI', A3: 'AEE', LG: 'LGL', WF: 'WIF', HV: 'TRA', PC: 'PGT', SV: 'SVA', MS: 'MSR', ET: 'ETH', G9: 'ABY', FZ: 'FDB', WY: 'OMA', GF: 'GFA', KU: 'KAC', '9W': 'JAI', SG: 'SEJ', QF: 'QFA', NZ: 'ANZ', B6: 'JBU', WN: 'SWA', AS: 'ASA', F9: 'FFT', NK: 'NKS' };
async function lookupFlight(raw) {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  const m = code.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/), tries = [code];
  if (m && AIRLINE_ICAO[m[1]]) tries.push(AIRLINE_ICAO[m[1]] + m[2]);
  for (const c of tries) {
    try {
      const r = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(c)}`);
      if (!r.ok) continue;
      const j = await r.json(), fr = j && j.response && j.response.flightroute;
      if (fr && fr.origin && fr.destination) {
        const ap = a => ({ name: `${a.municipality || a.name} (${a.iata_code || a.icao_code})`, sub: a.name, lat: +(+a.latitude).toFixed(5), lon: +(+a.longitude).toFixed(5), cc: (a.country_iso_name || '').toUpperCase() });
        return { code, airline: fr.airline && fr.airline.name, from: ap(fr.origin), to: ap(fr.destination) };
      }
    } catch (e) {}
  }
  return null;
}
function flightDlg(t) {
  const st = stopsOf(t.id), last = st[st.length - 1];
  let found = [];
  const b = openDlg(`<h2>Lägg till flyg</h2>
    <label for="fc">Flygnummer i den ordning du flög</label><input id="fc" placeholder="t.ex. SK1415, QR160" autocapitalize="characters" autocomplete="off">
    <p class="small mute" style="margin:4px 0 0">Separera med komma. Flygen hämtas från en öppen flygdatabas – kontrollera att sträckan stämmer.</p>
    <label for="fd">Datum</label><input id="fd" type="date" value="${esc(last ? last.data.date || today() : today())}">
    <div class="whowrap"><label>Vem reste?</label><div class="chips" id="who"></div></div>
    <label style="display:flex;gap:10px;align-items:center;font-weight:600"><input type="checkbox" id="fv" checked style="width:22px;min-height:22px"> Byten räknas som mellanlandning (en etapp)</label>
    <div id="fres"></div>
    <div class="row end" style="margin-top:16px"><button type="button" data-close>Avbryt</button><button type="button" id="fget">Hämta flyg</button><button class="pri" id="fok" disabled>Lägg till</button></div>`);
  const getWho = whoPicker($('#who'), last ? last.data.travelers : null);
  const show = () => {
    if (!found.length) return;
    const near = last && hasPos(last) && found[0].f && hav(pos(last), [found[0].f.from.lon, found[0].f.from.lat]) < 60;
    $('#fres').innerHTML = `<div class="card" style="margin-top:12px">${found.map(x => x.f ? `<div style="padding:4px 0"><b>${esc(x.code)}</b> ${esc(x.f.from.name)} → ${esc(x.f.to.name)}${x.f.airline ? `<div class="small mute">${esc(x.f.airline)}</div>` : ''}</div>` : `<div style="padding:4px 0;color:#b00020"><b>${esc(x.code)}</b> hittades inte – lägg till den sträckan med + Ny plats</div>`).join('')}
      ${found[0].f && !near ? `<p class="small mute" style="margin:6px 0 0">${esc(found[0].f.from.name)} läggs till som plats före flyget${st.length ? ' (färdmedel dit: egen bil – ändra vid behov)' : ' (startplats)'}.</p>` : ''}</div>`;
    $('#fok').disabled = !found.some(x => x.f);
  };
  $('#fget').onclick = async () => {
    const codes = $('#fc').value.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    if (!codes.length) return toast('Skriv minst ett flygnummer');
    if (!navigator.onLine) return toast('Det krävs nät för att hämta flyg');
    $('#fget').disabled = true; $('#fres').innerHTML = '<p class="small mute">Hämtar…</p>';
    found = [];
    for (const c of codes) found.push({ code: c.toUpperCase(), f: await lookupFlight(c) });
    $('#fget').disabled = false; show();
  };
  $('#fok').onclick = async () => {
    const ok = found.filter(x => x.f).map(x => x.f); if (!ok.length) return;
    const date = $('#fd').value, viaMode = $('#fv').checked;
    let seq = (last ? (last.data.seq || 0) : 0) + 1, prev = last;
    const addStop = async (p, mode, via) => { const d = await saveDoc('stop', { trip: t.id, name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, cc: p.cc, date, mode, travelers: getWho(), via: via || [], seq: seq++ }); prev = d; };
    if (!(prev && hasPos(prev) && hav(pos(prev), [ok[0].from.lon, ok[0].from.lat]) < 60)) await addStop(ok[0].from, prev ? 'bil' : '');
    if (viaMode) {
      const via = ok.slice(0, -1).map(f => ({ name: f.to.name, lat: f.to.lat, lon: f.to.lon, cc: f.to.cc }));
      await addStop(ok[ok.length - 1].to, 'flyg', via);
    } else {
      for (const [i, f] of ok.entries()) {
        if (i && hav([ok[i - 1].to.lon, ok[i - 1].to.lat], [f.from.lon, f.from.lat]) > 60) await addStop(f.from, 'bil');
        await addStop(f.to, 'flyg');
      }
    }
    closeDlg(); toast('Flygen är tillagda'); render();
  };
}
function stopDlg(t, s, preset) {
  const st = stopsOf(t.id), isFirst = s ? st[0] && st[0].id === s.id : !st.length;
  const last = st[st.length - 1];
  const D = s ? JSON.parse(JSON.stringify(s.data)) : { trip: t.id, name: '', date: last ? last.data.date : today(), mode: 'bil', travelers: last ? travelersOf(last.data.travelers) : allIds(), via: [], seq: (last ? (last.data.seq || 0) : 0) + 1 };
  if (preset && !s) Object.assign(D, { name: preset.name, sub: preset.sub || '', lat: preset.lat, lon: preset.lon, cc: preset.cc }, preset.date ? { date: preset.date } : {}, preset.needsName ? { needsName: true } : {});
  if (!D.via) D.via = []; if (!D.pass) D.pass = []; if (!D.travelers) D.travelers = [];
  const home = homeOf();
  const b = openDlg(`<h2>${s ? 'Ändra plats' : isFirst ? 'Startplats' : 'Ny plats'}</h2>
    <label>Plats</label><div id="sb"></div>${home ? `<button type="button" class="sm" id="usehome" style="margin-top:6px">Hem: ${esc(home.name)}</button>` : ''}<div id="picked" class="note"${D.lat != null ? '' : ' hidden'}></div>
    ${isFirst ? '' : `<label>Färdmedel hit</label><div class="chips" id="modes">${Object.entries(MODES).map(([k, m]) => `<button type="button" class="chip" data-m="${k}">${m.n}</button>`).join('')}</div>
    <div id="viabox" hidden><label>Mellanlandningar</label><div id="vias"></div><div id="vsb" style="margin-top:6px"></div><p class="small mute" style="margin:4px 0 0">Räknas inte som besökt land.</p></div>
    <div id="routebox" hidden><label>Hur ska vägen ritas?</label><div class="chips" id="rmode"><button type="button" class="chip" data-r="auto">Längs väg/räls</button><button type="button" class="chip" data-r="straight">Rak linje</button></div>
    <div id="passwrap"><div id="passes" style="margin-top:6px"></div><div id="psb" style="margin-top:6px"></div><p class="small mute" style="margin:4px 0 0">Blir vägen fel? Lägg till en ort som vägen ska gå förbi. Räknas inte som besökt plats.</p></div></div>`}
    <div class="whowrap"><label>Vem reste?</label><div class="chips" id="who"></div></div>
    <label for="sd">Datum</label><input id="sd" type="date" value="${esc(D.date || '')}">
    <div class="row end" style="margin-top:16px">${s ? '<button type="button" id="up" class="sm">↑</button><button type="button" id="dn" class="sm">↓</button><button type="button" id="del">Ta bort</button>' : ''}<button type="button" data-close>Avbryt</button><button class="pri" id="ok">Spara</button></div>`);
  const showPicked = () => { const p = $('#picked'); p.hidden = D.lat == null; p.innerHTML = D.lat != null ? `${flag(D.cc)} <b>${esc(D.name)}</b> ${D.sub ? '· ' + esc(D.sub) : ''}` : ''; };
  const inp = searchBox($('#sb'), p => { Object.assign(D, { name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, cc: p.cc }); showPicked(); });
  inp.value = D.name || ''; showPicked();
  if ($('#usehome')) $('#usehome').onclick = () => { Object.assign(D, { name: home.name, sub: home.sub || '', lat: home.lat, lon: home.lon, cc: home.cc }); inp.value = home.name; showPicked(); };
  const renderModes = () => { if (!$('#modes')) return; $('#modes').querySelectorAll('[data-m]').forEach(x => { const on = x.dataset.m === D.mode; x.classList.toggle('on', on); x.style.background = on ? MODES[x.dataset.m].c : ''; x.style.borderColor = on ? MODES[x.dataset.m].c : ''; }); $('#viabox').hidden = D.mode !== 'flyg'; const ground = ['car', 'bike', 'foot', 'rail'].includes((MODES[D.mode] || MODES.bil).r); $('#routebox').hidden = !ground; $('#rmode').querySelectorAll('[data-r]').forEach(x => { const on = (x.dataset.r === 'straight') === !!D.straight; x.classList.toggle('on', on); x.style.background = x.style.borderColor = on ? '#13242e' : ''; }); $('#passwrap').hidden = !!D.straight; };
  const renderPass = () => { if (!$('#passes')) return; $('#passes').innerHTML = D.pass.map((v, i) => `<div class="spread" style="padding:4px 0"><span>via ${flag(v.cc)} ${esc(v.name)}</span><button type="button" class="sm" data-rp="${i}" aria-label="Ta bort">✕</button></div>`).join(''); };
  const renderVias = () => { if (!$('#vias')) return; $('#vias').innerHTML = D.via.map((v, i) => `<div class="spread" style="padding:4px 0"><span>${flag(v.cc)} ${esc(v.name)}</span><button type="button" class="sm" data-rv="${i}" aria-label="Ta bort">✕</button></div>`).join(''); };
  if ($('#modes')) {
    $('#modes').onclick = e => { const x = e.target.closest('[data-m]'); if (x) { D.mode = x.dataset.m; renderModes(); } };
    $('#vias').onclick = e => { const x = e.target.closest('[data-rv]'); if (x) { D.via.splice(+x.dataset.rv, 1); renderVias(); } };
    const vin = searchBox($('#vsb'), p => { D.via.push({ name: p.name, lat: p.lat, lon: p.lon, cc: p.cc }); vin.value = ''; renderVias(); }, '+ Lägg till mellanlandning (sök flygplats)');
    $('#rmode').onclick = e => { const x = e.target.closest('[data-r]'); if (x) { D.straight = x.dataset.r === 'straight'; renderModes(); } };
    $('#passes').onclick = e => { const x = e.target.closest('[data-rp]'); if (x) { D.pass.splice(+x.dataset.rp, 1); renderPass(); } };
    const pin = searchBox($('#psb'), p => { D.pass.push({ name: p.name, lat: p.lat, lon: p.lon, cc: p.cc }); pin.value = ''; renderPass(); }, '+ Passera via (sök ort)');
    renderModes(); renderVias(); renderPass();
  }
  const getWho = whoPicker($('#who'), D.travelers);
  $('#ok').onclick = async () => {
    const typed = inp.value.trim();
    if (!typed) { toast('Skriv eller sök en plats'); return; }
    if (s && typed !== (s.data.name || '') && D.lat === s.data.lat && D.lon === s.data.lon && s.data.geoGuess) { D.lat = D.lon = null; D.cc = ''; }
    D.name = typed; D.geoGuess = false;
    D.date = $('#sd').value; D.travelers = getWho(); if (isFirst) D.mode = '';
    if (D.mode !== 'flyg') D.via = [];
    if (!['car', 'bike', 'foot', 'rail'].includes((MODES[D.mode] || {}).r)) { D.pass = []; D.straight = false; }
    if (D.straight) D.pass = [];
    await saveDoc('stop', D, s && s.id); closeDlg(); render();
  };
  if (s) {
    const move = async dir => { const i = st.findIndex(x => x.id === s.id), j = i + dir; if (j < 0 || j >= st.length) return; const a = st[i].data.seq, bq = st[j].data.seq; await saveDoc('stop', { seq: bq }, st[i].id); await saveDoc('stop', { seq: a === bq ? a + dir : a }, st[j].id); closeDlg(); render(); };
    $('#up').onclick = () => move(-1); $('#dn').onclick = () => move(1);
    $('#del').onclick = () => confirmDlg('Ta bort platsen?', `${s.data.name} tas bort från resan.`, 'Ta bort', async () => { await deleteDoc(s.id); render(); });
  }
}

/* ---------------- dagbok ---------------- */
function viewDagbok(main, t) {
  if (!t) { main.innerHTML = noTrip(); return; }
  const es = entriesOf(t.id).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || (b.data.created || '').localeCompare(a.data.created || ''));
  const sName = id => { const s = S.docs.get(id); return live(s) ? s.data.name : ''; };
  main.innerHTML = `<div class="pad"><div class="spread"><span>${t.data.album ? `<a href="${esc(t.data.album)}" target="_blank" rel="noopener" style="font-weight:600;color:var(--ink)">Hela fotoalbumet ↗</a>` : ''}</span><button class="pri sm" id="add">+ Inlägg</button></div>
    ${es.length ? '' : '<div class="empty">Inga inlägg ännu. Skriv om dagen, en upplevelse eller lägg till bilder.</div>'}
    ${es.map(e => `<article class="card" id="e-${e.id}" style="margin-top:12px">
      <div class="spread small mute"><span>${esc(fmtD(e.data.date))}${sName(e.data.stop) ? ' · ' + esc(sName(e.data.stop)) : ''} · ${esc(e.data.kind || 'Dagbok')}</span>${e.data.author ? `<span class="who" style="color:${memberColor(e.data.author)}">${esc(memberName(e.data.author))}</span>` : ''}</div>
      <h3 style="margin-top:6px">${esc(e.data.title || 'Utan rubrik')}</h3>
      ${e.data.rating ? `<div class="stars" aria-label="${e.data.rating} av 5">${'★'.repeat(e.data.rating)}${'☆'.repeat(5 - e.data.rating)}</div>` : ''}
      ${e.data.text ? `<p style="margin:6px 0 0;white-space:pre-wrap">${esc(e.data.text)}</p>` : ''}
      ${(e.data.photos || []).length ? `<div class="ph">${e.data.photos.map(p => `<img data-photo="${p}" alt="" loading="lazy" data-open="${p}">`).join('')}</div>` : ''}
      <div class="row end" style="margin-top:8px">${e.dirty ? '<span class="small" style="color:#8a4a00;margin-right:auto">Väntar på synk</span>' : ''}<button class="sm" data-e="${e.id}">Ändra</button></div></article>`).join('')}</div>`;
  $('#add').onclick = () => entryDlg(t, null);
  main.querySelectorAll('[data-e]').forEach(b => b.onclick = () => entryDlg(t, S.docs.get(b.dataset.e)));
  main.querySelectorAll('[data-open]').forEach(i => i.onclick = () => showPhoto(i.dataset.open));
}
function entryDlg(t, e) {
  const st = stopsOf(t.id);
  const D = e ? JSON.parse(JSON.stringify(e.data)) : { trip: t.id, date: today(), kind: 'Dagbok', title: '', text: '', rating: 0, stop: '', photos: [], author: S.user.id, created: new Date().toISOString() };
  const newPhotos = [];
  const b = openDlg(`<h2>${e ? 'Ändra inlägg' : 'Nytt inlägg'}</h2>
    <label for="et">Rubrik</label><input id="et" value="${esc(D.title)}" placeholder="Vad hände?">
    <div class="row" style="gap:10px"><div style="flex:1"><label for="ed">Datum</label><input id="ed" type="date" value="${esc(D.date)}"></div><div style="flex:1"><label for="ek">Typ</label><select id="ek">${KINDS.map(k => `<option ${k === D.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
    <label for="es">Plats</label><select id="es"><option value="">Ingen särskild plats</option>${st.map(s => `<option value="${s.id}" ${s.id === D.stop ? 'selected' : ''}>${esc(s.data.name)} ${esc(fmtShort(s.data.date))}</option>`).join('')}</select>
    <label for="ex">Text</label><textarea id="ex" placeholder="Skriv om dagen…">${esc(D.text)}</textarea>
    <label for="er">Betyg</label><select id="er"><option value="0">Inget betyg</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${n === D.rating ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>
    <label for="ef">Bilder</label><input id="ef" type="file" accept="image/*" multiple><div id="exif"></div><div class="ph" id="pv"></div>
    <div class="row end" style="margin-top:16px">${e ? '<button type="button" id="del">Ta bort</button>' : ''}<button type="button" data-close>Avbryt</button><button class="pri" id="ok">Spara</button></div>`);
  const pv = () => { $('#pv').innerHTML = D.photos.map((p, i) => `<div style="position:relative"><img data-photo="${p}" alt=""><button type="button" class="sm" data-rm="${i}" style="position:absolute;top:4px;right:4px;min-height:30px;padding:0 8px" aria-label="Ta bort bild">✕</button></div>`).join(''); hydrate($('#pv')); };
  pv();
  $('#pv').onclick = ev => { const x = ev.target.closest('[data-rm]'); if (x) { D.photos.splice(+x.dataset.rm, 1); pv(); } };
  $('#ef').onchange = async ev => {
    const files = [...ev.target.files]; ev.target.value = ''; $('#ok').disabled = true;
    let hint = null;
    for (const [i, f] of files.entries()) {
      $('#exif').innerHTML = `<p class="small mute">Förbereder bild ${i + 1} av ${files.length}…</p>`;
      try {
        const x = await readExif(f), id = uid();
        const [full, th] = await Promise.all([shrink(f, 2000), shrink(f, 480, .75)]);
        await idbPut('blobs', full, 'full:' + id); await idbPut('blobs', th, 'thumb:' + id);
        newPhotos.push({ id, data: { trip: t.id, lat: x.lat, lon: x.lon, taken: x.taken, pending: true } });
        D.photos.push(id); if (!hint && (x.lat != null || x.taken)) hint = x;
      } catch (err) { toast('En bild kunde inte läsas'); }
    }
    pv(); $('#exif').innerHTML = ''; $('#ok').disabled = false;
    if (hint) {
      const parts = [];
      if (hint.taken) { const d = hint.taken.slice(0, 10); $('#ed').value = d; parts.push(new Date(hint.taken).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })); }
      if (hint.lat != null) {
        const near = st.filter(hasPos).map(s => ({ s, d: hav(pos(s), [hint.lon, hint.lat]) })).sort((a, b) => a.d - b.d)[0];
        if (near && near.d < 40) { $('#es').value = near.s.id; parts.unshift(near.s.data.name); } else parts.unshift('en plats som inte finns bland resans platser');
      }
      $('#exif').innerHTML = `<div class="note">Plats och tid hämtade från bilden: <b>${esc(parts.join(', '))}</b></div>`;
    }
  };
  $('#ok').onclick = async () => {
    Object.assign(D, { title: $('#et').value.trim(), date: $('#ed').value, kind: $('#ek').value, stop: $('#es').value, text: $('#ex').value, rating: +$('#er').value });
    const ed = await saveDoc('entry', D, e && e.id);
    for (const p of newPhotos) if (D.photos.includes(p.id)) await saveDoc('photo', { ...p.data, entry: ed.id }, p.id);
    closeDlg(); render();
  };
  if (e) $('#del').onclick = () => confirmDlg('Ta bort inlägget?', 'Inlägget och dess bilder tas bort.', 'Ta bort', async () => { for (const p of e.data.photos || []) await deleteDoc(p); await deleteDoc(e.id); render(); });
}

/* ---------------- statistik ---------------- */
/* personfilter för Världen och Topplistor */
let selPeople = null;
const selIds = () => { const ids = allIds(); const sl = (selPeople || ids).filter(id => ids.includes(id)); return sl.length ? sl : ids; };
function personFilter() {
  const ps = persons(); if (ps.length <= 1) return '';
  const sel = selIds(), all = sel.length === ps.length;
  return `<div class="chips" id="pf" style="margin-bottom:12px"><button class="chip${all ? ' on' : ''}" data-p="all" style="${all ? `background:${BOTH_COLOR};border-color:${BOTH_COLOR}` : ''}">${allLabel()}</button>${ps.map(p => { const on = !all && sel.includes(p.id); return `<button class="chip${on ? ' on' : ''}" data-p="${p.id}" style="${on ? `background:${p.data.color};border-color:${p.data.color}` : `color:${p.data.color};border-color:${p.data.color}`}">${esc(p.data.name)}</button>`; }).join('')}</div>`;
}
function bindPersonFilter(main) {
  const el = main.querySelector('#pf'); if (!el) return;
  el.onclick = e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const ids = allIds(), cur = selIds(), all = cur.length === ids.length;
    if (b.dataset.p === 'all') selPeople = null;
    else if (all) selPeople = [b.dataset.p];
    else { const st = new Set(cur); st.has(b.dataset.p) ? st.delete(b.dataset.p) : st.add(b.dataset.p); selPeople = st.size && st.size < ids.length ? [...st] : null; }
    render();
  };
}
function visitData() {
  const C = new Map(), V = new Map();
  for (const t of trips()) for (const s of stopsOf(t.id)) {
    const tr = travelersOf(s.data.travelers);
    if (s.data.cc) { if (!C.has(s.data.cc)) C.set(s.data.cc, new Set()); tr.forEach(id => C.get(s.data.cc).add(id)); }
    for (const x of s.data.via || []) if (x.cc) { if (!V.has(x.cc)) V.set(x.cc, new Set()); tr.forEach(id => V.get(x.cc).add(id)); }
  }
  return { C, V };
}
function catFor(set, viaSet, sel) {
  const vis = set ? sel.filter(id => set.has(id)) : [], n = vis.length;
  if (!n) return viaSet && sel.some(id => viaSet.has(id)) ? 'M' : null;
  if (sel.length === 1) return 'p:' + sel[0];
  if (n === sel.length) return 'B';
  if (n === 1) return 'p:' + vis[0];
  if (sel.length <= 5) return 'X:' + vis.join(',');
  return 'S';
}
const stripeCss = ids => `repeating-linear-gradient(45deg,${ids.map((id, i) => `${personColor(id)} ${i * 4}px ${(i + 1) * 4}px`).join(',')})`;
const SOME_COLOR = '#8cc3c6';
const catColor = c => c === 'B' ? BOTH_COLOR : c === 'S' ? SOME_COLOR : c === 'M' ? '#ffffff' : c && c.startsWith('p:') ? personColor(c.slice(2)) : c && c.startsWith('X:') ? personColor(c.slice(2).split(',')[0]) : null;
function catLabel(c, sel) {
  if (c === 'B') return sel.length === 2 ? sel.map(personName).join(' och ') : sel.length === allIds().length ? 'Alla' : 'Alla valda';
  if (c === 'S') return 'Några av de valda';
  if (c === 'X') return 'Några av er tillsammans';
  if (c === 'M') return 'Bara mellanlandning';
  return (sel.length === 1 ? '' : 'Bara ') + personName(c.slice(2));
}

let wmap, wReady = false, countries = null, wHolder;
async function loadCountries() {
  if (countries) return countries;
  const r = await fetch(COUNTRIES_URL); const j = await r.json();
  j.features.forEach(f => {
    const p = f.properties, cc0 = (p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2);
    if (cc0 === 'FR' && f.geometry.type === 'MultiPolygon') f.geometry.coordinates = f.geometry.coordinates.filter(poly => { const [x, y] = poly[0][0]; return x > -6 && x < 11 && y > 41 && y < 52; });
  });
  j.features.forEach(f => { const p = f.properties; f.properties = { cc: (p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2) || '', name: p.NAME }; });
  return countries = j;
}
function viewVarlden(main) {
  const sel = selIds(), { C, V } = visitData();
  const cat = cc => catFor(C.get(cc), V.get(cc), sel);
  const allCc = new Set([...C.keys(), ...V.keys()]);
  const kp = [];
  if (sel.length > 1) kp.push({ n: [...C.values()].filter(st => sel.every(id => st.has(id))).length, label: sel.length === 2 ? 'Tillsammans' : sel.length === allIds().length ? 'Alla ihop' : 'Alla valda', col: BOTH_COLOR });
  sel.forEach(id => kp.push({ n: [...C.values()].filter(st => st.has(id)).length, label: personName(id) + (sel.length > 1 ? ' totalt' : ''), col: personColor(id) }));
  const cats = sel.length === 1 ? ['p:' + sel[0], 'M'] : sel.length === 2 ? ['B', 'p:' + sel[0], 'p:' + sel[1], 'M'] : sel.length <= 5 ? ['B', ...sel.map(id => 'p:' + id), 'X', 'M'] : ['B', 'S', 'M'];
  const byCat = k => [...allCc].filter(cc => k === 'X' ? (cat(cc) || '').startsWith('X:') : cat(cc) === k).sort((x, y) => cName(x).localeCompare(cName(y), 'sv'));
  const who = cc => cat(cc) === 'S' || (cat(cc) || '').startsWith('X:') ? ` <span class="small mute">(${sel.filter(id => C.get(cc).has(id)).map(personName).map(esc).join(', ')})</span>` : '';
  main.innerHTML = `<div class="pad">${personFilter()}
    <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(104px,1fr))">${kp.map(k => `<div class="kpi" style="background:${k.col}"><b>${k.n}</b><span>${esc(k.label)}</span></div>`).join('')}</div>
    <a href="#pass" class="btn" style="width:100%;margin-top:10px">Pass och utmärkelser</a>
    <div id="wmapbox" style="margin-top:12px"><div id="wmap"></div></div><p class="small mute" style="margin:6px 0 0">Punkterna är platserna ${sel.length === 1 ? esc(personName(sel[0])) + ' varit på' : 'ni varit på'}, i samma färger som länderna. Tryck på en punkt för namn och resa.</p>
    <div style="margin-top:12px">${cats.map(k => { const l = byCat(k); return l.length ? `<div class="cl"><i style="background:${k === 'X' ? stripeCss(sel) : catColor(k)};${k === 'M' ? 'border:2px dashed #6b7a80' : ''}"></i><span><b>${esc(catLabel(k, sel))} (${l.length}):</b> ${l.map(cc => `${flag(cc)} ${esc(cName(cc))}${who(cc)}`).join(', ')}</span></div>` : ''; }).join('') || '<div class="empty">Lägg till platser i en resa så färgas länderna här.</div>'}</div></div>`;
  bindPersonFilter(main);
  if (!window.maplibregl) { $('#wmapbox').innerHTML = '<div class="mapmsg">Kartan behöver nät första gången.</div>'; return; }
  if (wmap) { try { wmap.remove(); } catch (e) {} wmap = null; wReady = false; }
  {
    wHolder = $('#wmap');
    wmap = new maplibregl.Map({ container: wHolder, style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#bfe3ee' } }] }, center: [15, 35], zoom: 0.6, attributionControl: false, renderWorldCopies: false });
    wmap.on('load', async () => {
      try { await loadCountries(); } catch (e) { $('#wmapbox').insertAdjacentHTML('beforeend', '<div class="mapmsg">Världskartan behöver nät första gången.</div>'); return; }
      wmap.addSource('c', { type: 'geojson', data: countries });
      wmap.addLayer({ id: 'cf', type: 'fill', source: 'c', paint: { 'fill-color': ['coalesce', ['get', 'col'], '#f4f1e6'], 'fill-opacity': 0.92 } });
      wmap.addLayer({ id: 'cfp', type: 'fill', source: 'c', filter: ['has', 'pat'], paint: { 'fill-pattern': ['get', 'pat'], 'fill-opacity': 0.95 } });
      wmap.addLayer({ id: 'cl', type: 'line', source: 'c', paint: { 'line-color': ['case', ['==', ['get', 'cat'], 'M'], '#6b7a80', '#a8551b'], 'line-width': ['case', ['==', ['get', 'cat'], 'M'], 1.6, 0.4] } });
      wmap.addSource('pl', { type: 'geojson', data: fc([]) });
      wmap.addLayer({ id: 'plc', type: 'circle', source: 'pl', filter: ['!', ['has', 'icon']], paint: {
        'circle-color': ['get', 'col'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, ['case', ['get', 'via'], 1.2, 1.6], 2, ['case', ['get', 'via'], 1.6, 2.2], 4, ['case', ['get', 'via'], 2.5, 3.5], 7, ['case', ['get', 'via'], 4, 6], 10, ['case', ['get', 'via'], 5, 8]],
        'circle-stroke-color': ['case', ['get', 'via'], '#6b7a80', '#ffffff'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 3, 0.8, 6, 1.5] } });
      wmap.addLayer({ id: 'pli', type: 'symbol', source: 'pl', filter: ['has', 'icon'], layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 0.2, 2, 0.26, 4, 0.36, 7, 0.6, 10, 0.8] } });
      wReady = true; paintWorld();
      wmap.on('click', 'pli', e => { const p = e.features[0].properties; new maplibregl.Popup({ closeButton: false }).setLngLat(e.features[0].geometry.coordinates).setHTML(`<b>${esc(p.name)}</b><div style="font-size:12px;margin-top:4px;line-height:1.5">${p.info}</div>`).addTo(wmap); });
      wmap.on('click', 'plc', e => { const p = e.features[0].properties; new maplibregl.Popup({ closeButton: false }).setLngLat(e.features[0].geometry.coordinates).setHTML(`<b>${esc(p.name)}</b><div style="font-size:12px;margin-top:4px;line-height:1.5">${p.info}</div>`).addTo(wmap); });
      wmap.on('mouseenter', 'plc', () => wmap.getCanvas().style.cursor = 'pointer');
      wmap.on('mouseleave', 'plc', () => wmap.getCanvas().style.cursor = '');
      wmap.on('click', 'cf', e => { if (wmap.queryRenderedFeatures(e.point, { layers: ['plc', 'pli'] }).length) return; const p = e.features[0].properties; new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`<b>${flag(p.cc)} ${esc(cName(p.cc) || p.name)}</b>`).addTo(wmap); });
    });
  }
}
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function stripeImageFor(ids) {
  const key = 'pat-' + ids.join('_');
  if (!wmap.hasImage(key)) {
    const cols = ids.map(id => hexRgb(personColor(id))), w = 10, T = cols.length * w, data = new Uint8Array(T * T * 4);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const c = cols[Math.floor(((x + y) % T) / w)], i = (y * T + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 240; }
    wmap.addImage(key, { width: T, height: T, data }, { pixelRatio: 2 });
  }
  return key;
}
function pieImageFor(ids) {
  const key = 'pie-' + ids.join('_');
  if (!wmap.hasImage(key)) {
    const S2 = 48, c = document.createElement('canvas'); c.width = c.height = S2; const g = c.getContext('2d'), r = S2 / 2 - 4, n = ids.length;
    ids.forEach((id, i) => { g.beginPath(); g.moveTo(S2 / 2, S2 / 2); g.arc(S2 / 2, S2 / 2, r, -Math.PI / 2 + i * 2 * Math.PI / n, -Math.PI / 2 + (i + 1) * 2 * Math.PI / n); g.closePath(); g.fillStyle = personColor(id); g.fill(); });
    g.beginPath(); g.arc(S2 / 2, S2 / 2, r, 0, 2 * Math.PI); g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
    wmap.addImage(key, g.getImageData(0, 0, S2, S2), { pixelRatio: 2 });
  }
  return key;
}
function paintWorld() {
  if (!wReady || !countries) return;
  const sel = selIds(), { C, V } = visitData();
  countries.features.forEach(f => {
    const c = catFor(C.get(f.properties.cc), V.get(f.properties.cc), sel);
    f.properties.cat = c || ''; f.properties.col = c ? catColor(c) : null;
    if (c && c.startsWith('X:')) f.properties.pat = stripeImageFor(c.slice(2).split(',')); else delete f.properties.pat;
  });
  wmap.getSource('c').setData(countries);
  if (wmap.getSource('pl')) wmap.getSource('pl').setData(fc(placePoints(sel).map(f => { if (f.properties.mix) f.properties.icon = pieImageFor(f.properties.mix.split(',')); return f; })));
}
function placePoints(sel) {
  const P = new Map(), key = (lat, lon) => lat.toFixed(2) + ',' + lon.toFixed(2);
  const add = (name, lat, lon, via, tr, trip) => {
    const k = key(lat, lon);
    if (!P.has(k)) P.set(k, { name, lat, lon, vis: new Set(), vias: new Set(), trips: new Map(), named: false });
    const p = P.get(k);
    if (!p.trips.has(trip)) p.trips.set(trip, { vis: new Set(), via: false });
    const t = p.trips.get(trip);
    if (via) { t.via = true; tr.forEach(id => p.vias.add(id)); return; }
    if (!p.named) { p.name = name; p.named = true; }
    tr.forEach(id => { p.vis.add(id); t.vis.add(id); });
  };
  for (const t of trips()) for (const s of stopsOf(t.id)) {
    const tr = travelersOf(s.data.travelers);
    if (hasPos(s)) add(s.data.name, s.data.lat, s.data.lon, false, tr, t.data.title);
    for (const v of s.data.via || []) if (v.lat != null) add(v.name, v.lat, v.lon, true, tr, t.data.title);
  }
  const all = allIds();
  const whoOf = x => !x.vis.size ? 'mellanlandning' : all.length > 1 && all.every(id => x.vis.has(id)) ? allLabel() : [...x.vis].map(personName).join(', ');
  const out = [];
  for (const p of P.values()) {
    const cat = catFor(p.vis.size ? p.vis : null, p.vias, sel); if (!cat) continue;
    const info = [...p.trips.entries()].map(([trip, x]) => `${esc(trip)}: <b>${esc(persons().length > 1 || !x.vis.size ? whoOf(x) : 'besökt')}</b>`).join('<br>');
    out.push({ type: 'Feature', properties: { name: p.name, via: cat === 'M', col: catColor(cat), info, ...(cat.startsWith('X:') ? { mix: cat.slice(2) } : {}) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
  }
  return out;
}

function viewTopp(main) {
  const sel = selIds();
  const years = [...new Set(ofKind('stop').map(s => (s.data.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const yr = viewTopp.year || '';
  const inYear = s => !yr || (s.data.date || '').startsWith(yr);
  const all = trips().flatMap(t => legs(t).map(l => ({ ...l, t }))).filter(l => inYear(l.b) && travelersOf(l.tr).some(id => sel.includes(id)));
  const perMode = {}; all.forEach(l => perMode[l.mode] = (perMode[l.mode] || 0) + l.km);
  const maxMode = Math.max(1, ...Object.values(perMode));
  const stat = id => {
    const ls = all.filter(l => travelersOf(l.tr).includes(id));
    const cs = new Set(), days = new Set(), tr = new Set();
    trips().forEach(t => {
      const st = stopsOf(t.id).filter(s => inYear(s) && travelersOf(s.data.travelers).includes(id));
      if (st.length) tr.add(t.id);
      st.forEach(s => { if (s.data.cc) cs.add(s.data.cc); if (s.data.date) days.add(s.data.date); });
      const ds = st.filter(s => s.data.date).map(s => s.data.date).sort();
      if (ds.length > 1) for (let d = new Date(ds[0]); d <= new Date(ds[ds.length - 1]); d.setDate(d.getDate() + 1)) days.add(d.toISOString().slice(0, 10));
    });
    return { id, km: ls.reduce((a, l) => a + l.km, 0), countries: cs.size, days: days.size, trips: tr.size };
  };
  const stats = sel.map(stat);
  const metrics = [['countries', 'Länder'], ['days', 'Resdagar'], ['trips', 'Resor'], ['km', 'Kilometer']];
  const longest = [...all].sort((a, b) => b.km - a.km).slice(0, 5);
  const viaC = {}; all.forEach(l => l.via.forEach(v => viaC[v.name] = (viaC[v.name] || 0) + 1));
  const vias = Object.entries(viaC).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const placeC = {}; trips().forEach(t => new Set(stopsOf(t.id).filter(s => inYear(s) && travelersOf(s.data.travelers).some(id => sel.includes(id))).map(s => s.data.name)).forEach(n => placeC[n] = (placeC[n] || 0) + 1));
  const places = Object.entries(placeC).filter(p => p[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const statCard = stats.length === 1
    ? `<section class="card"><div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">${metrics.map(([k, l]) => `<div class="kpi" style="background:${personColor(stats[0].id)}"><b>${k === 'km' ? nf(stats[0][k]) : stats[0][k]}</b><span>${l}</span></div>`).join('')}</div></section>`
    : `<section class="card"><h3>Topplista</h3><div class="ranks">${metrics.map(([k, l]) => `<div><div class="small" style="font-weight:800;margin-bottom:2px">${l}</div>${[...stats].sort((a, b) => b[k] - a[k]).map((x, i) => `<div class="spread" style="padding:2px 0;font-size:14px"><span>${i + 1}. <span class="dot" style="background:${personColor(x.id)}"></span>${esc(personName(x.id))}</span><span class="num">${k === 'km' ? nf(x[k]) : x[k]}</span></div>`).join('')}</div>`).join('')}</div></section>`;
  main.innerHTML = `<div class="pad">${personFilter()}
    <div class="seg" id="yrs" style="margin-bottom:12px"><button data-y="" class="${yr ? '' : 'on'}">Alla år</button>${years.slice(0, 4).map(y => `<button data-y="${y}" class="${yr === y ? 'on' : ''}">${y}</button>`).join('')}</div>
    <a href="#pass" class="btn" style="width:100%;margin-bottom:12px">Pass och utmärkelser</a>
    ${statCard}
    <section class="card bars"><h3>Kilometer per färdmedel</h3>${Object.entries(perMode).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="r"><span>${MODES[k] ? MODES[k].n : k}</span><i style="width:${Math.max(2, v / maxMode * 100)}%;background:${(MODES[k] || MODES.bil).c}"></i><span class="num">${nf(v)} km</span></div>`).join('') || '<p class="mute small">Inga etapper ännu.</p>'}</section>
    <section class="card"><h3>Längsta etapperna</h3>${longest.map((l, i) => `<div class="spread" style="padding:5px 0;font-size:14px"><span><b>${i + 1}.</b> ${esc(l.a.data.name)} → ${esc(l.b.data.name)} <span class="small mute">${esc(l.m.n)}${l.via.length ? ' via ' + esc(l.via.map(v => v.name).join(', ')) : ''}</span></span><span class="num">${nf(l.km)} km</span></div>`).join('') || '<p class="mute small">Inga etapper ännu.</p>'}</section>
    ${vias.length ? `<section class="card"><h3>Flest mellanlandningar</h3><p class="small mute" style="margin:2px 0 6px">Räknas inte som besökta länder</p>${vias.map(([n, c]) => `<div class="spread" style="font-size:14px;padding:3px 0"><span>${esc(n)}</span><span class="num">×${c}</span></div>`).join('')}</section>` : ''}
    ${places.length ? `<section class="card"><h3>Mest återbesökta platser</h3>${places.map(([n, c]) => `<div class="spread" style="font-size:14px;padding:3px 0"><span>${esc(n)}</span><span class="num">${c} resor</span></div>`).join('')}</section>` : ''}
  </div>`;
  bindPersonFilter(main);
  $('#yrs').onclick = e => { const b = e.target.closest('[data-y]'); if (b) { viewTopp.year = b.dataset.y; render(); } };
}
function viewMer(main) {
  const me = S.members.find(m => m.user_id === S.user.id);
  const hasRoles = S.members.some(m => m.role !== undefined), admin = me && me.role === 'admin';
  const link = `${location.origin}${location.pathname}#join-${S.joinCode}`;
  main.innerHTML = `<div class="pad">
    <section class="card"><div class="spread"><h3>Personer</h3><button class="sm" id="padd">+ Person</button></div>
      <p class="small mute" style="margin:4px 0 6px">Alla som brukar resa med, även barn utan eget konto. Tryck för att ändra namn och färg.</p>
      ${persons().map(p => { const m = p.data.user_id && S.members.find(x => x.user_id === p.data.user_id); return `<button class="prow" data-p="${p.id}"><span class="dot" style="background:${p.data.color}"></span><span style="flex:1;text-align:left">${esc(p.data.name)}${p.data.user_id === S.user.id ? ' <span class="mute">(du)</span>' : ''}</span><span class="small mute">${p.data.user_id ? (m && m.role === 'admin' ? 'admin' : m ? 'konto' : 'konto borttaget') : 'utan konto'}</span></button>`; }).join('')}</section>
    <section class="card"><h3>Bjud in</h3><p class="small mute" style="margin:4px 0 8px">Skicka länken till den som ska vara med. Hen skapar ett konto och hamnar direkt i dagboken.</p>
      <div class="row"><button class="pri" id="share">Dela inbjudan</button><span class="small">Kod: <b style="letter-spacing:2px">${esc(S.joinCode || '…')}</b></span>${admin ? '<button class="sm" id="newcode">Ny kod</button>' : ''}</div>
      ${!hasRoles ? '<p class="small" style="color:#8a4a00;margin:8px 0 0">Kör uppdateringen schema_v2.sql i Supabase för att kunna ta bort medlemmar och byta kod.</p>' : ''}</section>
    <section class="card"><h3>Hem</h3><p class="small mute" style="margin:4px 0 8px">Används som startplats för nya resor och för knappen Hemresa.</p>${homeOf() ? `<div class="note" style="margin:0 0 8px">${flag(homeOf().cc)} <b>${esc(homeOf().name)}</b></div>` : ''}<div id="homesb"></div></section>
    <section class="card"><h3>Synk</h3><p class="small" style="margin:6px 0">${pendingCount()} ändringar väntar · ${S.lastSync ? 'senast ' + S.lastSync.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : 'inte synkad ännu'}${S.syncErr ? `<br><span style="color:#b00020">${esc(S.syncErr)}</span>` : ''}</p><button id="syncnow">Synka nu</button></section>
    <section class="card"><h3>Säkerhetskopia</h3><p class="small mute" style="margin:6px 0">All text och alla platser som en fil. Bilderna ligger kvar i molnet.</p><button id="exp">Ladda ner kopia</button></section>
    <button id="lo" style="width:100%">Logga ut</button>
    <p class="small mute" style="margin-top:16px">Karta © OpenFreeMap, OpenMapTiles, OpenStreetMap-bidragsgivare. Sökning: Photon. Rutter: FOSSGIS OSRM och BRouter. Flyg: adsbdb.</p></div>`;
  main.querySelectorAll('.prow').forEach(b => b.onclick = () => personDlg(S.docs.get(b.dataset.p)));
  $('#padd').onclick = () => personDlg(null);
  $('#share').onclick = async () => {
    if (!S.joinCode) return toast('Koden hämtas när du har nät');
    const text = `Gå med i vår resdagbok: ${link}`;
    try { if (navigator.share) { await navigator.share({ title: 'Resdagboken', text: 'Gå med i vår resdagbok', url: link }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Länken är kopierad'); } catch (e) { openDlg(`<h2>Inbjudan</h2><p>Kopiera länken och skicka den:</p><textarea readonly style="min-height:90px">${esc(text)}</textarea><div class="row end"><button data-close>Stäng</button></div>`); }
  };
  if ($('#newcode')) $('#newcode').onclick = () => confirmDlg('Byta inbjudningskod?', 'Gamla länkar och koder slutar fungera. De som redan är med påverkas inte.', 'Byt kod', async () => {
    const { data, error } = await sb.rpc('new_join_code', { p_group: S.group }); if (error) return toast(navigator.onLine ? error.message : 'Kräver nät');
    S.joinCode = data; await idbPut('kv', data, 'joinCode'); toast('Ny kod: ' + data); render();
  });
  searchBox($('#homesb'), async p => { await saveDoc('home', { name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, cc: p.cc }, S.user.id); toast('Hem är sparat'); render(); }, homeOf() ? 'Byt hem – sök ort eller adress' : 'Sök din hemort eller adress');
  $('#syncnow').onclick = async () => { await sync(); render(); };
  $('#exp').onclick = () => { const data = JSON.stringify({ exported: new Date().toISOString(), docs: [...S.docs.values()].filter(live).map(d => ({ id: d.id, kind: d.kind, data: d.data })) }, null, 1); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = `resdagboken-${today()}.json`; a.click(); };
  $('#lo').onclick = () => confirmDlg('Logga ut?', 'Ändringar som inte är synkade försvinner från den här telefonen.', 'Logga ut', logout);
}
function personDlg(p) {
  const used = persons().map(x => x.data.color);
  const D = p ? { ...p.data } : { name: '', color: PERSON_COLORS.find(c => !used.includes(c)) || PERSON_COLORS[0] };
  const member = p && p.data.user_id ? S.members.find(m => m.user_id === p.data.user_id) : null;
  const me = S.members.find(m => m.user_id === S.user.id), admin = me && me.role === 'admin';
  const other = p && p.data.user_id && p.data.user_id !== S.user.id && member;
  openDlg(`<h2>${p ? 'Ändra person' : 'Ny person'}</h2>
    <label for="pn">Namn</label><input id="pn" value="${esc(D.name)}" placeholder="t.ex. Max">
    <label>Färg</label><div class="chips" id="pc">${PERSON_COLORS.map(c => `<button type="button" class="swatch${c === D.color ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="Välj färg"></button>`).join('')}</div>
    ${p ? `<p class="small mute" style="margin:10px 0 0">${p.data.user_id ? 'Har eget konto' + (member && member.role === 'admin' ? ' · administratör' : '') : 'Utan eget konto. Om personen senare skaffar ett konto och går med via inbjudan kan hen välja sig själv här.'}</p>` : ''}
    <div class="row end" style="margin-top:16px">
      ${p && !p.data.user_id ? '<button type="button" id="pdel">Ta bort</button>' : ''}
      ${other && admin ? `<button type="button" class="sm" id="padm">${member.role === 'admin' ? 'Ta bort admin' : 'Gör till admin'}</button><button type="button" class="sm" id="prm">Ta bort från dagboken</button>` : ''}
      <button type="button" data-close>Avbryt</button><button class="pri" id="pok">Spara</button></div>`);
  $('#pc').onclick = e => { const x = e.target.closest('[data-c]'); if (!x) return; D.color = x.dataset.c; $('#pc').querySelectorAll('.swatch').forEach(y => y.classList.toggle('on', y === x)); };
  $('#pok').onclick = async () => {
    const name = $('#pn').value.trim(); if (!name) return toast('Skriv ett namn');
    await saveDoc('person', { ...D, name, order: p ? (p.data.order ?? persons().length) : persons().length }, p && p.id);
    if (p && p.data.user_id === S.user.id) { sb.from('members').update({ name }).eq('group_id', S.group).eq('user_id', S.user.id).then(() => loadMembers()); }
    closeDlg(); render();
  };
  if ($('#pdel')) $('#pdel').onclick = () => confirmDlg(`Ta bort ${p.data.name}?`, 'Personen försvinner från listor och statistik. Resorna finns kvar.', 'Ta bort', async () => { await deleteDoc(p.id); render(); });
  if ($('#prm')) $('#prm').onclick = () => confirmDlg(`Ta bort ${p.data.name} från dagboken?`, 'Kontot förlorar åtkomst. Personen finns kvar i resorna som person utan konto.', 'Ta bort', async () => {
    const { error } = await sb.rpc('remove_member', { p_group: S.group, p_user: p.data.user_id }); if (error) return toast(navigator.onLine ? error.message : 'Kräver nät');
    await saveDoc('person', { user_id: null }, p.id); await loadMembers(); render();
  });
  if ($('#padm')) $('#padm').onclick = async () => {
    const { error } = await sb.rpc('set_member_role', { p_group: S.group, p_user: p.data.user_id, p_role: member.role === 'admin' ? 'member' : 'admin' }); if (error) return toast(navigator.onLine ? error.message : 'Kräver nät');
    await loadMembers(); closeDlg(); render();
  };
}

/* ---------------- pass och utmärkelser ---------------- */
const CONT = {};
('EU:AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK|' +
 'AS:AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE|' +
 'AF:AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW|' +
 'NA:AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI|' +
 'SA:AR BO BR CL CO EC FK GF GY PE PY SR UY VE|OC:AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS')
  .split('|').forEach(g => { const [k, l] = g.split(':'); l.split(' ').forEach(c => CONT[c] = k); });
const CONT_NAME = { EU: 'Europa', AS: 'Asien', AF: 'Afrika', NA: 'Nordamerika', SA: 'Sydamerika', OC: 'Oceanien' };
let passPerson = null;
function viewPass(main) {
  const ps = persons();
  if (!ps.length) { main.innerHTML = '<div class="pad"><div class="empty">Inga personer ännu.</div></div>'; return; }
  const me = personForUser(S.user.id);
  const pid = passPerson && personById(passPerson) ? passPerson : (me ? me.id : ps[0].id);
  const col = personColor(pid);
  const stops = [], ls = [];
  for (const t of trips()) {
    stopsOf(t.id).forEach(s => { if (travelersOf(s.data.travelers).includes(pid)) stops.push({ s, t }); });
    legs(t).forEach(l => { if (travelersOf(l.tr).includes(pid)) ls.push(l); });
  }
  const C = new Map();
  stops.forEach(({ s, t }) => { if (!s.data.cc) return; const c = C.get(s.data.cc) || { first: '', trips: new Set() }; if (s.data.date && (!c.first || s.data.date < c.first)) c.first = s.data.date; c.trips.add(t.id); C.set(s.data.cc, c); });
  const conts = new Set([...C.keys()].map(cc => CONT[cc]).filter(Boolean));
  const located = stops.filter(x => hasPos(x.s));
  const lats = located.map(x => x.s.data.lat);
  const km = ls.reduce((a, l) => a + l.km, 0), longest = Math.max(0, ...ls.map(l => l.km));
  const modes = new Set(ls.map(l => l.mode));
  const tripIds = new Set(stops.map(x => x.t.id));
  const days = new Set();
  trips().forEach(t => { const ds = stopsOf(t.id).filter(s => s.data.date && travelersOf(s.data.travelers).includes(pid)).map(s => s.data.date).sort(); ds.forEach(d => days.add(d)); if (ds.length > 1) for (let d = new Date(ds[0]); d <= new Date(ds[ds.length - 1]); d.setDate(d.getDate() + 1)) days.add(d.toISOString().slice(0, 10)); });
  const nordic = ['SE', 'NO', 'DK', 'FI', 'IS'];
  const badges = [
    ['Första resan', 'Minst en resa', tripIds.size >= 1],
    ['Gränslös', 'Besökt 5 länder', C.size >= 5],
    ['Världsvan', 'Besökt 10 länder', C.size >= 10],
    ['Globetrotter', 'Besökt 25 länder', C.size >= 25],
    ['Utanför Europa', 'Ett land utanför Europa', [...conts].some(c => c !== 'EU')],
    ['Hela Norden', 'Sverige, Norge, Danmark, Finland och Island', nordic.every(c => C.has(c))],
    ['Två kontinenter', 'Besökt två kontinenter', conts.size >= 2],
    ['Tre kontinenter', 'Besökt tre kontinenter', conts.size >= 3],
    ['Alla kontinenter', 'Alla sex bebodda kontinenter', conts.size >= 6],
    ['Ekvatorn', 'Varit både norr och söder om ekvatorn', lats.some(x => x > 0) && lats.some(x => x < 0)],
    ['Polcirkeln', 'Varit norr om polcirkeln', lats.some(x => x >= 66.56)],
    ['Långflygare', 'En etapp över 5 000 km', longest >= 5000],
    ['Alla färdmedel', 'Rest med alla nio färdmedel', Object.keys(MODES).every(m => modes.has(m))],
    ['Tusen kilometer', 'Rest 1 000 km', km >= 1000],
    ['Tiotusen kilometer', 'Rest 10 000 km', km >= 10000],
    ['Jorden runt', 'Rest 40 075 km – ett varv runt jorden', km >= 40075],
    ['Månadslång', '30 resdagar', days.size >= 30],
    ['Hundra dagar', '100 resdagar', days.size >= 100]
  ];
  const earned = badges.filter(b => b[2]), locked = badges.filter(b => !b[2]);
  const ext = (f, cmp) => located.reduce((best, x) => !best || cmp(f(x.s), f(best.s)) ? x : best, null);
  const recs = located.length ? [['Nordligaste', ext(x => x.data.lat, (a, b) => a > b)], ['Sydligaste', ext(x => x.data.lat, (a, b) => a < b)], ['Östligaste', ext(x => x.data.lon, (a, b) => a > b)], ['Västligaste', ext(x => x.data.lon, (a, b) => a < b)]] : [];
  const stamps = [...C.entries()].sort((a, b) => (a[1].first || '9').localeCompare(b[1].first || '9'));
  const rot = cc => ((cc.charCodeAt(0) * 7 + cc.charCodeAt(1) * 3) % 15) - 7;
  const medal = (on, txt) => `<svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="16" fill="${on ? col : '#dfe5e7'}"/><circle cx="19" cy="19" r="12" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="2 2"/><text x="19" y="23.5" text-anchor="middle" font-size="12" font-weight="800" fill="${on ? '#fff' : '#9aa8ae'}" font-family="Overpass,sans-serif">${esc(txt)}</text></svg>`;
  main.innerHTML = `<div class="pad">
    ${ps.length > 1 ? `<div class="chips" id="pp" style="margin-bottom:12px">${ps.map(p => { const on = p.id === pid; return `<button class="chip${on ? ' on' : ''}" data-p="${p.id}" style="${on ? `background:${p.data.color};border-color:${p.data.color}` : `color:${p.data.color};border-color:${p.data.color}`}">${esc(p.data.name)}</button>`; }).join('')}</div>` : ''}
    <section class="passhead" style="background:${col}">
      <div class="small" style="opacity:.85;letter-spacing:.5px">RESPASS</div>
      <div style="font-size:30px;font-weight:800;line-height:1.1">${esc(personName(pid))}</div>
      <div class="passnums"><div><b>${C.size}</b><span>länder</span></div><div><b>${conts.size}</b><span>kontinenter</span></div><div><b>${tripIds.size}</b><span>resor</span></div><div><b>${nf(km)}</b><span>km</span></div></div>
      ${conts.size ? `<div class="small" style="margin-top:6px;opacity:.9">${[...conts].map(c => CONT_NAME[c]).join(' · ')}</div>` : ''}
    </section>
    <h3 style="margin:18px 0 8px">Stämplar</h3>
    ${stamps.length ? `<div class="stamps">${stamps.map(([cc, c]) => `<div class="stamp" style="--c:${col};--r:${rot(cc)}deg"><span class="f">${flag(cc)}</span><span class="n">${esc(cName(cc))}</span><span class="d">${c.first ? esc(new Date(c.first + 'T12:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })) : ''}${c.trips.size > 1 ? ` · ${c.trips.size} resor` : ''}</span></div>`).join('')}</div>` : '<div class="empty">Inga länder ännu.</div>'}
    <h3 style="margin:18px 0 4px">Utmärkelser <span class="small mute">${earned.length} av ${badges.length}</span></h3>
    <div class="card" style="padding:4px 14px">${earned.concat(locked).map(b => `<div class="badge${b[2] ? '' : ' off'}">${medal(b[2], b[2] ? '★' : '?')}<div><div style="font-weight:800">${esc(b[0])}</div><div class="small mute">${esc(b[1])}</div></div></div>`).join('')}</div>
    ${recs.length ? `<h3 style="margin:18px 0 8px">Rekord</h3><div class="card">${recs.map(([l, x]) => `<div class="spread" style="padding:4px 0;font-size:14px"><span>${l}</span><span><b>${esc(x.s.data.name)}</b> ${flag(x.s.data.cc)} <span class="small mute">${esc(x.t.data.title)}</span></span></div>`).join('')}${longest ? `<div class="spread" style="padding:4px 0;font-size:14px"><span>Längsta etappen</span><b>${nf(longest)} km</b></div>` : ''}</div>` : ''}
  </div>`;
  const pp = $('#pp'); if (pp) pp.onclick = e => { const b = e.target.closest('[data-p]'); if (b) { passPerson = b.dataset.p; render(); } };
}

/* ---------------- start ---------------- */
window.addEventListener('online', () => scheduleSync(200));
window.addEventListener('offline', updateSyncLabel);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
setInterval(() => scheduleSync(0), 60000);
if ('serviceWorker' in navigator) {
  // Ny version: kontrollera vid start och när appen kommer tillbaka från bakgrunden, ladda om automatiskt en gång.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (document.querySelector('#ov.show') || playing) { toast('Ny version av appen finns – den används nästa gång du öppnar appen'); return; }
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
}

{ const jm = location.hash.match(/^#join-([A-Za-z0-9]+)/); if (jm) { try { localStorage.setItem('rdJoin', jm[1].toUpperCase()); } catch (e) {} history.replaceState(null, '', location.pathname + location.search); } }
(async function boot() {
  try {
    for (const d of await idbAll('docs')) S.docs.set(d.id, d);
    S.group = await idbGet('kv', 'group'); S.lastPull = await idbGet('kv', 'lastPull'); S.members = (await idbGet('kv', 'members')) || []; S.joinCode = (await idbGet('kv', 'joinCode')) || ''; S.trip = await idbGet('kv', 'trip');
  } catch (e) {}
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
  if (session) await afterLogin(session.user);
  else renderAuth();
  sb.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT' && shellBuilt) location.reload(); if (s) S.user = s.user; });
})();
