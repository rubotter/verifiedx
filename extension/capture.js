(() => {
  'use strict';
  const C = globalThis.XFF;
  if (window.__xffCaptureInstalled) return;
  window.__xffCaptureInstalled = true;
  const SOURCE = 'x-follow-filter:v1';
  const CONTROL = 'x-follow-filter:control:v1';
  const templates = new Map();
  let job = null;

  function templateKey(ctx) { return `${ctx.owner}:${ctx.kind}:${ctx.targetId}`; }
  function requestTemplate(input, init) {
    try {
      const request = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), location.origin), init);
      if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return null;
      return { url: request.url, headers: new Headers(request.headers) };
    } catch { return null; }
  }
  function issue(ctx, message) {
    window.postMessage({ source: SOURCE, type: 'ISSUE', owner: ctx.owner,
      requestedAt: ctx.requestedAt, requestId: ctx.requestId, runId: ctx.runId, message }, location.origin);
  }

  function context(url) {
    const info = C.requestInfo(typeof url === 'string' ? url : url?.url || String(url));
    if (!info) return null;
    const route = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(following|followers))?\/?$/);
    if (!route || (info.kind !== 'profile' && route[2] !== info.kind)) return null;
    const candidate = route[1].toLowerCase();
    if (info.kind === 'profile' && info.username !== candidate) return null;
    const owner = C.currentOwner(document);
    if (owner && owner !== candidate) return null;
    return { ...info, owner: candidate, requestedAt: Date.now() };
  }

  async function identityStillMatches(ctx) {
    // 首屏请求可能早于侧栏渲染；等待个人资料入口出现后再核对账号。
    for (let i = 0; i < 40; i++) {
      if (ctx.kind === 'profile') {
        const routeOwner = location.pathname.split('/')[1]?.toLowerCase();
        if (routeOwner !== ctx.owner) return false;
      } else if (C.ownRoute(location.pathname, ctx.owner) !== ctx.kind) return false;
      const owner = C.currentOwner(document);
      if (owner) return owner === ctx.owner;
      await new Promise(resolve => setTimeout(resolve, 125));
    }
    return false;
  }

  async function publish(ctx, body, status, template = null, alive = () => true) {
    if (!ctx || !(await identityStillMatches(ctx))) return;
    if (!alive()) return;
    if (ctx.kind === 'profile') {
      const profile = status >= 200 && status < 300 && !body?.errors?.length ? C.normalizeUser(body?.data?.user?.result) : null;
      if (!profile || profile.username.toLowerCase() !== ctx.owner) {
        window.postMessage({ source: SOURCE, type: 'ISSUE', owner: ctx.owner,
          requestedAt: ctx.requestedAt, message: status === 429 ? 'X 暂时限制了账号资料加载，请稍后重新扫描。' :
            '无法核对本人账号资料，请刷新页面后重新扫描；若持续出现，可能需要适配 X 的页面更新。' }, location.origin);
        return;
      }
      window.postMessage({ source: SOURCE, type: 'PROFILE', profile: {
        owner: ctx.owner, id: profile.id, avatarUrl: profile.avatarUrl, requestedAt: ctx.requestedAt } }, location.origin);
      return;
    }
    const parsed = status >= 200 && status < 300 ? C.parseTimeline(body) : { ok: false };
    if (!parsed.ok) {
      issue(ctx, status === 429 ? 'X 暂时限制了加载，已停止请求，请稍后再试。' :
        status === 401 || status === 403 ? '登录或请求校验失败，已停止请求。请刷新 X 后重试；仍失败时需适配网页请求校验。' :
          status < 200 || status >= 300 ? `列表分页请求返回 HTTP ${status}，已停止采集并保留结果；当前数量不代表全部。请刷新后重试。` :
            `接口返回 HTTP ${status}，但列表结构未能识别，已保留结果；当前数量不代表全部，可能需要适配 X 的页面更新。`);
      return;
    }
    if (template) templates.set(templateKey(ctx), template);
    emitPage({ ...ctx, ...parsed, replayable: templates.has(templateKey(ctx)) });
  }

  function emitPage(page) {
    // 数字 ID 由后台持久化核对；页面跳转会清空此脚本，不能在这里再次等待资料响应。
    if (C.currentOwner(document) !== page.owner ||
        C.ownRoute(location.pathname, page.owner) !== page.kind) return;
    window.postMessage({ source: SOURCE, type: 'PAGE', page }, location.origin);
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const ctx = context(args[0]);
    const template = ctx && ctx.kind !== 'profile' ? requestTemplate(args[0], args[1]) : null;
    const pending = originalFetch.apply(this, args);
    if (ctx) {
      pending.then(response => response.clone().json().then(body => publish(ctx, body, response.status, template))
        .catch(() => publish(ctx, null, response.status))).catch(() => {});
    }
    return pending;
  };

  const requests = new WeakMap();
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    requests.set(this, { url, method, headers: new Headers() });
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const result = setRequestHeader.call(this, name, value);
    requests.get(this)?.headers.append(name, value);
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const request = requests.get(this);
    const ctx = context(request?.url);
    const template = ctx && ctx.kind !== 'profile' ? requestTemplate(request.url, request) : null;
    if (ctx) this.addEventListener('load', () => {
      try {
        const body = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
        void publish(ctx, body, this.status, template).catch(() => {});
      } catch { void publish(ctx, null, this.status).catch(() => {}); }
    }, { once: true });
    return send.apply(this, args);
  };

  function cancel() {
    if (job) { job.cancelled = true; job.controller.abort(); job = null; }
  }
  async function requestPage(request) {
    if (job || !request || typeof request.requestId !== 'string' || typeof request.runId !== 'string' ||
        !Number.isFinite(request.issuedAt) || Date.now() - request.issuedAt < 0 || Date.now() - request.issuedAt > 5000 ||
        C.currentOwner(document) !== request.owner || C.ownRoute(location.pathname, request.owner) !== request.kind ||
        !(request.cursor === null || typeof request.cursor === 'string')) return;
    const template = templates.get(templateKey(request));
    if (!template) return;
    const url = new URL(template.url);
    const info = C.requestInfo(url.href);
    if (url.origin !== location.origin || info?.targetId !== request.targetId || info.kind !== request.kind) return;
    const variables = JSON.parse(url.searchParams.get('variables'));
    if (request.cursor) variables.cursor = request.cursor; else delete variables.cursor;
    url.searchParams.set('variables', JSON.stringify(variables));
    const current = { controller: new AbortController(), cancelled: false, request };
    job = current;
    const ctx = { ...request, requestedAt: Date.now() };
    const samePage = () => C.currentOwner(document) === request.owner &&
      C.ownRoute(location.pathname, request.owner) === request.kind;
    const alive = () => !current.cancelled && !current.controller.signal.aborted && samePage();
    const timeout = setTimeout(() => {
      current.timedOut = true;
      current.controller.abort();
      if (!current.cancelled && samePage()) issue(ctx, '分页请求超时，已停止采集。请检查网络后重试。');
    }, 15000);
    try {
      // 请求头只保存在此闭包内；Cookie 由浏览器附带，不发送到扩展后台。
      const response = await originalFetch.call(window, url.href, { method: 'GET', headers: template.headers,
        credentials: 'include', redirect: 'error', cache: 'no-store', signal: current.controller.signal });
      let body;
      try { body = await response.clone().json(); } catch { body = null; }
      if (alive()) await publish(ctx, body, response.status, null, alive);
    } catch {
      if (!current.cancelled && !current.timedOut && samePage()) issue(ctx, '分页请求失败，已停止采集。请检查网络或刷新 X 后重试。');
    } finally {
      clearTimeout(timeout);
      if (job === current) job = null;
    }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== CONTROL) return;
    if (event.data.type === 'CANCEL_REQUEST') cancel();
    else if (event.data.type === 'REQUEST_PAGE') void requestPage(event.data.request);
  });
  window.addEventListener('pagehide', () => { cancel(); templates.clear(); });
})();
