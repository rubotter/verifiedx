'use strict';
importScripts('core.js', 'auto.js', 'history.js');
const C = globalThis.XFF;
const A = globalThis.XFFAuto;
const H = globalThis.XFFHistory;
let queue = Promise.resolve();
let storageFailure = null;
const failureReady = chrome.storage.session.get('storageFailure').then(value => {
  storageFailure = value.storageFailure || null;
}).catch(() => {});
const actionCredentials = new Map();
const credentialHeaders = new Set(['authorization', 'x-csrf-token', 'x-twitter-auth-type', 'x-twitter-active-user', 'x-twitter-client-language']);
// 只观察本页列表请求的白名单头，Cookie 不读取；凭证不进入持久化会话。
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  const info = C.requestInfo(details.url);
  if (details.tabId < 0 || details.frameId !== 0 || !['following', 'followers'].includes(info?.kind)) return;
  const headers = (details.requestHeaders || []).filter(h => credentialHeaders.has(h.name.toLowerCase()) && typeof h.value === 'string')
    .map(h => [h.name.toLowerCase(), h.value]);
  if (headers.some(([name]) => name === 'authorization') && headers.some(([name]) => name === 'x-csrf-token')) {
    actionCredentials.set(details.tabId, { ownerId: info.targetId, origin: new URL(details.url).origin, headers });
  }
}, { urls: ['https://x.com/i/api/graphql/*', 'https://twitter.com/i/api/graphql/*'] }, ['requestHeaders', 'extraHeaders']);
let storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

function isX(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['x.com', 'twitter.com'].includes(u.hostname); }
  catch { return false; }
}
async function getState() {
  await failureReady;
  const state = (await chrome.storage.local.get('session')).session || null;
  return state && storageFailure ? A.stop({ ...state, active: false, issue: storageFailure }, 'error', storageFailure) : state;
}
async function clearStorageFailure() {
  storageFailure = null;
  await chrome.storage.session.remove('storageFailure').catch(() => {});
}
async function cancelRequest(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: 'CANCEL_REQUEST' }).catch(() => {});
}
function matchesPending(state, message) {
  return state.active && state.auto?.enabled && state.auto.pending &&
    state.auto.pending.requestId === message.requestId && state.auto.runId === message.runId;
}
async function save(state) {
  await failureReady;
  try {
    const key = state.targetId ? `history:${state.targetId}` : null;
    const previous = key ? (await chrome.storage.local.get(key))[key] : null;
    const recorded = H.record(state, previous);
    // 历史与快照一起保存，避免徽章显示成功而首次发现记录未落盘。
    await chrome.storage.local.set({ session: recorded.state, ...(recorded.history ? { [key]: recorded.history } : {}) });
    if (storageFailure) await clearStorageFailure();
    if (!state.active || !state.auto?.enabled) await cancelRequest(state.tabId);
  }
  catch {
    // 磁盘持续不可写时仍在内存中暂停；session 区保存停止标记以跨后台休眠恢复。
    storageFailure = '本地保存失败，采集已暂停。请先检查浏览器可用空间；清理本次结果或账号历史会删除对应数据。';
    await chrome.storage.session.set({ storageFailure }).catch(() => {});
    const previous = await getState();
    if (previous) await cancelRequest(previous.tabId);
    if (previous) await chrome.storage.local.set({ session: previous }).catch(() => {});
    void chrome.runtime.sendMessage({ type: 'STORAGE_FAILURE' }).catch(() => {});
    throw new Error(storageFailure);
  }
}
async function identify(tabId) {
  let identity;
  try { identity = await chrome.tabs.sendMessage(tabId, { type: 'IDENTIFY' }); }
  catch { throw new Error('请刷新 X 页面，等左侧个人资料入口出现后重试。'); }
  if (!identity?.owner) throw new Error('尚未识别登录账号。请先登录 X，打开个人资料页后重试。');
  return identity;
}

async function changeFriendship(state, message) {
  if (message.owner !== state.owner || message.startedAt !== state.startedAt || !state.targetId ||
      typeof message.userId !== 'string' || !/^\d{1,25}$/.test(message.userId) || (!state.lists.following.users[message.userId] && !state.lists.followers.users[message.userId]) ||
      message.userId === state.targetId || !['follow', 'unfollow', 'verify_unfollow'].includes(message.action)) {
    throw new Error('账号或扫描结果已变化，请刷新侧栏后重试。');
  }
  const previous = state.friendships?.[message.userId];
  const status = C.ownRelationship(state, message.userId).ownStatus;
  const verifyOnly = message.action === 'verify_unfollow';
  if (message.expectedStatus !== status || (verifyOnly ? !C.canVerifyFriendship(previous) :
      message.action === 'unfollow' ? status !== 'following' : status !== 'not_following')) {
    throw new Error('该账号状态已变化或尚待核对，请在 X 确认后重新扫描。');
  }
  const tab = await chrome.tabs.get(state.tabId);
  if (!isX(tab.url)) throw new Error('请先返回原来的 X 扫描标签页。');
  const identity = await identify(state.tabId);
  if (identity.owner !== state.owner || !C.ownRoute(identity.pathname, state.owner)) {
    throw new Error('请先打开扫描账号本人的关注或粉丝列表，再执行操作。');
  }
  const credentials = actionCredentials.get(state.tabId);
  if (!credentials || credentials.ownerId !== state.targetId || credentials.origin !== new URL(tab.url).origin) {
    throw new Error('尚未取得当前账号的请求信息，请刷新本人的关注列表，加载后再试。');
  }
  const request = { owner: state.owner, ownerId: state.targetId, userId: message.userId, action: message.action,
    requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, issuedAt: Date.now() };
  let stopped = A.stop({ ...state, active: false, issue: '',
    lists: { ...state.lists, following: { ...state.lists.following, complete: false, pages: {} } },
    friendships: { ...state.friendships, [message.userId]: { status: verifyOnly ? 'verifying' : 'pending', action: verifyOnly ? 'unfollow' : message.action, at: Date.now() } }
  }, 'stopped', '关注关系操作期间已暂停采集。');
  // 先保存待核对状态；浏览器中断后绝不根据旧按钮自动重复写入。
  await save(stopped);
  async function execute(action) {
    try {
      if ((await identify(state.tabId)).owner !== state.owner) return null;
      const result = await chrome.tabs.sendMessage(state.tabId, { type: 'FRIENDSHIP', request: {
        ...request, action, issuedAt: Date.now(), requestId: request.requestId + ':' + action, headers: credentials.headers
      } });
      return (await identify(state.tabId)).owner === state.owner ? result : null;
    } catch { return null; }
  }
  let result = verifyOnly ? null : await execute(message.action);
  const shouldVerify = verifyOnly || (message.action === 'unfollow' && !(result?.ok === false && result.status === 'failed'));
  if (shouldVerify) {
    stopped = { ...stopped, friendships: { ...stopped.friendships,
      [message.userId]: { status: 'verifying', action: 'unfollow', at: Date.now() } } };
    await save(stopped);
    result = await execute('verify_unfollow');
  }
  let update, error = '';
  if (shouldVerify) {
    if (result?.ok === true && result.userId === message.userId && Number.isFinite(result.verifiedAt) &&
        ['following', 'not_following'].includes(result.status)) {
      update = { status: result.status, action: 'unfollow', at: Date.now(), verifiedAt: result.verifiedAt };
      if (result.status === 'following') error = '复核后仍在关注该账号，取关尚未生效。';
    } else {
      update = { status: 'unknown', action: 'unfollow', at: Date.now() };
      error = String(result?.message || '取关结果待核对，可点击重新验证；不会重复发送取关请求。').slice(0, 250);
    }
  } else if (result?.ok === true && result.userId === message.userId &&
      message.action === 'follow' && ['following', 'requested'].includes(result.status)) {
    update = { status: result.status, action: 'follow', at: Date.now() };
  } else if (result?.ok === false && result.status === 'failed') {
    update = previous || { status };
    error = String(result.message || '操作失败，请在 X 页面核对。').slice(0, 250);
  } else {
    update = { status: 'unknown', action: message.action, at: Date.now() };
    error = '操作结果尚未确认，请在 X 核对后重新扫描；请勿直接重复操作。';
  }
  await save({ ...stopped, updatedAt: Date.now(), friendships: { ...stopped.friendships, [message.userId]: update } });
  if (error) throw new Error(error);
  return getState();
}

async function dispatch(message, sender) {
  await storageReady;
  const fromPage = sender.tab && sender.frameId === 0 && isX(sender.url);
  const fromPanel = !sender.tab && sender.url === chrome.runtime.getURL('panel.html');
  // 独立打开侧栏页面时 sender.tab 也可能存在；只允许扩展自己的面板地址。
  const trustedUI = fromPanel || sender.url === chrome.runtime.getURL('panel.html');
  if (['PAGE', 'PROFILE', 'ISSUE', 'IDENTITY', 'AUTO_TICK', 'SCROLL_PAUSE'].includes(message.type)) {
    if (!fromPage) throw new Error('无效的页面来源。');
    let state = await getState();
    if (!state || state.tabId !== sender.tab.id) return null;
    if (message.type === 'SCROLL_PAUSE') {
      if (!state.active || !state.auto?.enabled || state.auto.kind !== 'followers' ||
          message.owner !== state.owner || message.targetId !== state.targetId || message.runId !== state.auto.runId ||
          C.ownRoute(new URL(sender.url).pathname, state.owner) !== 'followers') throw new Error('当前采集已变化，请在侧栏核对。');
      await save(A.stop({ ...state, active: false }, 'stopped', '已通过页面提示层暂停采集。'));
      return { paused: true };
    }
    if (message.type === 'AUTO_TICK') {
      if (message.avatarUrl && state?.owner === message.owner && !state.avatarUrl) {
        state = { ...state, avatarUrl: message.avatarUrl };
        await save(state);
      }
      const result = A.decide(state, message, sender.tab.id);
      if (result.state !== state) await save(result.state);
      return { request: result.request, scroll: result.scroll, enabled: !!result.state.auto?.enabled, runId: result.state.auto?.runId };
    }
    if (message.type === 'IDENTITY') {
      if (message.owner !== state.owner) actionCredentials.delete(state.tabId);
      if (message.owner !== state.owner && state.active) {
        await save(A.stop({ ...state, active: false,
          issue: '检测到登录账号改变，采集已暂停。请为当前账号开始新的扫描。' }));
      } else if (message.owner === state.owner && message.avatarUrl && message.avatarUrl !== state.avatarUrl) {
        await save({ ...state, avatarUrl: message.avatarUrl });
      }
    } else if (message.type === 'PROFILE') {
      let next = C.bindProfile(state, message.profile, sender.tab.id);
      if (next !== state) {
        if (!state.targetId && next.targetId && next.auto?.enabled) {
          next = { ...next, auto: { ...next.auto, lastProgressAt: Date.now() } };
        }
        await save(next);
        if (!state.targetId && next.targetId && next.active) {
          await chrome.tabs.update(state.tabId, { url: `${new URL(sender.url).origin}/${state.owner}/${state.scanKind || 'following'}` });
        }
      }
    } else if (message.type === 'PAGE') {
      const page = message.page;
      if (page?.requestId && (!matchesPending(state, page) || page.cursor !== state.auto.pending.cursor ||
          page.kind !== state.auto.kind || page.targetId !== state.targetId)) return null;
      if (page?.requestId && Date.now() - state.auto.pending.issuedAt >= 20000) {
        await save(A.stop(state, 'error', '分页响应已超时，已停止采集并丢弃迟到结果。请检查网络后重试。'));
        return null;
      }
      let next = C.acceptPage(state, page, sender.tab.id);
      if (next !== state) {
        await save(A.received(next, page));
      }
    } else if (state.active && message.owner === state.owner && message.requestedAt >= state.acceptAfter) {
      if (message.requestId && !matchesPending(state, message)) return null;
      await save(A.stop({ ...state, active: !!state.targetId, issue: message.message }, 'error', '页面加载异常，自动采集已停止。请检查提示后重试。'));
    }
    return null;
  }
  if (!trustedUI) throw new Error('无效的扩展页面。');
  if (message.type === 'GET') {
    let old = await getState();
    if (!storageFailure && old?.targetId && old.historyBaselineAt === undefined) await save(old);
    if (old?.owner && !old.avatarUrl) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && isX(tab.url)) {
          const identity = await identify(tab.id);
          if (identity.owner === old.owner && identity.avatarUrl) {
            old = { ...old, avatarUrl: identity.avatarUrl };
            await save(old);
          }
        }
      } catch {}
    }
    return getState();
  }
  if (message.type === 'START') {
    const kind = message.kind || 'following';
    if (!['following', 'followers'].includes(kind)) throw new Error('不支持的列表类型。');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !isX(tab.url)) throw new Error('请先切换到已登录的 X 标签页，再点击开始扫描。');
    const identity = await identify(tab.id);
    const old = await getState();
    if (storageFailure) throw new Error(storageFailure);
    if (!storageFailure && old?.targetId && old.historyBaselineAt === undefined) await save(old);
    actionCredentials.delete(tab.id);
    await cancelRequest(tab.id);
    let state = { ...C.newSession(identity.owner, tab.id), scanKind: kind };
    if (identity.avatarUrl) state.avatarUrl = identity.avatarUrl;
    else if (old?.owner === identity.owner && old.avatarUrl) state.avatarUrl = old.avatarUrl;
    if (message.automatic === true) state = A.start(state, kind);
    await save(state);
    await chrome.tabs.update(tab.id, { url: `${new URL(tab.url).origin}/${state.owner}` });
    return state;
  }
  if (message.type === 'CLEAR') {
    const old = await getState();
    if (!storageFailure && old?.targetId && old.historyBaselineAt === undefined) await save(old);
    if (old) actionCredentials.delete(old.tabId);
    if (old) await cancelRequest(old.tabId);
    await chrome.storage.local.remove('session');
    await clearStorageFailure();
    return null;
  }
  const state = await getState();
  if (!state) throw new Error('请先开始扫描。');
  if (message.type === 'RESET_HISTORY') {
    if (!state.targetId || message.targetId !== state.targetId || message.owner !== state.owner || message.startedAt !== state.startedAt) {
      throw new Error('当前扫描账号已变化，请刷新侧栏后重试。');
    }
    await cancelRequest(state.tabId);
    await chrome.storage.local.remove([`history:${state.targetId}`, 'session']);
    await clearStorageFailure();
    actionCredentials.delete(state.tabId);
    return null;
  }
  if (message.type === 'FRIENDSHIP') return changeFriendship(state, message);
  if (message.type === 'PAUSE') { await save(A.stop({ ...state, active: false })); return getState(); }
  if (message.type === 'AUTO_STOP') { await save(A.stop(state)); return getState(); }
  if (message.type === 'RESUME' || message.type === 'OPEN_LIST' || message.type === 'AUTO_START') {
    let tab;
    try { tab = await chrome.tabs.get(state.tabId); }
    catch {
      if (message.type === 'AUTO_START') throw new Error('原扫描标签页已关闭，请打开 X 后点击继续采集。');
      [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !isX(tab.url)) throw new Error('原扫描标签页已关闭，请切换到同账号的 X 标签页，再点击继续采集。');
    }
    if (!isX(tab.url)) throw new Error('原扫描标签页已离开 X，请返回后继续。');
    const identity = await identify(tab.id);
    if (identity.owner !== state.owner) throw new Error('当前账号与扫描账号不同，请开始新的扫描。');
    if (message.type === 'AUTO_START') {
      if (!state.active || !state.targetId) throw new Error('请先完成账号核对，并继续采集。');
      const kind = C.ownRoute(identity.pathname, state.owner);
      if (!kind) throw new Error('请先打开自己的关注或粉丝列表，再开启自动采集。');
      if (state.lists[kind].complete) throw new Error('该列表已取得完整分页证据。如需刷新关系，请重新扫描。');
      await save(A.start({ ...state, scanKind: kind, issue: '' }, kind));
    } else {
      const kind = message.kind || (message.type === 'RESUME' ? state.scanKind || state.auto?.kind || 'following' : null);
      if (!['following', 'followers'].includes(kind)) throw new Error('不支持的列表类型。');
      if (message.type === 'OPEN_LIST' && !state.targetId) throw new Error('请先在本人资料页完成账号核对；可点击重新扫描重试。');
      if (message.type === 'RESUME' && message.automatic === true && state.lists[kind].complete) {
        throw new Error('该列表已采集完成。如需更新结果，请点击重新扫描。');
      }
      await cancelRequest(state.tabId);
      if (tab.id !== state.tabId) {
        // 仅在旧标签页失效且当前登录账号一致时重连，凭证必须从新页重新取得。
        actionCredentials.delete(state.tabId);
        actionCredentials.delete(tab.id);
      }
      const next = { ...state, tabId: tab.id, active: true, scanKind: kind, issue: '', acceptAfter: Date.now() };
      const started = message.automatic === true ? A.start(next, kind) : { ...A.stop(next), auto: null };
      if (started.auto?.enabled) started.auto = { ...started.auto, status: 'waiting', navigationFrom: identity.pathname };
      await save(started);
      await chrome.tabs.update(tab.id, { active: true,
        url: `${new URL(tab.url).origin}/${state.owner}${state.targetId ? '/' + kind : ''}` });
    }
    return getState();
  }
  throw new Error('不支持的操作。');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'STORAGE_FAILURE') return;
  const run = queue.then(() => dispatch(message, sender));
  queue = run.catch(() => {});
  run.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  actionCredentials.delete(tabId);
  queue = queue.then(async () => {
    const state = await getState();
    if (state?.tabId === tabId && state.active) await save(A.stop({ ...state, active: false,
      issue: '扫描标签页已关闭。结果已保留；打开同账号的 X 页面后，可点击继续采集。' }));
  }).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  queue = queue.then(async () => {
    const state = await getState();
    if (state?.active) await save(A.stop({ ...state, active: false,
      issue: '浏览器已重启，旧扫描已暂停。请在当前 X 标签页开始新的扫描。' }));
  }).catch(console.error);
});
