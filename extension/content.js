(() => {
  'use strict';
  // 隔离世界独立核对身份，避免跨世界重复注入同一个脚本文件。
  function currentOwner() {
    const href = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    return href?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1].toLowerCase() || null;
  }
  function currentAvatar() {
    const owner = currentOwner();
    const selectors = [
      'div[data-testid="SideNav_AccountSwitcher_Button"] img',
      'a[data-testid="AppTabBar_Profile_Link"] img',
      owner ? `a[href="/${owner}"] img` : null,
      owner ? `a[href="/${owner}/photo"] img` : null,
      owner ? `div[data-testid="UserAvatar-Container-${owner}"] img` : null,
      'header nav img',
      'img[src*="pbs.twimg.com/profile_images/"]'
    ].filter(Boolean);
    for (const sel of selectors) {
      const img = document.querySelector(sel);
      const src = img?.getAttribute('src') || img?.src;
      if (typeof src === 'string' && /^https?:\/\//.test(src)) return src;
    }
    return null;
  }
  function ownRoute(owner) {
    const match = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/(following|followers)\/?$/i);
    return match && match[1].toLowerCase() === owner ? match[2].toLowerCase() : null;
  }
  let lastOwner = null;
  let ready = null;
  let generation = 0;
  let overlayRequest = null, blockedRunId = null;
  let bottomStuckCount = 0;
  const overlay = globalThis.XFFOverlay?.create({ onPause: pauseFromOverlay });
  const control = (type, extra = {}) => window.postMessage({ source: 'x-follow-filter:control:v1', type, ...extra }, location.origin);
  function cancelRequest() { generation++; bottomStuckCount = 0; control('CANCEL_REQUEST'); overlay?.hide(); overlayRequest = null; }
  let timer;
  const send = async message => { try { return await chrome.runtime.sendMessage(message); } catch {} };
  async function pauseFromOverlay() {
    const request = overlayRequest;
    if (!request || currentOwner() !== request.owner || ownRoute(request.owner) !== 'followers') { cancelRequest(); return; }
    // 先封锁该轮滚动，暂停通信失败也不能被下一次轮询自动恢复。
    blockedRunId = request.runId;
    cancelRequest();
    const pausedGeneration = generation;
    overlayRequest = request;
    overlay?.show({ owner: request.owner, pending: true });
    const result = await send({ type: 'SCROLL_PAUSE', owner: request.owner, targetId: request.targetId, runId: request.runId });
    if (result?.ok) { if (overlayRequest?.runId === request.runId) cancelRequest(); return; }
    if (generation === pausedGeneration && !document.hidden && currentOwner() === request.owner && ownRoute(request.owner) === 'followers') {
      overlay?.show({ owner: request.owner, error: '已停止滚动，暂停状态未确认。请重试或在侧栏暂停。' });
    }
  }
  let actionTemplate = null, friendshipBusy = false;
  // 隔离环境直接读取网络响应；页面消息不能调用此执行器或伪造执行结果。
  const executeFriendship = globalThis.XFFFriendship?.createExecutor({
    owner: currentOwner, template: () => actionTemplate, fetch: window.fetch.bind(window)
  });
  async function changeFriendship(request) {
    if (friendshipBusy || !executeFriendship || !request || currentOwner() !== request.owner || !ownRoute(request.owner)) {
      return { ok: false, status: 'failed', message: '请刷新本人的关注列表，等待加载完成后再试。' };
    }
    friendshipBusy = true;
    try {
      actionTemplate = { headers: new Headers(request.headers) };
      return await executeFriendship(request);
    } finally { actionTemplate = null; friendshipBusy = false; }
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'x-follow-filter:v1') return;
    const owner = currentOwner();
    if (!owner) return;
    checkIdentity();
    const message = event.data;
    if (message.type === 'PROFILE' && message.profile?.owner === owner &&
        location.pathname.split('/')[1]?.toLowerCase() === owner) {
      void send({ type: 'PROFILE', profile: message.profile });
    } else if (message.type === 'PAGE' && message.page?.owner === owner &&
        ownRoute(owner) === message.page.kind) {
      bottomStuckCount = 0;
      if (message.page.replayable || message.page.kind === 'followers') ready = { kind: message.page.kind, targetId: message.page.targetId };
      void send({ type: 'PAGE', page: message.page });
    } else if (message.type === 'ISSUE' && message.owner === owner &&
        (ownRoute(owner) || location.pathname.replace(/\/$/, '').toLowerCase() === `/${owner}`)) {
      void send({ type: 'ISSUE', owner, requestedAt: message.requestedAt, requestId: message.requestId,
        runId: message.runId, message: String(message.message).slice(0, 250) });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'FRIENDSHIP') {
      if (sender.id !== chrome.runtime.id || sender.tab) return;
      void changeFriendship(message.request).then(respond, () => respond({ ok: false, status: 'unknown' }));
      return true;
    }
    if (message.type === 'IDENTIFY') respond({ owner: currentOwner(), avatarUrl: currentAvatar(), pathname: location.pathname });
    if (message.type === 'CANCEL_REQUEST') { cancelRequest(); respond({ ok: true }); }
  });

  function checkIdentity() {
    const owner = currentOwner();
    if (overlayRequest && (owner !== overlayRequest.owner || ownRoute(owner) !== 'followers')) cancelRequest();
    // 页面过渡期间入口可能短暂消失，不把这个瞬间当作退出登录。
    if (owner && owner !== lastOwner) {
      ready = null;
      cancelRequest();
      lastOwner = owner;
      void send({ type: 'IDENTITY', owner, avatarUrl: currentAvatar() });
    }
  }
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(checkIdentity, 200);
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  checkIdentity();

  let closed = false;
  window.addEventListener('pagehide', () => { closed = true; cancelRequest(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelRequest(); });
  async function autoTick() {
    if (closed) return;
    const owner = currentOwner();
    const pathname = location.pathname;
    const before = generation;
    try {
      const atBottom = bottomStuckCount >= 2;
      const response = await send({ type: 'AUTO_TICK', owner, pathname, visible: !document.hidden, ready, atBottom, avatarUrl: currentAvatar() });
      // 回复到达时再次核对页面，防止等待后台期间用户已经切换账号或页面。
      if (!response?.ok || !response.data?.enabled) cancelRequest();
      if (overlayRequest && response?.data?.runId !== overlayRequest.runId) cancelRequest();
      if (response?.ok && response.data?.enabled && before === generation && !closed && !document.hidden &&
          owner === currentOwner() && pathname === location.pathname && ownRoute(owner)) {
        const { request, scroll, runId } = response.data;
        if (request?.kind === 'following' && ownRoute(owner) === 'following' && request.owner === owner &&
            ready?.kind === request.kind && ready.targetId === request.targetId && request.runId === runId &&
            Number.isFinite(request.issuedAt) && Date.now() - request.issuedAt >= 0 && Date.now() - request.issuedAt < 5000) {
          control('REQUEST_PAGE', { request });
        }
        // 滚动只接受后台本轮授权；页面消息、过期回复及粉丝请求重放均不能触发。
        if (scroll?.kind === 'followers' && ownRoute(owner) === 'followers' && scroll.owner === owner &&
            ready?.kind === 'followers' && scroll.targetId === ready.targetId && scroll.runId === runId &&
            Number.isFinite(scroll.issuedAt) && Date.now() - scroll.issuedAt >= 0 && Date.now() - scroll.issuedAt < 5000) {
          if (blockedRunId !== runId) {
            overlayRequest = scroll;
            overlay?.show({ owner });
            const beforeY = window.scrollY;
            const docEl = document.documentElement;
            const scrollHeight = Math.max(docEl?.scrollHeight || 0, document.body?.scrollHeight || 0);
            const clientHeight = window.innerHeight || docEl?.clientHeight || 0;
            window.scrollBy({ top: Math.max(1, Math.round(clientHeight * 0.8)), behavior: 'instant' });
            const afterY = window.scrollY;
            const atBottom = clientHeight + afterY >= scrollHeight - 30;
            const cannotScroll = afterY <= beforeY + 2;
            if (atBottom && cannotScroll) {
              bottomStuckCount++;
            } else if (afterY > beforeY + 2) {
              bottomStuckCount = 0;
            }
          }
        }
      }
      if (owner !== currentOwner() || pathname !== location.pathname) cancelRequest();
    } finally {
      // 临时通信失败只取消本轮请求，继续轮询以恢复连接或让后台处理超时。
      if (!closed) setTimeout(autoTick, 2000);
    }
  }
  setTimeout(autoTick, 2000);
})();
