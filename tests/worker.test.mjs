import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac, randomUUID} from 'node:crypto';
import worker from '../backend/worker.mjs';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../backend/schema.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(query) {
      const prepare = values => ({
        bind(...args) { return prepare(args); },
        async first() { return sqlite.prepare(query).get(...values) || null; },
        async all() { return {results: sqlite.prepare(query).all(...values)}; },
        async run() { return {meta: sqlite.prepare(query).run(...values)}; }
      });
      return prepare([]);
    },
    async batch(statements) { const output = []; for (const statement of statements) output.push(await statement.run()); return output; }
  };
}
function fixture() {
  const DB = database(), origin = 'https://tianruili.pages.dev';
  const env = {DB, ADMIN_SECRET: 'local-test-secret-not-used-in-production', ASSETS: {fetch: async request => new Response('static: ' + new URL(request.url).pathname)}};
  const call = (path, {method = 'GET', body, cookie, ip = '203.0.113.1', requestOrigin = origin, headers = {}} = {}) => worker.fetch(new Request(origin + path, {
    method, headers: {'Origin': requestOrigin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(cookie ? {Cookie: cookie} : {}), ...headers},
    ...(body !== undefined ? {body: JSON.stringify(body)} : {})
  }), env);
  const password = 'correct-horse-private-inbox';
  const token = createHmac('sha256', env.ADMIN_SECRET).update('setup:tianruili:v1').digest('base64url');
  async function setup() {
    const response = await call('/api/admin/setup', {method: 'POST', body: {password, token}});
    assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
  }
  return {DB, env, call, setup, password, token};
}
test('message delivery persists plain text and retries cannot duplicate it', async () => {
  const f = fixture(), id = randomUUID(), text = '<img src=x onerror=alert(1)>\n这是一封真实来信。';
  const payload = {id, message: text, contact: 'me@example.com'};
  assert.equal((await f.call('/api/messages', {method: 'POST', body: payload})).status, 201);
  assert.equal((await f.call('/api/messages', {method: 'POST', body: payload})).status, 200);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT message FROM messages').get().message, text);
  assert.equal((await f.call('/api/admin/messages')).status, 401);
  assert.equal((await f.call('/api/messages')).status, 404);
});
test('invalid and cross-site messages are rejected; honeypot never reaches inbox', async () => {
  const f = fixture(), payload = {id: randomUUID(), message: '你好'};
  for (const bad of [{...payload, message: ''}, {...payload, message: 'x'.repeat(4001)}, {...payload, contact: 'x'.repeat(201)}, {...payload, id: 'bad'}, {...payload, message: '\u0000'}]) {
    assert.equal((await f.call('/api/messages', {method: 'POST', body: bad})).status, 400);
  }
  assert.equal((await f.call('/api/messages', {method: 'POST', body: payload, requestOrigin: 'https://evil.example'})).status, 403);
  assert.equal((await f.call('/api/messages', {method: 'POST', body: {...payload, website: 'bot.example'}})).status, 200);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
  assert.equal((await f.call('/api/messages', {method: 'POST', body: payload, headers: {'Content-Length': '24001'}})).status, 413);
  const overflow = new Request('https://tianruili.pages.dev/api/messages', {method:'POST', headers:{Origin:'https://tianruili.pages.dev','Content-Type':'application/json'}, body:'x'.repeat(24001)});
  assert.equal((await worker.fetch(overflow, f.env)).status, 413);
});
test('setup is owner-token-only and one-time; sessions are private and revoked on logout', async () => {
  const f = fixture();
  assert.equal((await f.call('/api/admin/setup', {method:'POST', body:{password:f.password,token:'wrong'}})).status,403);
  const cookie = await f.setup();
  assert.equal((await f.call('/api/admin/setup', {method:'POST',body:{password:f.password,token:f.token}})).status,409);
  assert.equal((await f.call('/api/admin/login',{method:'POST',body:{password:'incorrect'}})).status,401);
  const login = await f.call('/api/admin/login',{method:'POST',body:{password:f.password}});
  assert.equal(login.status,200);
  for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/']) assert.ok(login.headers.get('set-cookie').includes(flag));
  assert.equal((await f.call('/api/admin/messages',{cookie})).status,200);
  assert.equal((await f.call('/api/admin/messages',{cookie:'__Host-ray_admin='+ 'a'.repeat(43)})).status,401);
  assert.equal((await f.call('/api/admin/logout',{method:'POST',body:{},cookie,requestOrigin:'https://evil.example'})).status,403);
  assert.equal((await f.call('/api/admin/logout',{method:'POST',body:{},cookie})).status,200);
  assert.equal((await f.call('/api/admin/messages',{cookie})).status,401);
  const stored = f.DB.sqlite.prepare('SELECT password_hash FROM admin_settings').get().password_hash;
  assert.notEqual(stored,f.password);
  assert.equal((await f.call('/api/admin/messages',{cookie:login.headers.get('set-cookie').split(';')[0],requestOrigin:'https://evil.example'})).headers.get('Access-Control-Allow-Origin'), null);
});
test('owner can read, archive, restore and paginate messages without losing them', async () => {
  const f = fixture(), cookie=await f.setup(), id=randomUUID();
  await f.call('/api/messages',{method:'POST',body:{id,message:'Hello'}});
  let inbox = await (await f.call('/api/admin/messages',{cookie})).json();
  assert.equal(inbox.counts.unread,1);
  for (const action of ['read','archive','restore','unread']) assert.equal((await f.call('/api/admin/messages/'+id,{method:'PATCH',body:{action},cookie})).status,200);
  inbox = await (await f.call('/api/admin/messages?filter=unread',{cookie})).json(); assert.equal(inbox.messages.length,1);
  await f.call('/api/admin/messages/'+id,{method:'PATCH',body:{action:'archive'},cookie});
  assert.equal((await (await f.call('/api/admin/messages',{cookie})).json()).messages.length,0);
  assert.equal((await (await f.call('/api/admin/messages?filter=archived',{cookie})).json()).messages.length,1);
  const insert=f.DB.sqlite.prepare('INSERT INTO messages(id,message,created_at) VALUES(?,?,?)');
  for(let i=0;i<61;i++) insert.run(randomUUID(),'letter '+i,1000);
  const first=await (await f.call('/api/admin/messages',{cookie})).json();
  const second=await (await f.call('/api/admin/messages?before='+encodeURIComponent(first.next),{cookie})).json();
  assert.equal(first.messages.length,50);assert.equal(second.messages.length,11);
  assert.equal(new Set([...first.messages,...second.messages].map(m=>m.id)).size,61);
});
test('rate limiting works without persisting raw addresses and source mirror is allowed',async()=>{
  const f=fixture();
  for(let i=0;i<3;i++) assert.equal((await f.call('/api/messages',{method:'POST',body:{id:randomUUID(),message:'Hi'}})).status,201);
  assert.equal((await f.call('/api/messages',{method:'POST',body:{id:randomUUID(),message:'Fourth'}})).status,429);
  for(const row of f.DB.sqlite.prepare('SELECT key FROM request_limits').all()) assert.ok(!row.key.includes('203.0.113.1'));
  const response=await f.call('/api/messages',{method:'POST',body:{id:randomUUID(),message:'Mirror'},ip:'203.0.113.2',requestOrigin:'https://tianrui-li-0.github.io'});
  assert.equal(response.status,201);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://tianrui-li-0.github.io');
});
test('normal site assets remain available while admin gets private cache and CSP headers',async()=>{
  const f=fixture();
  const site=await f.call('/site');assert.equal(await site.text(),'static: /site');
  const admin=await f.call('/admin/');assert.equal(admin.headers.get('Cache-Control'),'no-store');
  assert.ok(admin.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  assert.equal(admin.headers.get('Referrer-Policy'),'no-referrer');
  const unavailable=await worker.fetch(new Request('https://tianruili.pages.dev/api/messages'),{});assert.equal(unavailable.status,503);
});
