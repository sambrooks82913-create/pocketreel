import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import fs from 'fs';
const { PORT = 3000, BASE_URL = 'http://localhost:3000', SESSION_SECRET = 'dev', GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const DB = 'db.json';
const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB)) : { users: {} };
const save = () => fs.writeFileSync(DB, JSON.stringify(db, null, 1));
const app = express();
app.use(express.json());
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { maxAge: 30 * 864e5 } }));
app.use(express.static('public'));
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const me = (req) => db.users[req.session.u];
const need = (req, res, next) => (me(req) ? next() : res.status(401).json({ error: 'Log in first' }));

// ---- accounts ----
app.post('/api/signup', (req, res) => {
  const { name, password } = req.body;
  if (!/^\w{3,20}$/.test(name || '') || (password || '').length < 8) return res.status(400).json({ error: 'Name: 3-20 letters/numbers. Password: 8+ characters.' });
  if (db.users[name]) return res.status(400).json({ error: 'Name taken' });
  const salt = crypto.randomBytes(16).toString('hex');
  db.users[name] = { salt, hash: hash(password, salt), links: {}, settings: { hidden: {}, autoplay: true, muted: true } };
  save(); req.session.u = name; res.json({ ok: 1 });
});
app.post('/api/login', (req, res) => {
  const u = db.users[req.body.name];
  if (!u || hash(req.body.password || '', u.salt) !== u.hash) return res.status(400).json({ error: 'Wrong name or password' });
  req.session.u = req.body.name; res.json({ ok: 1 });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: 1 })));
app.get('/api/me', need, (req, res) => {
  const u = me(req);
  res.json({ name: req.session.u, settings: u.settings, linked: Object.fromEntries(['youtube', 'smolish', 'tiktok', 'instagram'].map((p) => [p, !!u.links[p]])) });
});
app.post('/api/settings', need, (req, res) => { Object.assign(me(req).settings, req.body); save(); res.json({ ok: 1 }); });
app.post('/api/unlink/:p', need, (req, res) => { delete me(req).links[req.params.p]; save(); res.json({ ok: 1 }); });

// ---- YouTube (official OAuth) ----
app.get('/auth/youtube', need, (req, res) => {
  const q = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: BASE_URL + '/auth/youtube/callback', response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
});
app.get('/auth/youtube/callback', need, async (req, res) => {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code: req.query.code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: BASE_URL + '/auth/youtube/callback', grant_type: 'authorization_code' }) }).then((r) => r.json());
  if (r.access_token) { me(req).links.youtube = { access: r.access_token, refresh: r.refresh_token, exp: Date.now() + r.expires_in * 1e3 }; save(); }
  res.redirect('/');
});
async function ytToken(u) {
  const l = u.links.youtube;
  if (Date.now() > l.exp - 6e4) {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: l.refresh, grant_type: 'refresh_token' }) }).then((r) => r.json());
    l.access = r.access_token; l.exp = Date.now() + r.expires_in * 1e3; save();
  }
  return l.access;
}
const yt = async (u, path, opt = {}) => fetch('https://www.googleapis.com/youtube/v3/' + path, { ...opt, headers: { Authorization: 'Bearer ' + (await ytToken(u)), 'Content-Type': 'application/json' } }).then((r) => r.json());

// ---- Smolish (unofficial: uses the session cookie you paste in Settings) ----
const SMOL = 'https://smolish.com';
// UNVERIFIED: confirm these in Chrome DevTools > Network while liking/commenting on smolish.com, then edit.
const SMOL_LIKE = (id) => ({ path: `/api/videos/${id}/like`, method: 'POST' });
const SMOL_COMMENT = (id) => ({ path: `/api/videos/${id}/comments`, method: 'POST' });
app.post('/api/link/smolish', need, (req, res) => { me(req).links.smolish = { cookie: req.body.cookie }; save(); res.json({ ok: 1 }); });
const smol = (u, path, opt = {}) => fetch(SMOL + path, { ...opt, headers: { Cookie: u.links.smolish.cookie, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' } });

// ---- feed / like / comment ----
app.get('/api/feed', need, async (req, res) => {
  const u = me(req), q = (req.query.q || '').trim(), out = [], notes = [];
  const jobs = [];
  if (u.links.youtube && !u.settings.hidden.youtube) jobs.push((async () => {
    const p = new URLSearchParams({ part: 'snippet', type: 'video', videoDuration: 'short', maxResults: 15, q: q ? q + ' #shorts' : '#shorts' });
    const r = await yt(u, 'search?' + p);
    if (r.error) return notes.push('YouTube: ' + r.error.message);
    r.items.forEach((v) => out.push({ platform: 'youtube', id: v.id.videoId, title: v.snippet.title, author: v.snippet.channelTitle, embed: `https://www.youtube.com/embed/${v.id.videoId}?playsinline=1&loop=1&playlist=${v.id.videoId}&rel=0` }));
  })());
  if (u.links.smolish && !u.settings.hidden.smolish) jobs.push((async () => {
    const r = await smol(u, '/api/videos' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (!r.ok) return notes.push('Smolish: session expired or blocked (' + r.status + ')');
    const d = await r.json(), list = d.videos || d.items || d.data || (Array.isArray(d) ? d : []);
    list.forEach((v) => out.push({ platform: 'smolish', id: String(v.id), title: v.title || v.description || '', author: v.author?.username || v.username || '', src: `https://cdn.smolish.com/videos/${v.id}/1080p.mp4`, poster: `https://cdn.smolish.com/videos/${v.id}/thumb.jpg` }));
  })());
  await Promise.allSettled(jobs);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  res.json({ items: out, notes });
});
app.post('/api/like', need, async (req, res) => {
  const u = me(req), { platform, id } = req.body;
  if (platform === 'youtube') { const r = await fetch(`https://www.googleapis.com/youtube/v3/videos/rate?id=${id}&rating=like`, { method: 'POST', headers: { Authorization: 'Bearer ' + (await ytToken(u)) } }); return res.status(r.ok ? 200 : 400).json({ ok: r.ok }); }
  if (platform === 'smolish') { const { path, method } = SMOL_LIKE(id); const r = await smol(u, path, { method }); return res.status(r.ok ? 200 : 400).json({ ok: r.ok, error: r.ok ? '' : 'Smolish like failed: check SMOL_LIKE in server.js' }); }
  res.status(501).json({ error: platform + ' is not supported' });
});
app.post('/api/comment', need, async (req, res) => {
  const u = me(req), { platform, id, text } = req.body;
  if (platform === 'youtube') { const r = await yt(u, 'commentThreads?part=snippet', { method: 'POST', body: JSON.stringify({ snippet: { videoId: id, topLevelComment: { snippet: { textOriginal: text } } } }) }); return res.json({ ok: !r.error, error: r.error?.message }); }
  if (platform === 'smolish') { const { path, method } = SMOL_COMMENT(id); const r = await smol(u, path, { method, body: JSON.stringify({ text, content: text }) }); return res.status(r.ok ? 200 : 400).json({ ok: r.ok, error: r.ok ? '' : 'Smolish comment failed: check SMOL_COMMENT in server.js' }); }
  res.status(501).json({ error: platform + ' is not supported' });
});
app.listen(PORT, () => console.log('Pocketreel running at ' + BASE_URL));
