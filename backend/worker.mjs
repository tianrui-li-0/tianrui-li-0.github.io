const enc = new TextEncoder();
const SESSION_SECONDS = 90 * 24 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer'};
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), {status, headers: {...noStore, 'Content-Type': 'application/json; charset=utf-8', ...headers}}); }
function base64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function unbase64(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
function randomToken() { return base64(crypto.getRandomValues(new Uint8Array(32))); }
async function hash(text) { return base64(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return base64(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function cookieName(request) { return new URL(request.url).protocol === 'https:' ? '__Host-ray_admin' : 'ray_admin_dev'; }
function cookie(request, token, age = SESSION_SECONDS) {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function sessionToken(request) {
  const prefix = cookieName(request) + '=';
  return (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(prefix))?.slice(prefix.length) || '';
}
async function session(request, env) {
  const token = sessionToken(request);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const digest = await hash(token);
  return await env.DB.prepare('SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').bind(digest, Date.now()).first();
}
async function newSession(request, env) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)').bind(await hash(token), Date.now() + SESSION_SECONDS * 1000)
  ]);
  return json({ok: true}, 200, {'Set-Cookie': cookie(request, token)});
}
async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, '请使用网站上的留言表单。');
  if (Number(request.headers.get('Content-Length')) > 24000) throw new HttpError(413, '内容太长了，请缩短后再发送。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '缺少内容。');
  let total = 0; const chunks = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    total += value.length;
    if (total > 24000) { await reader.cancel(); throw new HttpError(413, '内容太长了，请缩短后再发送。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch { throw new HttpError(400, '内容格式不正确。'); }
}
function allowedOrigin(request, publicMessage = false) {
  const origin = request.headers.get('Origin');
  return origin === new URL(request.url).origin || (publicMessage && origin === 'https://tianrui-li-0.github.io');
}
async function limit(request, env, purpose, max, seconds) {
  const now = Date.now(), window = Math.floor(now / (seconds * 1000));
  const address = request.headers.get('CF-Connecting-IP') || 'local';
  // Persist only a keyed, rotating digest, never visitors' raw IP addresses.
  const key = await hmac(env.ADMIN_SECRET, `${purpose}:${window}:${address}`);
  const row = await env.DB.prepare('INSERT INTO request_limits(key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = hits + 1 RETURNING hits')
    .bind(key, (window + 2) * seconds * 1000).first();
  await env.DB.prepare('DELETE FROM request_limits WHERE expires_at < ?').bind(now).run();
  if (row.hits > max) throw new HttpError(429, '操作有点频繁，请稍后再试。');
}
function cleanText(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `内容不能超过 ${max} 个字符。`);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (required && !text) throw new HttpError(400, '请先写下留言。');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new HttpError(400, '内容包含无法识别的字符。');
  return text;
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!env.DB || !env.ADMIN_SECRET) throw new HttpError(503, '收件箱暂时不可用，请稍后重试。');
  if (request.method !== 'GET' && !allowedOrigin(request, path === '/api/messages')) throw new HttpError(403, '请从本站页面进行操作。');

  if (path === '/api/messages' && request.method === 'POST') {
    const body = await readJson(request);
    if (body.website) return json({ok: true}); // Quietly discard automated honeypot submissions.
    if (typeof body.id !== 'string' || !UUID.test(body.id)) throw new HttpError(400, '请刷新页面后重新发送。');
    const message = cleanText(body.message, 4000, true), contact = cleanText(body.contact ?? '', 200);
    const exists = await env.DB.prepare('SELECT id FROM messages WHERE id = ?').bind(body.id).first();
    if (exists) return json({ok: true}); // A retry after a lost response must not create two messages.
    await limit(request, env, 'messages-minute', 3, 60);
    await limit(request, env, 'messages-hour', 10, 3600);
    await env.DB.prepare('INSERT INTO messages(id, message, contact, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(body.id, message, contact, Date.now()).run();
    return json({ok: true}, 201);
  }
  if (path === '/api/admin/session' && request.method === 'GET') {
    const active = await session(request, env);
    if (active && active.expires_at < Date.now() + 60 * 24 * 3600 * 1000) {
      await env.DB.prepare('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() + SESSION_SECONDS * 1000, active.token_hash).run();
      return json({authenticated: true}, 200, {'Set-Cookie': cookie(request, sessionToken(request))});
    }
    return json({authenticated: !!active});
  }
  if (path === '/api/admin/access' && request.method === 'POST') {
    await limit(request, env, 'owner-access', 8, 900);
    const body = await readJson(request);
    const expected = await hmac(env.ADMIN_SECRET, 'owner-access:tianruili:v1');
    if (!equal(body.key, expected)) throw new HttpError(403, '私人入口无效，请使用你保存的管理链接。');
    return newSession(request, env);
  }
  if (path === '/api/admin/logout' && request.method === 'POST') {
    const token = sessionToken(request);
    if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await hash(token)).run();
    return json({ok: true}, 200, {'Set-Cookie': cookie(request, '', 0)});
  }
  if (path.startsWith('/api/admin/')) {
    if (!(await session(request, env))) throw new HttpError(401, '请用你的私人管理链接打开收件箱。');
    if (path === '/api/admin/messages' && request.method === 'GET') {
      const filter = url.searchParams.get('filter') || 'inbox';
      const condition = filter === 'archived' ? 'archived_at IS NOT NULL' : filter === 'unread' ? 'archived_at IS NULL AND read_at IS NULL' : 'archived_at IS NULL';
      let tail = '', bindings = [];
      if (url.searchParams.has('before')) {
        try {
          const cursor = JSON.parse(new TextDecoder().decode(unbase64(url.searchParams.get('before'))));
          if (!Number.isSafeInteger(cursor.t) || !UUID.test(cursor.id)) throw new Error();
          tail = ' AND (created_at < ? OR (created_at = ? AND id < ?))'; bindings = [cursor.t, cursor.t, cursor.id];
        } catch { throw new HttpError(400, '翻页位置无效，请刷新。'); }
      }
      const result = await env.DB.prepare(`SELECT id, message, contact, created_at, read_at, archived_at FROM messages WHERE ${condition}${tail} ORDER BY created_at DESC, id DESC LIMIT 51`).bind(...bindings).all();
      const messages = result.results.slice(0, 50), last = messages.at(-1);
      const counts = await env.DB.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(archived_at IS NULL), 0) AS inbox, COALESCE(SUM(archived_at IS NULL AND read_at IS NULL), 0) AS unread, COALESCE(SUM(archived_at IS NOT NULL), 0) AS archived FROM messages').first();
      return json({messages, counts, next: result.results.length > 50 ? base64(enc.encode(JSON.stringify({t: last.created_at, id: last.id}))) : null});
    }
    const match = path.match(/^\/api\/admin\/messages\/([^/]+)$/);
    if (match && request.method === 'PATCH') {
      if (!UUID.test(match[1])) throw new HttpError(400, '留言编号无效。');
      const body = await readJson(request), actions = {read: ['read_at', Date.now()], unread: ['read_at', null], archive: ['archived_at', Date.now()], restore: ['archived_at', null]};
      const action = Object.hasOwn(actions, body.action) ? actions[body.action] : null;
      if (!action) throw new HttpError(400, '不支持这个操作。');
      const result = await env.DB.prepare(`UPDATE messages SET ${action[0]} = ? WHERE id = ?`).bind(action[1], match[1]).run();
      if (!result.meta.changes) throw new HttpError(404, '这条留言不存在。');
      return json({ok: true});
    }
  }
  throw new HttpError(404, '没有这个页面。');
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const publicMessage = url.pathname === '/api/messages';
      let response;
      try {
        if (request.method === 'OPTIONS') {
          if (!publicMessage || !allowedOrigin(request, true)) throw new HttpError(403, '不允许此来源。');
          response = new Response(null, {status: 204, headers: noStore});
        } else response = await route(request, env);
      } catch (error) {
        if (!(error instanceof HttpError)) console.error('Inbox request failed:', error.name);
        response = json({ok: false, error: error instanceof HttpError ? error.message : '暂时无法保存，请稍后重试。'}, error instanceof HttpError ? error.status : 503);
      }
      if (publicMessage && allowedOrigin(request, true)) {
        response.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'));
        response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
        response.headers.set('Vary', 'Origin');
      }
      return response;
    }
    const response = await env.ASSETS.fetch(request);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const protectedResponse = new Response(response.body, response);
      for (const [key, value] of Object.entries(noStore)) protectedResponse.headers.set(key, value);
      protectedResponse.headers.set('X-Frame-Options', 'DENY');
      protectedResponse.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      return protectedResponse;
    }
    return response;
  }
};
