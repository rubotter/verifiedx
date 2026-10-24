(function (root) {
  'use strict';
  function start(state, kind, now = Date.now()) {
    return { ...state, auto: { enabled: true, mode: kind === 'followers' ? 'scroll' : 'request', runId: `${now}-${Math.random().toString(36).slice(2)}`, kind, status: state.targetId ? 'running' : 'waiting',
      count: Object.keys(state.lists[kind].users).length, noNewPages: 0, lastProgressAt: now } };
  }
  function stop(state, status = 'stopped', message = '') {
    return state?.auto ? { ...state, auto: { ...state.auto, enabled: false, pending: null, status, message } } : state;
  }
  function progress(state, now = Date.now()) {
    if (!state?.auto?.enabled) return state;
    const list = state.lists[state.auto.kind];
    if (list.complete) return stop(state, 'complete', '已取得连续分页与末页证据，自动采集已完成。');
    const count = Object.keys(list.users).length;
    if (count > state.auto.count) return { ...state, auto: { ...state.auto, count, noNewPages: 0, lastProgressAt: now } };
    return state;
  }
  function received(state, page, now = Date.now()) {
    let advanced = Object.keys(state.lists[state.auto?.kind || page.kind].users).length > (state.auto?.count || 0);
    let next = progress(state, now);
    if (!next.auto?.enabled || page.kind !== next.auto.kind || (!page.requestId && next.auto.kind !== 'followers')) return next;
    if (page.kind === 'following' && Array.isArray(page.users) && page.users.length === 0) {
      const list = next.lists.following;
      next = { ...next, lists: { ...next.lists, following: { ...list, complete: true } } };
      return stop(next, 'complete', '已取得连续分页与末页证据，自动采集已完成。');
    }
    if (page.kind === 'followers' && Array.isArray(page.users) && page.users.length === 0 && (!page.nextCursor || page.cursor)) {
      const list = next.lists.followers;
      next = { ...next, lists: { ...next.lists, followers: { ...list, complete: true } } };
      return stop(next, 'complete', '已取得连续分页与末页证据，自动采集已完成。');
    }
    if (page.kind === 'followers') {
      // 恢复时网页从首屏重新加载，按本轮已见 ID 计进展，避免在旧快照前几页误停。
      const visitedIds = { ...next.auto.visitedIds };
      for (const user of page.users || []) {
        if (user && /^\d{1,25}$/.test(user.id || '') && next.lists.followers.users[user.id] && !visitedIds[user.id]) {
          visitedIds[user.id] = true;
          advanced = true;
        }
      }
      next = { ...next, auto: { ...next.auto, visitedIds, ...(advanced ? { lastProgressAt: now } : {}) } };
    }
    // 收到响应不等于新增账号；末尾不断变化的游标不能延长无进展计时。
    const noNewPages = advanced ? 0 : (next.auto.noNewPages || 0) + 1;
    next = { ...next, auto: { ...next.auto, pending: null, noNewPages } };
    return noNewPages >= 3 ? stop(next, 'stalled',
      '连续 3 页没有新增账号，自动采集已停止。已有结果已保留；未取得明确末页证据，完整性尚未确认。') : next;
  }
  function decide(state, tick, tabId, now = Date.now()) {
    const no = next => ({ state: next, request: null, scroll: null });
    if (!state?.auto?.enabled || !state.active || state.tabId !== tabId) return no(state);
    // 旧版本的粉丝会话也切换为滚动，不再继续重放或等待旧请求。
    if (state.auto.kind === 'followers' && (state.auto.mode !== 'scroll' || state.auto.pending)) {
      state = { ...state, auto: { ...state.auto, mode: 'scroll', pending: null } };
    }
    // 侧栏在页面跳转时可能尚未加载，等待期间绝不授权请求。
    if (!tick.owner) {
      const missingSince = state.auto.missingSince ?? now;
      if (now - missingSince >= 30000) return no(stop(state, 'stopped', '30 秒内无法确认登录账号，自动采集已停止。请刷新页面后重试。'));
      return no(state.auto.missingSince == null ? { ...state, auto: { ...state.auto, missingSince } } : state);
    }
    if (tick.owner !== state.owner) return no(stop(state, 'stopped', '账号暂时无法确认，自动采集已停止。'));
    if (state.auto.missingSince != null) state = { ...state, auto: { ...state.auto, missingSince: null } };
    if (!state.targetId) return no(state);
    // 账号刚核对完成时，旧资料页可能还有一轮请求在队列中，给跳转留出短暂时间。
    if (state.auto.status === 'waiting' && tick.pathname?.replace(/\/$/, '').toLowerCase() === `/${state.owner}` &&
        now - state.auto.lastProgressAt < 15000) return no(state);
    // 列表切换刚发起时可能收到旧页面轮询，等待导航完成再授权新列表请求。
    if (state.auto.status === 'waiting' && state.auto.navigationFrom === tick.pathname &&
        tick.pathname !== `/${state.owner}/${state.auto.kind}` && now - state.auto.lastProgressAt < 15000) return no(state);
    const match = tick.pathname?.match(/^\/([A-Za-z0-9_]{1,15})\/(following|followers)\/?$/i);
    if (!match || match[1].toLowerCase() !== state.owner || match[2].toLowerCase() !== state.auto.kind) {
      return no(stop(state, 'stopped', '已离开正在采集的列表，自动采集已停止。'));
    }
    if (!tick.visible) return no(stop(state, 'stopped', '扫描标签页已转入后台。返回该列表后，可再次开启自动采集。'));
    let next = progress(state, now);
    if (!next.auto.enabled) return no(next);
    if (next.auto.status === 'waiting') next = { ...next, auto: { ...next.auto, status: 'running', lastProgressAt: now } };
    if (now - next.auto.lastProgressAt >= 60000) return no(stop(next, 'stalled',
      '连续 60 秒没有新增账号，自动采集已停止，完整性尚未确认。可检查 X 页面后重试，已采集结果已保留。'));
    if (next.auto.pending) {
      if (now - next.auto.pending.issuedAt >= 20000) return no(stop(next, 'error',
        '分页请求超时，采集已停止。请检查网络后重试。'));
      return no(next);
    }
    if (tick.ready?.targetId !== next.targetId || tick.ready?.kind !== next.auto.kind) return no(next);
    const list = next.lists[next.auto.kind];
    // 粉丝必须先收到本页有效的首屏响应，再推动网页自己的分页。
    if (next.auto.kind === 'followers' && !list.pages.root) return no(next);
    let cursor = null;
    const seen = new Set();
    while (true) {
      const key = cursor ? `cursor:${cursor}` : 'root';
      if (seen.has(key)) return no(stop(next, 'error', '分页游标重复，无法确认完整性，已停止自动采集。'));
      seen.add(key);
      const page = list.pages[key];
      if (!page) break;
      // 条目缺失影响完整性，但不能阻止有效游标继续取后续页。
      if (page.terminal && !page.nextCursor) return no(stop(next, 'partial',
        '已到接口末页，但存在无法解析的条目，结果仍不完整；已保留其余可识别账号。'));
      if (!page.nextCursor) return no(stop(next, 'error',
        '列表缺少可用的下一页或末页证据，已停止自动采集。可刷新后重新扫描。'));
      cursor = page.nextCursor;
    }
    if (next.auto.kind === 'followers') {
      if (tick.atBottom && now - next.auto.lastProgressAt >= 5000) {
        const list = next.lists.followers;
        next = { ...next, lists: { ...next.lists, followers: { ...list, complete: true } } };
        return no(stop(next, 'complete', '已滚动至粉丝列表末尾，自动采集已完成。'));
      }
      if (next.auto.lastScrollAt != null && now - next.auto.lastScrollAt < 3000) return no(next);
      const scroll = { owner: next.owner, targetId: next.targetId, kind: 'followers', runId: next.auto.runId, issuedAt: now };
      next = { ...next, auto: { ...next.auto, pending: null, lastScrollAt: now } };
      return { state: next, request: null, scroll };
    }
    if (next.auto.lastRequestAt != null && now - next.auto.lastRequestAt < 3000) return no(next);
    const sequence = (next.auto.sequence || 0) + 1;
    const request = { owner: next.owner, targetId: next.targetId, kind: next.auto.kind, cursor,
      requestId: `${next.auto.runId}:${sequence}`, runId: next.auto.runId, issuedAt: now };
    next = { ...next, auto: { ...next.auto, sequence, pending: request, lastRequestAt: now } };
    return { state: next, request, scroll: null };
  }
  root.XFFAuto = { start, stop, progress, received, decide };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.XFFAuto;
})(globalThis);
