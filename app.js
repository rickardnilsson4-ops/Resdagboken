// Resdagboken – lokal-först resdagbok med synk via Supabase.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

window.__appStarted = true;
const SB_URL = 'https://rqhysvxalunvsrogxtym.supabase.co';
const SB_KEY = 'sb_publishable_qDSkuip40JzdYWaQ0bxTlw_EckWSSHm';
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

/* ---------------- konstanter ---------------- */
const MODES = {
  bil:   { n: 'Egen bil', c: '#e4572e', d: 'solid', w: 4,   r: 'car' },
  taxi:  { n: 'Taxi',     c: '#c99700', d: 'solid', w: 3.5, r: 'car' },
  buss:  { n: 'Buss',     c: '#2a9d8f', d: 'dash',  w: 4,   r: 'car' },
  tag:   { n: 'Tåg',      c: '#3d3dbd', d: 'solid', w: 5,   r: 'rail' },
  flyg:  { n: 'Flyg',     c: '#d6127e', d: 'dash',  w: 3,   r: 'air' },
  bat:   { n: 'Båt',      c: '#0096c7', d: 'dot',   w: 4,   r: 'sea' },
  cykel: { n: 'Cykel',    c: '#3c8d2f', d: 'dot',   w: 3.5, r: 'bike' }
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
const memberName = id => (S.members.find(m => m.user_id === id) || {}).name || '?';
const memberColor = id => MEMBER_COLORS[Math.max(0, S.members.findIndex(m => m.user_id === id)) % MEMBER_COLORS.length];
const isAll = tr => !tr || !tr.length;
function whoBadge(tr) {
  if (isAll(tr)) return `<span class="who all">${S.members.length > 2 ? 'Alla' : 'Båda'}</span>`;
  return tr.map(id => `<span class="who" style="color:${memberColor(id)}">${esc(memberName(id))}</span>`).join(' ');
}
const travelersOf = tr => isAll(tr) ? S.members.map(m => m.user_id) : tr;

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
const routeKey = (a, b) => [b.data.mode, a.data.lat, a.data.lon, b.data.lat, b.data.lon, (b.data.via || []).map(v => v.lat + ',' + v.lon).join(';')].join('|');
function fallbackGeom(a, b) {
  const m = MODES[b.data.mode] || MODES.bil;
  if (m.r === 'air') { const pts = [pos(a), ...(b.data.via || []).map(v => [v.lon, v.lat]), pos(b)]; let o = []; for (let i = 1; i < pts.length; i++) { const seg = gc(pts[i - 1], pts[i]); if (o.length) { const last = o[o.length - 1]; const sh = Math.round((last[0] - seg[0][0]) / 360) * 360; seg.forEach(p => p[0] += sh); seg.shift(); } o = o.concat(seg); } return o; }
  if (m.r === 'sea') return bez(pos(a), pos(b), .12);
  return [pos(a), pos(b)];
}
function legs(t) {
  const st = stopsOf(t.id).filter(hasPos), out = [];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i], m = MODES[b.data.mode] || MODES.bil;
    const routed = b.data.route && b.data.route_key === routeKey(a, b);
    const coords = routed ? b.data.route : fallbackGeom(a, b);
    out.push({ a, b, m, mode: b.data.mode || 'bil', coords, km: lineKm(coords), routed, tr: b.data.travelers || [], via: b.data.via || [] });
  }
  return out;
}

/* ---------------- ruttsökning ---------------- */
async function fetchRoute(a, b) {
  const m = MODES[b.data.mode] || MODES.bil, A = pos(a), B = pos(b);
  if (m.r === 'car' || m.r === 'bike') {
    const prof = m.r === 'car' ? 'routed-car' : 'routed-bike';
    const r = await fetch(`https://routing.openstreetmap.de/${prof}/route/v1/driving/${A[0]},${A[1]};${B[0]},${B[1]}?overview=full&geometries=geojson`);
    if (!r.ok) throw new Error('route ' + r.status);
    const j = await r.json(); return j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
  }
  if (m.r === 'rail') {
    const r = await fetch(`https://brouter.de/brouter?lonlats=${A[0]},${A[1]}|${B[0]},${B[1]}&profile=rail&alternativeidx=0&format=geojson`);
    if (!r.ok) throw new Error('rail ' + r.status);
    const j = await r.json(); const c = j.features && j.features[0] && j.features[0].geometry.coordinates;
    return c && c.map(p => [p[0], p[1]]);
  }
  return null;
}
async function routePending() {
  for (const t of trips()) {
    const st = stopsOf(t.id).filter(hasPos);
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i], m = MODES[b.data.mode] || MODES.bil;
      if (!['car', 'bike', 'rail'].includes(m.r)) continue;
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
async function searchPlaces(q) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`);
  if (!r.ok) throw new Error('search');
  const j = await r.json();
  return (j.features || []).map(f => {
    const p = f.properties || {}, c = f.geometry.coordinates;
    const sub = [p.osm_value === 'aerodrome' ? 'Flygplats' : '', p.city !== p.name ? p.city : '', p.state, p.country].filter(Boolean).join(', ');
    return { name: p.name || p.city || p.street || q, sub, lat: +c[1].toFixed(5), lon: +c[0].toFixed(5), cc: (p.countrycode || '').toUpperCase() };
  });
}
async function reverseCountry(lat, lon) {
  try { const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`); const j = await r.json(); const p = j.features && j.features[0] && j.features[0].properties; return p ? { cc: (p.countrycode || '').toUpperCase(), name: p.name || p.city || '' } : null; } catch (e) { return null; }
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
    S.lastSync = new Date();
    if (changed) render();
    if (data && data.length === 1000) setTimeout(sync, 100);
    routePending().catch(() => {});
  } catch (e) { S.syncErr = e.message || String(e); }
  S.syncing = false; updateSyncLabel();
}
async function loadMembers() {
  const { data } = await sb.from('members').select('user_id,name,joined_at').eq('group_id', S.group).order('joined_at');
  if (data) { S.members = data; await idbPut('kv', data, 'members'); }
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
function renderAuth(msg = '') {
  $('#app').innerHTML = `<div class="center" style="max-width:420px;margin:0 auto;text-align:left;align-items:stretch">
    <h1>Resdagboken</h1><p class="mute">Logga in för att spara och dela era resor.</p>
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
    <div class="card" style="margin-top:16px"><h3>Ny gemensam dagbok</h3><p class="small mute">Du får en kod som den du reser med använder för att gå med.</p><button class="pri" id="cg" style="width:100%">Skapa dagbok</button></div>
    <div class="card"><h3>Gå med med kod</h3><input id="jc" placeholder="Kod, t.ex. 4F2A9C" autocapitalize="characters"><button id="jg" style="width:100%;margin-top:8px">Gå med</button></div>
    <p class="small mute" id="om"></p><button class="ghost" id="lo">Logga ut</button></div>`;
  const nm = () => $('#nm').value.trim();
  $('#cg').onclick = async () => { if (!nm()) return $('#om').textContent = 'Skriv ditt namn först.'; const { data, error } = await sb.rpc('create_group', { p_member_name: nm() }); if (error) return $('#om').textContent = error.message; await setGroup(data); };
  $('#jg').onclick = async () => { if (!nm()) return $('#om').textContent = 'Skriv ditt namn först.'; const { data, error } = await sb.rpc('join_group', { p_code: $('#jc').value, p_member_name: nm() }); if (error) return $('#om').textContent = error.message === 'Fel kod' ? 'Koden stämmer inte.' : error.message; await setGroup(data); };
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
  const v = (location.hash.slice(1) || 'karta'); S.view = VIEWS.some(x => x[0] === v) ? v : 'karta';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === S.view));
  const t = curTrip(); if (t) S.trip = t.id;
  const tripView = ['karta', 'etapper', 'dagbok'].includes(S.view);
  $('#top').innerHTML = tripView
    ? `<select id="tsel" aria-label="Välj resa">${trips().map(x => `<option value="${x.id}" ${t && x.id === t.id ? 'selected' : ''}>${esc(x.data.title)}</option>`).join('') || '<option>Ingen resa ännu</option>'}</select>
       ${t ? '<button class="sm" id="tedit" aria-label="Ändra resa">Ändra</button>' : ''}<button class="sm pri" id="tnew">+ Resa</button><span id="sync"></span>`
    : `<h2 style="flex:1">${VIEWS.find(x => x[0] === S.view)[1]}</h2><span id="sync"></span>`;
  updateSyncLabel();
  if ($('#tsel')) $('#tsel').onchange = e => { S.trip = e.target.value; idbPut('kv', S.trip, 'trip'); stopPlay(); render(); };
  if ($('#tnew')) $('#tnew').onclick = () => tripDlg();
  if ($('#tedit')) $('#tedit').onclick = () => tripDlg(curTrip());
  const main = $('#main');
  if (S.view !== 'karta') detachMap();
  if (S.view !== 'varlden' && wmap) { try { wmap.remove(); } catch (e) {} wmap = null; wReady = false; }
  ({ karta: viewKarta, etapper: viewEtapper, dagbok: viewDagbok, varlden: viewVarlden, topp: viewTopp, mer: viewMer })[S.view](main, t);
  hydrate(main);
}
const noTrip = () => `<div class="pad"><div class="empty"><p>Ingen resa ännu.</p><button class="pri" onclick="document.getElementById('tnew').click()">Skapa din första resa</button></div></div>`;

/* ---------------- resa ---------------- */
function tripDlg(t) {
  const b = openDlg(`<h2>${t ? 'Ändra resa' : 'Ny resa'}</h2><form id="f">
    <label for="tt">Namn</label><input id="tt" required value="${esc(t ? t.data.title : '')}" placeholder="t.ex. Rivieran 2027">
    <label for="ta">Länk till fotoalbum (valfritt)</label><input id="ta" type="url" value="${esc(t ? t.data.album || '' : '')}" placeholder="Delad länk från Google Foto eller iCloud">
    <div class="row end" style="margin-top:16px">${t ? '<button type="button" id="del">Ta bort</button>' : ''}<button type="button" data-close>Avbryt</button><button class="pri">Spara</button></div></form>`);
  $('#f', b).onsubmit = async e => {
    e.preventDefault(); const title = $('#tt').value.trim(); if (!title) return;
    const d = await saveDoc('trip', { title, album: $('#ta').value.trim(), created: t ? t.data.created : new Date().toISOString() }, t && t.id);
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
    <div class="row"><button class="pri" id="play" style="flex:1">Spela upp resan</button><button id="rec" style="flex:1">Spara som video</button></div>
    <div class="row" style="margin-top:8px"><span class="small mute">Fart</span><div class="seg" id="speed" style="flex:1"><button data-s="0.6">Lugn</button><button data-s="1" class="on">Normal</button><button data-s="2">Snabb</button></div></div>
    <div class="legend">${Object.values(MODES).map(m => `<span><svg width="24" height="8" aria-hidden="true"><line x1="2" y1="4" x2="22" y2="4" stroke="${m.c}" stroke-width="${m.w}" stroke-linecap="round" ${m.d === 'dash' ? 'stroke-dasharray="7 4"' : m.d === 'dot' ? 'stroke-dasharray="0.1 7"' : ''}/></svg>${m.n}</span>`).join('')}</div>
    <p class="small mute">${L.length} etapper · ${nf(L.reduce((s, l) => s + l.km, 0))} km${L.some(l => !l.routed && ['car', 'bike', 'rail'].includes(l.m.r)) ? ' · vissa rutter räknas ut när du är uppkopplad' : ''}</p>
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
  let html = `<div class="pad"><div class="spread"><p class="small mute" style="margin:0">${st.length} platser · ${L.length} etapper</p><button class="pri sm" id="add">+ Ny plats</button></div>`;
  if (!st.length) html += `<div class="empty">Börja med platsen ni reste från, till exempel hemorten.</div>`;
  let lastDay = null;
  st.forEach((s, i) => {
    const day = s.data.date || '';
    if (day !== lastDay) { html += `<div class="day">${day ? esc(fmtD(day)) : 'Utan datum'}</div>`; lastDay = day; }
    const l = byStop.get(s.id), m = MODES[s.data.mode] || MODES.bil;
    const via = (s.data.via || []).map(v => v.name).join(', ');
    html += `<button class="leg" data-s="${s.id}"><div class="bar" style="background:${i ? m.c : '#13242e'}"></div>
      <div><div class="t">${i ? `${esc(st[i - 1].data.name)} → ` : ''}${esc(s.data.name)} ${flag(s.data.cc)}</div>
      <div class="s">${i ? esc(m.n) : 'Start'}${l ? ' · ' + nf(l.km) + ' km' : ''}${via ? ` · <span class="via">mellanlandning ${esc(via)}</span>` : ''}${!hasPos(s) ? ' · <b>saknar position</b>' : ''}</div></div>
      <div>${whoBadge(s.data.travelers)}</div></button>`;
  });
  main.innerHTML = html + '</div>';
  $('#add').onclick = () => stopDlg(t, null);
  main.querySelectorAll('[data-s]').forEach(b => b.onclick = () => stopDlg(t, S.docs.get(b.dataset.s)));
}
function stopDlg(t, s) {
  const st = stopsOf(t.id), isFirst = s ? st[0] && st[0].id === s.id : !st.length;
  const last = st[st.length - 1];
  const D = s ? JSON.parse(JSON.stringify(s.data)) : { trip: t.id, name: '', date: last ? last.data.date : today(), mode: 'bil', travelers: [], via: [], seq: (last ? (last.data.seq || 0) : 0) + 1 };
  if (!D.via) D.via = []; if (!D.travelers) D.travelers = [];
  const b = openDlg(`<h2>${s ? 'Ändra plats' : isFirst ? 'Startplats' : 'Ny plats'}</h2>
    <label>Plats</label><div id="sb"></div><div id="picked" class="note"${D.lat != null ? '' : ' hidden'}></div>
    ${isFirst ? '' : `<label>Färdmedel hit</label><div class="chips" id="modes">${Object.entries(MODES).map(([k, m]) => `<button type="button" class="chip" data-m="${k}">${m.n}</button>`).join('')}</div>
    <div id="viabox" hidden><label>Mellanlandningar</label><div id="vias"></div><div id="vsb" style="margin-top:6px"></div><p class="small mute" style="margin:4px 0 0">Räknas inte som besökt land.</p></div>`}
    <label>Vem reste?</label><div class="seg" id="who"><button type="button" data-w="all">${S.members.length > 2 ? 'Alla' : 'Båda'}</button>${S.members.map(m => `<button type="button" data-w="${m.user_id}">${esc(m.name)}</button>`).join('')}</div>
    <label for="sd">Datum</label><input id="sd" type="date" value="${esc(D.date || '')}">
    <div class="row end" style="margin-top:16px">${s ? '<button type="button" id="up" class="sm">↑</button><button type="button" id="dn" class="sm">↓</button><button type="button" id="del">Ta bort</button>' : ''}<button type="button" data-close>Avbryt</button><button class="pri" id="ok">Spara</button></div>`);
  const showPicked = () => { const p = $('#picked'); p.hidden = D.lat == null; p.innerHTML = D.lat != null ? `${flag(D.cc)} <b>${esc(D.name)}</b> ${D.sub ? '· ' + esc(D.sub) : ''}` : ''; };
  const inp = searchBox($('#sb'), p => { Object.assign(D, { name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, cc: p.cc }); showPicked(); });
  inp.value = D.name || ''; showPicked();
  const renderModes = () => { if (!$('#modes')) return; $('#modes').querySelectorAll('[data-m]').forEach(x => { const on = x.dataset.m === D.mode; x.classList.toggle('on', on); x.style.background = on ? MODES[x.dataset.m].c : ''; x.style.borderColor = on ? MODES[x.dataset.m].c : ''; }); $('#viabox').hidden = D.mode !== 'flyg'; };
  const renderVias = () => { if (!$('#vias')) return; $('#vias').innerHTML = D.via.map((v, i) => `<div class="spread" style="padding:4px 0"><span>${flag(v.cc)} ${esc(v.name)}</span><button type="button" class="sm" data-rv="${i}" aria-label="Ta bort">✕</button></div>`).join(''); };
  const renderWho = () => $('#who').querySelectorAll('[data-w]').forEach(x => x.classList.toggle('on', x.dataset.w === 'all' ? isAll(D.travelers) : !isAll(D.travelers) && D.travelers.includes(x.dataset.w)));
  if ($('#modes')) {
    $('#modes').onclick = e => { const x = e.target.closest('[data-m]'); if (x) { D.mode = x.dataset.m; renderModes(); } };
    $('#vias').onclick = e => { const x = e.target.closest('[data-rv]'); if (x) { D.via.splice(+x.dataset.rv, 1); renderVias(); } };
    const vin = searchBox($('#vsb'), p => { D.via.push({ name: p.name, lat: p.lat, lon: p.lon, cc: p.cc }); vin.value = ''; renderVias(); }, '+ Lägg till mellanlandning (sök flygplats)');
    renderModes(); renderVias();
  }
  $('#who').onclick = e => { const x = e.target.closest('[data-w]'); if (!x) return; D.travelers = x.dataset.w === 'all' ? [] : [x.dataset.w]; renderWho(); };
  renderWho();
  $('#ok').onclick = async () => {
    const typed = inp.value.trim();
    if (!typed) { toast('Skriv eller sök en plats'); return; }
    D.name = typed;
    D.date = $('#sd').value; if (isFirst) D.mode = '';
    if (D.mode !== 'flyg') D.via = [];
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
function visited() {
  const C = new Map(), V = new Map();
  for (const t of trips()) for (const s of stopsOf(t.id)) {
    if (s.data.cc) {
      if (!C.has(s.data.cc)) C.set(s.data.cc, { all: false, ids: new Set() });
      const v = C.get(s.data.cc);
      if (isAll(s.data.travelers)) v.all = true; else s.data.travelers.forEach(id => v.ids.add(id));
    }
    for (const x of s.data.via || []) if (x.cc) V.set(x.cc, (V.get(x.cc) || 0) + 1);
  }
  const has = (v, id) => v.all || v.ids.has(id);
  const cat = cc => {
    const v = C.get(cc); if (!v) return V.has(cc) ? 'M' : null;
    if (v.all || (S.members.length > 1 && S.members.every(m => v.ids.has(m.user_id)))) return 'B';
    const idx = S.members.findIndex(m => v.ids.has(m.user_id));
    return v.ids.size === 1 && idx >= 0 ? 'm' + idx : 'B';
  };
  return { C, V, cat, has };
}
const catColor = c => c === 'B' ? BOTH_COLOR : c === 'M' ? '#ffffff' : c ? MEMBER_COLORS[+c.slice(1) % MEMBER_COLORS.length] : null;

let wmap, wReady = false, countries = null, wHolder;
async function loadCountries() {
  if (countries) return countries;
  const r = await fetch(COUNTRIES_URL); const j = await r.json();
  j.features.forEach(f => { const p = f.properties; f.properties = { cc: (p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2) || '', name: p.NAME }; });
  return countries = j;
}
function viewVarlden(main) {
  const { C, V, cat, has } = visited();
  const per = S.members.map((m, i) => ({ m, i, n: [...C.values()].filter(v => has(v, m.user_id)).length }));
  const both = [...C.keys()].filter(cc => cat(cc) === 'B').length;
  const groups = [['B', S.members.length > 2 ? 'Alla' : 'Båda']].concat(S.members.map((m, i) => ['m' + i, 'Bara ' + m.name])).concat([['M', 'Bara mellanlandning']]);
  const allCc = new Set([...C.keys(), ...V.keys()]);
  const byCat = k => [...allCc].filter(cc => cat(cc) === k).sort((a, b) => cName(a).localeCompare(cName(b), 'sv'));
  main.innerHTML = `<div class="pad">
    <div class="kpis"><div class="kpi" style="background:${BOTH_COLOR}"><b>${both}</b><span>Tillsammans</span></div>${per.slice(0, 2).map(p => `<div class="kpi" style="background:${MEMBER_COLORS[p.i]}"><b>${p.n}</b><span>${esc(p.m.name)} totalt</span></div>`).join('')}</div>
    <div id="wmapbox" style="margin-top:12px"><div id="wmap"></div></div><p class="small mute" style="margin:6px 0 0">Punkterna är platserna ni varit på, i samma färger som länderna. Tryck på en punkt för namn och resa.</p>
    <div style="margin-top:12px">${groups.map(([k, label]) => { const l = byCat(k); return l.length ? `<div class="cl"><i style="background:${catColor(k)};${k === 'M' ? 'border:2px dashed #6b7a80' : ''}"></i><span><b>${esc(label)} (${l.length}):</b> ${l.map(cc => `${flag(cc)} ${esc(cName(cc))}`).join(', ')}</span></div>` : ''; }).join('') || '<div class="empty">Lägg till platser i en resa så färgas länderna här.</div>'}</div></div>`;
  if (!window.maplibregl) { $('#wmapbox').innerHTML = '<div class="mapmsg">Kartan behöver nät första gången.</div>'; return; }
  if (wmap) { try { wmap.remove(); } catch (e) {} wmap = null; wReady = false; }
  {
    wHolder = $('#wmap');
    wmap = new maplibregl.Map({ container: wHolder, style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#bfe3ee' } }] }, center: [15, 35], zoom: 0.6, attributionControl: false, renderWorldCopies: false });
    wmap.on('load', async () => {
      try { await loadCountries(); } catch (e) { $('#wmapbox').insertAdjacentHTML('beforeend', '<div class="mapmsg">Världskartan behöver nät första gången.</div>'); return; }
      wmap.addSource('c', { type: 'geojson', data: countries });
      wmap.addLayer({ id: 'cf', type: 'fill', source: 'c', paint: { 'fill-color': ['coalesce', ['get', 'col'], '#f4f1e6'], 'fill-opacity': 0.92 } });
      wmap.addLayer({ id: 'cl', type: 'line', source: 'c', paint: { 'line-color': ['case', ['==', ['get', 'cat'], 'M'], '#6b7a80', '#a8551b'], 'line-width': ['case', ['==', ['get', 'cat'], 'M'], 1.6, 0.4] } });
      wmap.addSource('pl', { type: 'geojson', data: fc([]) });
      wmap.addLayer({ id: 'plc', type: 'circle', source: 'pl', paint: {
        'circle-color': ['get', 'col'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, ['case', ['get', 'via'], 2, 3], 4, ['case', ['get', 'via'], 3.5, 6], 8, ['case', ['get', 'via'], 5, 9]],
        'circle-stroke-color': ['case', ['get', 'via'], '#6b7a80', '#ffffff'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 2] } });
      wReady = true; paintWorld();
      wmap.on('click', 'plc', e => { const p = e.features[0].properties; new maplibregl.Popup({ closeButton: false }).setLngLat(e.features[0].geometry.coordinates).setHTML(`<b>${esc(p.name)}</b><br><span style="font-size:12px">${esc(p.info)}</span>`).addTo(wmap); });
      wmap.on('mouseenter', 'plc', () => wmap.getCanvas().style.cursor = 'pointer');
      wmap.on('mouseleave', 'plc', () => wmap.getCanvas().style.cursor = '');
      wmap.on('click', 'cf', e => { if (wmap.queryRenderedFeatures(e.point, { layers: ['plc'] }).length) return; const p = e.features[0].properties; new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`<b>${flag(p.cc)} ${esc(cName(p.cc) || p.name)}</b>`).addTo(wmap); });
    });
  }
}
function paintWorld() {
  if (!wReady || !countries) return;
  const { cat } = visited();
  countries.features.forEach(f => { const c = cat(f.properties.cc); f.properties.cat = c || ''; f.properties.col = c ? (c === 'M' ? '#ffffff' : catColor(c)) : null; });
  wmap.getSource('c').setData(countries);
  if (wmap.getSource('pl')) wmap.getSource('pl').setData(fc(placePoints()));
}
function placePoints() {
  const P = new Map(), key = (lat, lon) => lat.toFixed(2) + ',' + lon.toFixed(2);
  const add = (name, lat, lon, via, tr, trip) => {
    const k = key(lat, lon);
    if (!P.has(k)) P.set(k, { name, lat, lon, all: false, ids: new Set(), visited: false, trips: new Set() });
    const p = P.get(k); p.trips.add(trip);
    if (via) return;
    p.visited = true; p.name = name;
    if (isAll(tr)) p.all = true; else tr.forEach(id => p.ids.add(id));
  };
  for (const t of trips()) for (const s of stopsOf(t.id)) {
    if (hasPos(s)) add(s.data.name, s.data.lat, s.data.lon, false, s.data.travelers || [], t.data.title);
    for (const v of s.data.via || []) if (v.lat != null) add(v.name, v.lat, v.lon, true, [], t.data.title);
  }
  return [...P.values()].map(p => {
    let cat = 'M';
    if (p.visited) { const idx = S.members.findIndex(m => p.ids.has(m.user_id)); cat = p.all || (S.members.length > 1 && S.members.every(m => p.ids.has(m.user_id))) || idx < 0 || p.ids.size > 1 ? 'B' : 'm' + idx; }
    const who = cat === 'B' ? (S.members.length > 2 ? 'Alla' : 'Båda') : cat === 'M' ? 'Mellanlandning' : memberName(S.members[+cat.slice(1)].user_id);
    return { type: 'Feature', properties: { name: p.name, via: cat === 'M', col: cat === 'M' ? '#ffffff' : catColor(cat), info: who + ' · ' + [...p.trips].join(', ') }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } };
  });
}

function viewTopp(main) {
  const years = [...new Set(ofKind('stop').map(s => (s.data.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const yr = viewTopp.year || '';
  const inYear = s => !yr || (s.data.date || '').startsWith(yr);
  const all = trips().flatMap(t => legs(t).map(l => ({ ...l, t }))).filter(l => inYear(l.b));
  const perMode = {}; all.forEach(l => perMode[l.mode] = (perMode[l.mode] || 0) + l.km);
  const maxMode = Math.max(1, ...Object.values(perMode));
  const mem = S.members.map(m => {
    const ls = all.filter(l => travelersOf(l.tr).includes(m.user_id));
    const cs = new Set(); const days = new Set();
    trips().forEach(t => stopsOf(t.id).filter(inYear).forEach(s => { if (travelersOf(s.data.travelers).includes(m.user_id)) { if (s.data.cc) cs.add(s.data.cc); if (s.data.date) days.add(s.data.date); } }));
    trips().forEach(t => { const ds = stopsOf(t.id).filter(s => inYear(s) && s.data.date && travelersOf(s.data.travelers).includes(m.user_id)).map(s => s.data.date).sort(); if (ds.length > 1) for (let d = new Date(ds[0]); d <= new Date(ds[ds.length - 1]); d.setDate(d.getDate() + 1)) days.add(d.toISOString().slice(0, 10)); });
    return { m, km: ls.reduce((s, l) => s + l.km, 0), countries: cs.size, days: days.size, trips: new Set(ls.map(l => l.t.id)).size };
  });
  const longest = [...all].sort((a, b) => b.km - a.km).slice(0, 5);
  const viaC = {}; all.forEach(l => l.via.forEach(v => viaC[v.name] = (viaC[v.name] || 0) + 1));
  const vias = Object.entries(viaC).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const placeC = {}; trips().forEach(t => new Set(stopsOf(t.id).filter(inYear).map(s => s.data.name)).forEach(n => placeC[n] = (placeC[n] || 0) + 1));
  const places = Object.entries(placeC).filter(p => p[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
  main.innerHTML = `<div class="pad">
    <div class="seg" id="yrs" style="margin-bottom:12px"><button data-y="" class="${yr ? '' : 'on'}">Alla år</button>${years.slice(0, 4).map(y => `<button data-y="${y}" class="${yr === y ? 'on' : ''}">${y}</button>`).join('')}</div>
    <section class="card"><h3>${S.members.map(m => esc(m.name)).join(' mot ')}</h3><div class="tbl" style="grid-template-columns:minmax(0,1fr) ${S.members.map(() => '76px').join(' ')};margin-top:8px">
      <span></span>${mem.map(x => `<span class="num" style="font-weight:800;color:${memberColor(x.m.user_id)}">${esc(x.m.name)}</span>`).join('')}
      <span>Länder</span>${mem.map(x => `<span class="num">${x.countries}</span>`).join('')}
      <span>Resdagar</span>${mem.map(x => `<span class="num">${x.days}</span>`).join('')}
      <span>Resor</span>${mem.map(x => `<span class="num">${x.trips}</span>`).join('')}
      <span>Kilometer</span>${mem.map(x => `<span class="num">${nf(x.km)}</span>`).join('')}</div></section>
    <section class="card bars"><h3>Kilometer per färdmedel</h3>${Object.entries(perMode).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="r"><span>${MODES[k] ? MODES[k].n : k}</span><i style="width:${Math.max(2, v / maxMode * 100)}%;background:${(MODES[k] || MODES.bil).c}"></i><span class="num">${nf(v)} km</span></div>`).join('') || '<p class="mute small">Inga etapper ännu.</p>'}</section>
    <section class="card"><h3>Längsta etapperna</h3>${longest.map((l, i) => `<div class="spread" style="padding:5px 0;font-size:14px"><span><b>${i + 1}.</b> ${esc(l.a.data.name)} → ${esc(l.b.data.name)} <span class="small mute">${esc(l.m.n)}${l.via.length ? ' via ' + esc(l.via.map(v => v.name).join(', ')) : ''}</span></span><span class="num">${nf(l.km)} km</span></div>`).join('') || '<p class="mute small">Inga etapper ännu.</p>'}</section>
    ${vias.length ? `<section class="card"><h3>Flest mellanlandningar</h3><p class="small mute" style="margin:2px 0 6px">Räknas inte som besökta länder</p>${vias.map(([n, c]) => `<div class="spread" style="font-size:14px;padding:3px 0"><span>${esc(n)}</span><span class="num">×${c}</span></div>`).join('')}</section>` : ''}
    ${places.length ? `<section class="card"><h3>Mest återbesökta platser</h3>${places.map(([n, c]) => `<div class="spread" style="font-size:14px;padding:3px 0"><span>${esc(n)}</span><span class="num">${c} resor</span></div>`).join('')}</section>` : ''}
  </div>`;
  $('#yrs').onclick = e => { const b = e.target.closest('[data-y]'); if (b) { viewTopp.year = b.dataset.y; render(); } };
}

/* ---------------- mer ---------------- */
function viewMer(main) {
  const me = S.members.find(m => m.user_id === S.user.id);
  main.innerHTML = `<div class="pad">
    <section class="card"><h3>Ditt namn</h3><div class="row" style="margin-top:8px"><input id="myname" value="${esc(me ? me.name : '')}" style="flex:1"><button id="savename">Spara</button></div></section>
    <section class="card"><h3>Vi som delar dagboken</h3>${S.members.map(m => `<div style="padding:4px 0"><span class="who" style="color:${memberColor(m.user_id)}">${esc(m.name)}</span></div>`).join('')}
      <p class="small mute">Den du vill dela med installerar appen, skapar ett konto och väljer <b>Gå med med kod</b> med koden:</p>
      <div class="row"><b style="font-size:24px;letter-spacing:3px">${esc(S.joinCode || '…')}</b><button class="sm" id="cp">Kopiera</button></div></section>
    <section class="card"><h3>Synk</h3><p class="small" style="margin:6px 0">${pendingCount()} ändringar väntar · ${S.lastSync ? 'senast ' + S.lastSync.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : 'inte synkad ännu'}${S.syncErr ? `<br><span style="color:#b00020">${esc(S.syncErr)}</span>` : ''}</p><button id="syncnow">Synka nu</button></section>
    <section class="card"><h3>Säkerhetskopia</h3><p class="small mute" style="margin:6px 0">All text och alla platser som en fil. Bilderna ligger kvar i molnet.</p><button id="exp">Ladda ner kopia</button></section>
    <button id="lo" style="width:100%">Logga ut</button>
    <p class="small mute" style="margin-top:16px">Karta © OpenFreeMap, OpenMapTiles, OpenStreetMap-bidragsgivare. Sökning: Photon. Rutter: FOSSGIS OSRM och BRouter.</p></div>`;
  $('#savename').onclick = async () => { const n = $('#myname').value.trim(); if (!n) return; const { error } = await sb.from('members').update({ name: n }).eq('group_id', S.group).eq('user_id', S.user.id); if (error) return toast(navigator.onLine ? error.message : 'Kräver nät'); await loadMembers(); toast('Sparat'); render(); };
  $('#cp').onclick = async () => { try { await navigator.clipboard.writeText(S.joinCode); toast('Koden är kopierad'); } catch (e) { toast(S.joinCode); } };
  $('#syncnow').onclick = async () => { await sync(); render(); };
  $('#exp').onclick = () => { const data = JSON.stringify({ exported: new Date().toISOString(), docs: [...S.docs.values()].filter(live).map(d => ({ id: d.id, kind: d.kind, data: d.data })) }, null, 1); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = `resdagboken-${today()}.json`; a.click(); };
  $('#lo').onclick = () => confirmDlg('Logga ut?', 'Ändringar som inte är synkade försvinner från den här telefonen.', 'Logga ut', logout);
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
