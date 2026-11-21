(() => {
  if (location.hostname === 'tianrui-li-0.github.io') { location.replace('https://tianruili.pages.dev/admin/' + location.hash); return; }
  const $ = id => document.getElementById(id);
  function takeAccessKey() {
    const key = new URLSearchParams(location.hash.slice(1)).get('key');
    if (location.hash) history.replaceState(null, '', location.pathname);
    return key;
  }
  let accessKey = takeAccessKey();
  let filter = 'inbox', next = null, generation = 0;
  function notice(id, text, error = false) { $(id).textContent = text; $(id).dataset.error = String(error); }
  async function api(path, options = {}) {
    const response = await fetch('/api/admin/' + path, {credentials: 'same-origin', ...options, headers: {'Content-Type': 'application/json', ...options.headers}});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) { $('inbox').hidden = true; $('auth').hidden = false; notice('authStatus', '这台浏览器需要重新授权，请用你保存的私人管理链接打开。'); }
      throw new Error(body.error || '暂时无法连接，请稍后重试。');
    }
    return body;
  }
  function counts(data) {
    $('countInbox').textContent = data.inbox; $('countUnread').textContent = data.unread; $('countArchived').textContent = data.archived;
    $('summary').textContent = `共 ${data.total} 封来信，${data.unread} 封未读。`;
  }
  function make(tag, className, text) { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function letter(message) {
    const card = make('article', 'letter' + (message.read_at ? '' : ' unread'));
    const top = make('div', 'letter-top'), date = make('time', '', new Date(message.created_at).toLocaleString('zh-CN'));
    date.dateTime = new Date(message.created_at).toISOString(); top.append(date, make('span', 'badge', message.read_at ? '已读' : '未读'));
    card.append(top, make('p', 'letter-body', message.message));
    if (message.contact) { const contact = make('p', 'contact'); contact.append(make('b', '', '联系方式'), document.createTextNode(message.contact)); card.append(contact); }
    const actions = make('div', 'letter-actions');
    const specs = [[message.read_at ? 'unread' : 'read', message.read_at ? '标为未读' : '标为已读'], [message.archived_at ? 'restore' : 'archive', message.archived_at ? '移回收件箱' : '归档']];
    for (const [action, label] of specs) {
      const button = make('button', 'quiet', label); button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await api('messages/' + message.id, {method: 'PATCH', body: JSON.stringify({action})}); await load(); }
        catch (error) { notice('inboxStatus', error.message, true); button.disabled = false; }
      });
      actions.append(button);
    }
    if (message.contact) {
      const copy = make('button', 'quiet', '复制联系方式'); copy.type = 'button';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(message.contact); copy.textContent = '已复制'; } catch { notice('inboxStatus', '请选中上面的联系方式进行复制。'); } }); actions.append(copy);
    }
    card.append(actions); return card;
  }
  async function load(append = false) {
    const current = ++generation;
    $('refresh').disabled = true; $('more').disabled = true; notice('inboxStatus', '正在收取来信…');
    try {
      const query = new URLSearchParams({filter}); if (append && next) query.set('before', next);
      const data = await api('messages?' + query);
      if (current !== generation) return;
      if (!append) $('messages').replaceChildren();
      for (const message of data.messages) $('messages').append(letter(message));
      counts(data.counts); next = data.next; $('more').hidden = !next;
      $('empty').hidden = $('messages').children.length > 0;
      $('emptyTitle').textContent = filter === 'unread' ? '所有来信都读过了。' : filter === 'archived' ? '这里还没有归档的来信。' : '星空很安静。';
      $('emptyText').textContent = filter === 'inbox' ? '有人从网站发来留言，就会出现在这里。' : '切换到收件箱，看看其他来信。';
      notice('inboxStatus', `更新于 ${new Date().toLocaleTimeString('zh-CN')}`);
    } catch (error) { if (current === generation) notice('inboxStatus', error.message, true); }
    finally { if (current === generation) { $('refresh').disabled = false; $('more').disabled = false; } }
  }
  async function enter() {
    accessKey = null; $('auth').hidden = true; $('inbox').hidden = false;
    await load();
  }
  $('filters').addEventListener('click', event => {
    const target = event.target.closest('[data-filter]'); if (!target || target.dataset.filter === filter) return;
    filter = target.dataset.filter; next = null;
    for (const button of $('filters').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === target));
    load();
  });
  $('refresh').addEventListener('click', () => load()); $('more').addEventListener('click', () => load(true));
  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    try { await api('logout', {method: 'POST', body: '{}'}); location.reload(); }
    catch (error) { notice('inboxStatus', error.message, true); $('logout').disabled = false; }
  });
  async function start() {
    try {
      const state = await api('session');
      if (state.authenticated) { await enter(); return; }
      if (accessKey) {
        await api('access', {method: 'POST', body: JSON.stringify({key: accessKey})});
        await enter(); return;
      }
      $('authDescription').textContent = '这里仅对你的已授权浏览器开放。';
      notice('authStatus', '请用你保存的私人管理链接进入，无需输入密码。');
    } catch (error) { notice('authStatus', error.message + ' 请重新打开私人管理链接重试。', true); }
  }
  addEventListener('hashchange', () => {
    const key = takeAccessKey();
    if (!key) return;
    accessKey = key; start();
  });
  start();
})();
