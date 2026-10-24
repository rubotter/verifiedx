(function (root) {
  'use strict';
  function createExecutor(deps) {
    const used = new Set();
    let busy = false;
    const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    async function verify(request, headers) {
      const unknown = message => ({ ok: false, status: 'unknown',
        message: message || '未能确认取关结果，可点击重新验证；不会重复发送取关请求。' });
      const url = new URL('/i/api/1.1/friendships/show.json', location.origin);
      url.searchParams.set('source_id', request.ownerId);
      url.searchParams.set('target_id', request.userId);
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(attempt === 0 ? 1000 : 3000);
        if (deps.owner() !== request.owner) return unknown('登录账号已改变，请返回原账号后重新验证。');
        const controller = new AbortController();
        let timer, response;
        try {
          response = await Promise.race([
            (async () => {
              const result = await deps.fetch(url.href, { method: 'GET', credentials: 'include',
                redirect: 'error', cache: 'no-store', headers, signal: controller.signal });
              let body;
              try { body = await result.json(); } catch { body = null; }
              return { status: result.status, body };
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => {
              controller.abort(); reject(new Error('查询超时'));
            }, 6000); })
          ]);
        } catch { continue; }
        finally { clearTimeout(timer); }
        if (deps.owner() !== request.owner) return unknown('登录账号已改变，请返回原账号后重新验证。');
        if ([401, 403, 429].includes(response.status)) return unknown(response.status === 429 ?
          'X 暂时限制了查询，请稍后重新验证。' : 'X 拒绝了查询或登录已失效，请刷新页面后重新验证。');
        const { source, target } = response.body?.relationship || {};
        // 核对关系方向和两端 ID，不能用对方是否关注本人推断取关结果。
        if (response.status < 200 || response.status >= 300 || response.body?.errors?.length ||
            source?.id_str !== request.ownerId || target?.id_str !== request.userId ||
            typeof source.following !== 'boolean' || source.following_requested === true) continue;
        if (!source.following || attempt === 2) return { ok: true, userId: request.userId,
          status: source.following ? 'following' : 'not_following', verifiedAt: Date.now() };
      }
      return unknown();
    }
    return async function execute(request) {
      const failed = message => ({ ok: false, status: 'failed', message });
      const unknown = () => ({ ok: false, status: 'unknown',
        message: '操作结果尚未确认，请在 X 核对后重新扫描；请勿直接重复操作。' });
      if (!request || !['follow', 'unfollow', 'verify_unfollow'].includes(request.action) ||
          !/^[A-Za-z0-9_]{1,15}$/.test(request.owner || '') || !/^\d{1,25}$/.test(request.ownerId || '') ||
          typeof request.userId !== 'string' || !/^\d{1,25}$/.test(request.userId) || request.userId === request.ownerId ||
          typeof request.requestId !== 'string' || request.requestId.length > 100 ||
          !Number.isFinite(request.issuedAt) || Date.now() - request.issuedAt < 0 || Date.now() - request.issuedAt > 5000) {
        return failed('操作参数无效或已过期，请刷新侧栏后重试。');
      }
      if (busy || used.has(request.requestId)) return failed('该操作已在处理中，请勿重复点击。');
      if (deps.owner() !== request.owner) return failed('登录账号已改变，请重新扫描当前账号。');
      const template = deps.template(request);
      if (!template?.headers?.get('authorization') || !template.headers.get('x-csrf-token')) {
        return failed('尚未取得当前账号的请求信息，请刷新本人的关注列表，加载后再试。');
      }
      const headers = new Headers();
      // 只沿用认证和客户端信息，不把列表专用的动态签名复制到写入接口。
      for (const key of ['authorization', 'x-csrf-token', 'x-twitter-auth-type', 'x-twitter-active-user', 'x-twitter-client-language']) {
        if (template.headers.has(key)) headers.set(key, template.headers.get(key));
      }
      headers.set('content-type', 'application/x-www-form-urlencoded');
      const controller = new AbortController();
      let timer;
      used.add(request.requestId);
      busy = true;
      try {
        if (request.action === 'verify_unfollow') return await verify(request, headers);
        const operation = request.action === 'follow' ? 'create' : 'destroy';
        const response = await Promise.race([
          (async () => {
            const result = await deps.fetch(`${location.origin}/i/api/1.1/friendships/${operation}.json`, {
              method: 'POST', credentials: 'include', redirect: 'error', headers,
              body: new URLSearchParams({ user_id: request.userId }).toString(), signal: controller.signal
            });
            let body;
            try { body = await result.json(); } catch { body = null; }
            return { status: result.status, body };
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(new Error('操作超时'));
          }, 12000); })
        ]);
        if (deps.owner() !== request.owner) return unknown();
        if (response.status === 429) return failed('X 暂时限制了关注操作，请稍后再试。');
        if ([401, 403].includes(response.status)) return failed('X 拒绝了操作或登录已失效。请刷新页面；仍失败时需在 X 操作。');
        const body = response.body;
        if (response.status < 200 || response.status >= 300 || body?.errors?.length || body?.id_str !== request.userId) return unknown();
        let status;
        if (request.action === 'follow' && body.following === true) status = 'following';
        else if (request.action === 'follow' && body.follow_request_sent === true) status = 'requested';
        else if (request.action === 'unfollow' && body.following === false && body.follow_request_sent !== true) status = 'not_following';
        if (!status) return unknown();
        return { ok: true, status, userId: request.userId };
      } catch { return unknown(); }
      finally { clearTimeout(timer); busy = false; }
    };
  }
  root.XFFFriendship = { createExecutor };
})(globalThis);
