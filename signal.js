(() => {
  const form = document.getElementById('sigForm');
  const message = document.getElementById('sigIn'), contact = document.getElementById('sigContact');
  const status = document.getElementById('sigOut'), submit = form.querySelector('button[type="submit"]');
  const endpoint = location.hostname === 'tianrui-li-0.github.io' ? 'https://tianruili.pages.dev/api/messages' : '/api/messages';
  let pending = null, sending = false;
  const draftKey = 'ray.private-message-draft';
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (draft) { if (!message.value) message.value = draft.message || ''; if (!contact.value) contact.value = draft.contact || ''; }
  } catch {}
  function saveDraft() {
    try { sessionStorage.setItem(draftKey, JSON.stringify({message: message.value, contact: contact.value})); } catch {}
  }
  form.addEventListener('input', saveDraft);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    const text = message.value.trim(), address = contact.value.trim();
    status.dataset.error = 'false';
    if (!text) { status.textContent = '先写下一句话，再发送。'; message.focus(); return; }
    if (location.protocol === 'file:') { status.textContent = '请打开 tianruili.pages.dev 发送留言。'; return; }
    const signature = JSON.stringify([text, address]);
    if (!pending || pending.signature !== signature) pending = {signature, id: crypto.randomUUID()};
    sending = true; submit.disabled = true; submit.textContent = '发送中';
    message.readOnly = true; contact.readOnly = true; status.textContent = '正在把这封信送出去…';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
        body: JSON.stringify({id: pending.id, message: text, contact: address, website: document.getElementById('sigWebsite').value})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '暂时没能确认送达，请稍后重试。');
      form.dispatchEvent(new CustomEvent('ray:message-sent', {detail: {message: text}}));
      message.value = ''; contact.value = ''; pending = null;
      try { sessionStorage.removeItem(draftKey); } catch {}
      status.textContent = '已收到，留言已经送进我的收件箱。谢谢你。';
    } catch (error) {
      saveDraft(); status.dataset.error = 'true';
      status.textContent = (error.name === 'AbortError' ? '网络有点慢，暂时无法确认送达。' : error.message === 'Failed to fetch' ? '网络连接失败。' : error.message) + ' 内容已保留，可以重试。';
    } finally {
      clearTimeout(timer); sending = false; submit.disabled = false; submit.textContent = '发送';
      message.readOnly = false; contact.readOnly = false;
    }
  });
  message.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
  });
})();
