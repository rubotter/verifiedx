const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../extension/core');
function harness(initial = null, saved = {}, savedTemporary = {}, tabs = {}) {
  let session = structuredClone(initial), listener, startup, observeHeaders;
  const storage = structuredClone(saved);
  let failSave = false, persistentFailure = false, saveAttempts = 0;
  const temporary = structuredClone(savedTemporary);
  const navigations = [];
  const writes = [], verifications = [], savedStates = [];
  const verificationReply = { ok: true, status: 'not_following', userId: '1', verifiedAt: Date.now() };
  const actionReply = { ok: true, status: 'not_following', userId: '1' };
  let owner = 'harvey';
  const ui = 'chrome-extension://test/panel.html';
  const context = vm.createContext({ URL, Date, console, importScripts: () => {}, XFF: C, XFFAuto: require('../extension/auto'), XFFHistory: require('../extension/history'),
    chrome: {
      runtime: { getURL: p => 'chrome-extension://test/' + p,
        sendMessage: async () => {},
        onMessage: { addListener: fn => { listener = fn; } },
        onStartup: { addListener: fn => { startup = fn; } } },
      webRequest: { onBeforeSendHeaders: { addListener: fn => { observeHeaders = fn; } } },
      sidePanel: { setPanelBehavior: async () => {} },
      storage: { session: { get: async () => structuredClone(temporary),
        set: async value => Object.assign(temporary, structuredClone(value)), remove: async key => { delete temporary[key]; } },
      local: { setAccessLevel: async () => {}, get: async () => ({ ...structuredClone(storage), session: structuredClone(session) }),
        set: async value => {
          saveAttempts++;
          if (persistentFailure) throw new Error('存储持续不可写');
          if (failSave) { failSave = false; throw new Error('存储已满'); }
          if ('session' in value) { session = structuredClone(value.session); savedStates.push(structuredClone(session)); }
          for (const [key, data] of Object.entries(value)) if (key !== 'session') storage[key] = structuredClone(data);
        }, remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (key === 'session') session = null; else delete storage[key];
        } } } },
      tabs: { query: async () => [tabs.current || { id: 7, url: 'https://x.com/home' }],
        get: async id => { if (tabs.closed) throw new Error('标签页不存在'); return { id, url: 'https://x.com/home' }; }, update: async (id, change) => { navigations.push({ id, ...change }); },
        sendMessage: async (id, message) => { if (message.type === 'FRIENDSHIP') { if (message.request.action === 'verify_unfollow') { verifications.push(message.request); return { ...verificationReply }; } writes.push(message.request); return { ...actionReply }; } return { owner, pathname: '/harvey/following' }; }, onRemoved: { addListener: () => {} } }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const captureHeaders = (extra = {}) => observeHeaders({ tabId: 7, frameId: 0,
    url: 'https://x.com/i/api/graphql/hash/Following?variables=' + encodeURIComponent(JSON.stringify({ userId: '99' })),
    requestHeaders: [{ name: 'Authorization', value: 'Bearer mock' }, { name: 'x-csrf-token', value: 'csrf-mock' }, { name: 'Cookie', value: 'private-cookie' }], ...extra });
  captureHeaders();
  return { captureHeaders, send: (message, sender = { url: ui }) => new Promise(resolve => listener(message, sender, resolve)),
    async restart() { startup?.(); await vm.runInContext('queue', context); }, get: () => session, navigations,
    writes, actionReply, verifications, verificationReply, savedStates, storage, temporary, attempts: () => saveAttempts,
    failSave: (persistent = false) => { failSave = true; persistentFailure = persistent; }, setOwner: value => { owner = value; } };
}
test('后台只允许自己的面板启动扫描', async () => {
  const h = harness();
  const rejected = await h.send({ type: 'START' }, { url: 'https://x.com/home', tab: { id: 7 }, frameId: 0 });
  assert.equal(rejected.ok, false);
  const result = await h.send({ type: 'START' });
  assert.equal(result.ok, true);
  assert.equal(h.get().owner, 'harvey');
  assert.equal(h.get().tabId, 7);
});
test('账号改变时暂停采集并保留已有结果', async () => {
  const h = harness(C.newSession('harvey', 7, 100));
  await h.send({ type: 'IDENTITY', owner: 'other' }, { url: 'https://x.com/home', tab: { id: 7 }, frameId: 0 });
  assert.equal(h.get().active, false);
  assert.match(h.get().issue, /账号改变/);
});
test('重启浏览器后暂停旧会话，避免复用标签页 ID', async () => {
  const h = harness(C.newSession('harvey', 7, 100));
  await h.restart();
  assert.equal(h.get().active, false);
});

test('开始扫描先打开本人资料页，核对成功后只跳转一次关注列表', async () => {
  const h = harness();
  await h.send({ type: 'START' });
  assert.equal(h.navigations[0].url, 'https://x.com/harvey');
  const message = { type: 'PROFILE', profile: { owner: 'harvey', id: '99', requestedAt: Date.now() } };
  const sender = { url: 'https://x.com/harvey', tab: { id: 7 }, frameId: 0 };
  await h.send(message, sender);
  assert.equal(h.get().targetId, '99');
  assert.equal(h.navigations[1].url, 'https://x.com/harvey/following');
  await h.send(message, sender);
  assert.equal(h.navigations.length, 2);
});

test('自动模式暂停后不再授权请求，手动继续也不会擅自重启自动模式', async () => {
  const initial = { ...C.newSession('harvey', 7, 100), targetId: '99' };
  const h = harness(initial);
  await h.send({ type: 'AUTO_START' });
  const sender = { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 };
  const tick = { type: 'AUTO_TICK', owner: 'harvey', pathname: '/harvey/following', visible: true, ready: { targetId: '99', kind: 'following' } };
  assert.equal((await h.send(tick, sender)).data.request != null, true);
  await h.send({ type: 'PAUSE' });
  assert.equal((await h.send(tick, sender)).data.request, null);
  await h.send({ type: 'RESUME' });
  assert.equal((await h.send(tick, sender)).data.request, null);
});
test('开始扫描可预先开启自动采集，完成核对后保留该选择', async () => {
  const h = harness();
  await h.send({ type: 'START', automatic: true });
  assert.equal(h.get().auto.enabled, true);
  await h.send({ type: 'PROFILE', profile: { owner: 'harvey', id: '99', requestedAt: Date.now() } },
    { url: 'https://x.com/harvey', tab: { id: 7 }, frameId: 0 });
  assert.equal(h.get().auto.enabled, true);
});
test('页面限流或加载错误立即停止自动请求并保留已保存数据', async () => {
  const initial = { ...C.newSession('harvey', 7, 100), targetId: '99' };
  const h = harness(initial);
  await h.send({ type: 'AUTO_START' });
  await h.send({ type: 'ISSUE', owner: 'harvey', requestedAt: Date.now(), message: '加载限制' },
    { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 });
  assert.equal(h.get().auto.enabled, false);
  assert.equal(h.get().auto.status, 'error');
  assert.equal(h.get().issue, '加载限制');
});
test('本人资料加载失败时退出核对状态并展示错误', async () => {
  const h = harness();
  await h.send({ type: 'START', automatic: true });
  await h.send({ type: 'ISSUE', owner: 'harvey', requestedAt: Date.now(), message: '资料加载限制' },
    { url: 'https://x.com/harvey', tab: { id: 7 }, frameId: 0 });
  assert.equal(h.get().active, false);
  assert.equal(h.get().auto.enabled, false);
  assert.equal(h.get().issue, '资料加载限制');
  assert.equal(h.navigations.length, 1);
});

test('请求响应只接受当前授权标识，暂停和重启采集后丢弃迟到响应', async () => {
  const h = harness({ ...C.newSession('harvey', 7, 100), targetId: '99' });
  const sender = { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 };
  await h.send({ type: 'AUTO_START' });
  const tick = { type: 'AUTO_TICK', owner: 'harvey', pathname: '/harvey/following', visible: true,
    ready: { targetId: '99', kind: 'following' } };
  const req = (await h.send(tick, sender)).data.request;
  const page = { ...req, requestedAt: Date.now(), users: [{ id: '1', username: 'alice' }], nextCursor: 'next', terminal: false };
  await h.send({ type: 'PAGE', page: { ...page, requestId: 'wrong' } }, sender);
  assert.equal(Object.keys(h.get().lists.following.users).length, 0);
  await h.send({ type: 'PAGE', page }, sender);
  assert.equal(Object.keys(h.get().lists.following.users).length, 1);
  assert.equal(h.get().auto.pending, null);
  await h.send({ type: 'AUTO_STOP' });
  await h.send({ type: 'AUTO_START' });
  await h.send({ type: 'PAGE', page: { ...page, users: [{ id: '2', username: 'late' }] } }, sender);
  assert.equal(Object.keys(h.get().lists.following.users).length, 1);
  await h.send({ type: 'ISSUE', owner: 'harvey', requestedAt: Date.now(), requestId: req.requestId,
    runId: req.runId, message: '旧请求失败' }, sender);
  assert.equal(h.get().issue, '');
});
test('即使下一轮轮询尚未执行，过期的匹配请求响应也不能写入', async () => {
  const h = harness({ ...C.newSession('harvey', 7, 100), targetId: '99' });
  const sender = { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 };
  await h.send({ type: 'AUTO_START' });
  const req = (await h.send({ type: 'AUTO_TICK', owner: 'harvey', pathname: '/harvey/following', visible: true,
    ready: { targetId: '99', kind: 'following' } }, sender)).data.request;
  h.get().auto.pending.issuedAt = Date.now() - 21000;
  await h.send({ type: 'PAGE', page: { ...req, requestedAt: Date.now(), users: [{ id: '1', username: 'late' }],
    terminal: true, nextCursor: null } }, sender);
  assert.equal(Object.keys(h.get().lists.following.users).length, 0);
  assert.equal(h.get().lists.following.complete, false);
  assert.equal(h.get().auto.enabled, false);
  assert.equal(h.get().auto.status, 'error');
});
function actionSession() {
  const s = C.newSession('harvey', 7, 100); s.targetId = '99';
  s.lists.following.users['1'] = { id: '1', username: 'alice', name: 'Alice', followedBy: false, blue: false, badge: 'none' };
  s.lists.following.complete = true;
  return s;
}
const followMessage = (extra = {}) => ({ type: 'FRIENDSHIP', owner: 'harvey', startedAt: 100,
  userId: '1', action: 'unfollow', expectedStatus: 'following', ...extra });
test('单账号凭证只通过内部消息传递白名单头，不保存 Cookie 或凭证', async () => {
  const h = harness(actionSession());
  assert.equal((await h.send(followMessage())).ok, true);
  assert.deepEqual(Array.from(h.writes[0].headers, pair => Array.from(pair)),
    [['authorization', 'Bearer mock'], ['x-csrf-token', 'csrf-mock']]);
  assert.doesNotMatch(JSON.stringify(h.get()), /Bearer mock|csrf-mock|private-cookie|authorization/);
});
test('其他账号的列表凭证不能用于当前账号操作', async () => {
  const h = harness(actionSession());
  h.captureHeaders({ url: 'https://x.com/i/api/graphql/hash/Following?variables=' + encodeURIComponent(JSON.stringify({ userId: '88' })) });
  assert.equal((await h.send(followMessage())).ok, false);
  assert.equal(h.writes.length, 0);
});
test('只有面板可操作当前会话已有账号，旧会话或切换账号拒绝写请求', async () => {
  const h = harness(actionSession());
  assert.equal((await h.send(followMessage(), { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 })).ok, false);
  for (const extra of [{ userId: '2' }, { startedAt: 99 }, { owner: 'other' }, { action: 'delete' }]) {
    assert.equal((await h.send(followMessage(extra))).ok, false);
  }
  h.setOwner('other');
  assert.equal((await h.send(followMessage())).ok, false);
  assert.equal(h.writes.length, 0);
});
test('取关保留卡片并可关注回来，暂停采集且清除旧分页完整性', async () => {
  const h = harness(actionSession());
  assert.equal((await h.send(followMessage())).ok, true);
  assert.equal(h.get().friendships['1'].status, 'not_following');
  assert.equal(h.get().active, false);
  assert.equal(h.get().lists.following.complete, false);
  assert.equal(C.rows(h.get()).length, 1);
  assert.equal((await h.send(followMessage())).ok, false, '重复点击旧按钮不能再次取关');
  h.actionReply.status = 'following';
  assert.equal((await h.send(followMessage({ action: 'follow', expectedStatus: 'not_following' }))).ok, true);
  assert.equal(h.get().friendships['1'].status, 'following');
  assert.equal(h.writes.length, 2);
});
test('失败保留原状态，结果不明阻止重复操作，写入成功后保存新关注状态', async () => {
  const h = harness(actionSession());
  Object.assign(h.actionReply, { ok: false, status: 'failed', message: '限流' });
  assert.equal((await h.send(followMessage())).ok, false);
  assert.equal(h.get().friendships['1']?.status || 'following', 'following');
  Object.assign(h.actionReply, { status: 'unknown', message: '待核对' });
  Object.assign(h.verificationReply, {ok:false, status:'unknown'});
  assert.equal((await h.send(followMessage())).ok, false);
  assert.equal(h.get().friendships['1'].status, 'unknown');
  assert.equal((await h.send(followMessage())).ok, false);
  assert.equal(h.writes.length, 2);
});

test('旧快照迁移并跨扫描和清空结果保留首次发现，重建后台后仍能读到', async () => {
  const initial = actionSession(); initial.lists.following.users['1'].observedAt = 101;
  const h = harness(initial);
  const migrated = await h.send({ type: 'GET' });
  assert.equal(migrated.data.lists.following.users['1'].firstSeenAt, 101);
  assert.equal(migrated.data.lists.following.users['1'].isNew, false);
  await h.send({ type: 'START' });
  await h.send({ type: 'PROFILE', profile: { owner: 'harvey', id: '99', requestedAt: Date.now() } },
    { url: 'https://x.com/harvey', tab: { id: 7 }, frameId: 0 });
  await h.send({ type: 'PAGE', page: { owner: 'harvey', targetId: '99', kind: 'following', requestedAt: Date.now(),
    users: [{ id: '1', username: 'renamed' }, { id: '2', username: 'newperson' }], terminal: true } },
    { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 });
  assert.equal(h.get().lists.following.users['1'].firstSeenAt, 101);
  assert.equal(h.get().lists.following.users['2'].isNew, true);
  const restarted = harness(h.get(), h.storage);
  assert.equal((await restarted.send({ type: 'GET' })).data.lists.following.users['2'].isNew, true);
  await h.send({ type: 'CLEAR' });
  assert.equal(h.get(), null);
  assert.equal(h.storage['history:99'].users['1'].firstSeenAt, 101);
});
test('直接重新扫描旧快照也迁移历史，历史删除只作用于当前账号且拒绝页面和过期按钮', async () => {
  const initial = actionSession(); initial.lists.following.users['1'].observedAt = 101;
  const h = harness(initial, { 'history:88': { ownerId: '88', users: {} } });
  await h.send({ type: 'START' });
  assert.equal(h.storage['history:99'].users['1'].firstSeenAt, 101);
  const r = harness(initial, h.storage);
  const message = { type: 'RESET_HISTORY', owner: 'harvey', targetId: '99', startedAt: 100 };
  assert.equal((await r.send(message, { url: 'https://x.com/harvey', tab: { id: 7 }, frameId: 0 })).ok, false);
  assert.equal((await r.send({ ...message, startedAt: 99 })).ok, false);
  assert.equal((await r.send(message)).ok, true);
  assert.equal(r.get(), null);
  assert.equal(r.storage['history:99'], undefined);
  assert.ok(r.storage['history:88']);
});
test('保存历史失败不建立基线、不丢失旧历史且停止采集', async () => {
  const h = harness(actionSession());
  h.failSave();
  const result = await h.send({ type: 'GET' });
  assert.equal(result.ok, false);
  assert.equal(h.storage['history:99'], undefined);
  assert.equal(h.get().active, false);
  assert.match(h.get().issue, /本地保存失败/);
});
test('持续存储故障时使用会话级停止标记，后续页面和轮询不再反复写入', async () => {
  const h = harness(actionSession());
  h.failSave(true);
  assert.equal((await h.send({ type: 'GET' })).ok, false);
  const state = (await h.send({ type: 'GET' })).data;
  assert.equal(state.active, false);
  assert.match(state.issue, /本地保存失败/);
  assert.ok(h.temporary.storageFailure);
  const before = h.attempts();
  const sender = { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 };
  await h.send({ type: 'PAGE', page: { owner: 'harvey', targetId: '99', kind: 'following',
    requestedAt: Date.now(), users: [{ id: '2', username: 'new' }], terminal: true } }, sender);
  const tick = await h.send({ type: 'AUTO_TICK', owner: 'harvey', pathname: '/harvey/following', visible: true }, sender);
  assert.equal(tick.data.request, null);
  assert.equal(h.attempts(), before);
  const reloaded = harness(h.get(), h.storage, h.temporary);
  assert.equal((await reloaded.send({ type: 'GET' })).data.active, false, '后台重建后仍应暂停');
  assert.equal(reloaded.attempts(), 0);
  assert.equal((await h.send({ type: 'CLEAR' })).ok, true);
  assert.equal(h.get(), null);
});

test('重复响应不会刷新新增时间，连续三页无新增后停止且不误报完整', async () => {
  const initial = actionSession();
  initial.lists.following.complete = false;
  initial.lists.following.pages = { root: { nextCursor: 'next0', terminal: false } };
  initial.auto = { enabled: true, kind: 'following', runId: 'test', count: 1,
    status: 'running', lastProgressAt: Date.now() - 1000 };
  const h = harness(initial);
  const originalTime = h.get().auto.lastProgressAt;
  const sender = { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 };
  const tick = { type: 'AUTO_TICK', owner: 'harvey', pathname: '/harvey/following', visible: true,
    ready: { targetId: '99', kind: 'following' } };
  for (let index = 0; index < 3; index++) {
    h.get().auto.lastRequestAt = Date.now() - 4000;
    const req = (await h.send(tick, sender)).data.request;
    assert.ok(req);
    await h.send({ type: 'PAGE', page: { ...req, requestedAt: Date.now(),
      users: [{ id: '1', username: 'alice' }], nextCursor: 'next' + (index + 1), terminal: false } }, sender);
    assert.equal(h.get().auto.lastProgressAt, originalTime);
  }
  assert.equal(h.get().auto.enabled, false);
  assert.equal(h.get().auto.pending, null);
  assert.equal(h.get().auto.status, 'stalled');
  assert.equal(h.get().lists.following.complete, false);
  assert.equal((await h.send(tick, sender)).data.request, null);
});

test('关注采集出现空页即判定采集结束并标记完整', async () => {
  const initial = actionSession();
  initial.lists.following.complete = false;
  initial.lists.following.pages = { root: { nextCursor: 'next0', terminal: false } };
  initial.auto = { enabled: true, kind: 'following', runId: 'test', count: 1,
    status: 'running', lastProgressAt: Date.now() - 1000 };
  const h = harness(initial);
  const sender = { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 };
  const tick = { type: 'AUTO_TICK', owner: 'harvey', pathname: '/harvey/following', visible: true,
    ready: { targetId: '99', kind: 'following' } };
  const req = (await h.send(tick, sender)).data.request;
  assert.ok(req);
  await h.send({ type: 'PAGE', page: { ...req, requestedAt: Date.now(),
    users: [], nextCursor: 'next1', terminal: false } }, sender);
  assert.equal(h.get().lists.following.complete, true);
  assert.equal(h.get().auto.status, 'complete');
  assert.equal(h.get().auto.enabled, false);
  assert.equal(h.get().auto.pending, null);
  assert.equal((await h.send(tick, sender)).data.request, null);
});

test('取关响应后独立查询并保存复核中与已验证时间', async () => {
  const h=harness(actionSession());
  assert.equal((await h.send(followMessage())).ok,true);
  assert.equal(h.writes.length,1);
  assert.equal(h.verifications.length,1);
  assert.ok(h.savedStates.some(s=>s.friendships?.['1']?.status==='verifying'));
  assert.equal(h.get().friendships['1'].verifiedAt,h.verificationReply.verifiedAt);
  assert.equal(C.rows(h.get())[0].verifiedAt,h.verificationReply.verifiedAt);
});
test('取关响应未知仍只读复核，确定失败不自动查询', async () => {
  const h=harness(actionSession());
  Object.assign(h.actionReply,{ok:false,status:'unknown'});
  assert.equal((await h.send(followMessage())).ok,true);
  assert.equal(h.writes.length,1);
  assert.equal(h.verifications.length,1);
  const k=harness(actionSession());
  Object.assign(k.actionReply,{ok:false,status:'failed'});
  assert.equal((await k.send(followMessage())).ok,false);
  assert.equal(k.verifications.length,0);
});
test('复核失败后重新验证与后台重建只查询，拒绝网页及旧会话', async () => {
  const h=harness(actionSession());
  Object.assign(h.verificationReply,{ok:false,status:'unknown',message:'查询受限'});
  assert.equal((await h.send(followMessage())).ok,false);
  assert.equal(C.rows(h.get())[0].canVerify,true);
  const retry=followMessage({action:'verify_unfollow',expectedStatus:'unknown'});
  for(const extra of [{startedAt:99},{owner:'other'},{userId:'2'}]) assert.equal((await h.send({...retry,...extra})).ok,false);
  assert.equal((await h.send(retry,{url:'https://x.com/harvey/following',tab:{id:7},frameId:0})).ok,false);
  Object.assign(h.verificationReply,{ok:true,status:'not_following'});
  assert.equal((await h.send(retry)).ok,true);
  assert.equal(h.writes.length,1);
  assert.equal(h.verifications.length,2);
  for(const status of ['pending','verifying']) {
    const state=actionSession();state.friendships={'1':{status,action:'unfollow'}};
    const k=harness(state);await k.restart();
    assert.equal(C.rows(k.get())[0].canVerify,true);
    assert.equal((await k.send(followMessage({action:'verify_unfollow',expectedStatus:status}))).ok,true);
    assert.equal(k.writes.length,0);
    assert.equal(k.verifications.length,1);
  }
});
test('最终仍关注不会显示取关成功，缺失验证证据不能确认', async () => {
  for(const status of ['following','not_following']) {
    const h=harness(actionSession());h.verificationReply.status=status;
    if(status==='not_following')delete h.verificationReply.verifiedAt;
    assert.equal((await h.send(followMessage())).ok,false);
    assert.equal(h.get().friendships['1'].status,status==='following'?'following':'unknown');
    assert.equal(h.writes.length,1);
  }
  const h=harness(actionSession());
  assert.equal((await h.send(followMessage({action:'verify_unfollow'}))).ok,false);
  assert.equal(h.verifications.length,0);
});

test('可直接开始粉丝扫描，账号核对后导航粉丝列表并启用粉丝分页', async () => {
  const h=harness();
  assert.equal((await h.send({type:'START',kind:'followers',automatic:true})).ok,true);
  assert.equal(h.get().scanKind,'followers');
  assert.equal(h.get().auto.kind,'followers');
  await h.send({type:'PROFILE',profile:{owner:'harvey',id:'99',requestedAt:Date.now()}},
    {url:'https://x.com/harvey',tab:{id:7},frameId:0});
  assert.equal(h.navigations.at(-1).url,'https://x.com/harvey/followers');
  await h.send({type:'PAGE',page:{owner:'harvey',targetId:'99',kind:'followers',cursor:null,
    requestedAt:Date.now(),users:[],nextCursor:'next'}},{url:'https://x.com/harvey/followers',tab:{id:7},frameId:0});
  const req=await h.send({type:'AUTO_TICK',owner:'harvey',pathname:'/harvey/followers',visible:true,
    ready:{kind:'followers',targetId:'99'}},{url:'https://x.com/harvey/followers',tab:{id:7},frameId:0});
  assert.equal(req.data.request,null);
  assert.equal(req.data.scroll.kind,'followers');
  assert.equal((await h.send({type:'START',kind:'other'})).ok,false);
});
test('同会话开启粉丝扫描保留关注快照，手动模式也恢复采集', async () => {
  const s=actionSession();s.active=false;
  const h=harness(s);
  assert.equal((await h.send({type:'OPEN_LIST',kind:'followers',automatic:true})).ok,true);
  assert.ok(h.get().lists.following.users['1']);
  assert.equal(h.get().auto.kind,'followers');
  assert.equal(h.get().active,true);
  assert.equal(h.get().scanKind,'followers');
  assert.equal(h.navigations.at(-1).url,'https://x.com/harvey/followers');
  await h.send({type:'PAUSE'});
  await h.send({type:'OPEN_LIST',kind:'following',automatic:false});
  assert.equal(h.get().active,true);
  assert.equal(!!h.get().auto?.enabled,false);
});
test('粉丝卡片可关注与取关，未知状态或伪造状态不能触发写入', async () => {
  const s=actionSession();s.lists.following.users={};s.lists.following.complete=false;
  s.lists.followers.users['1']={id:'1',username:'alice',following:false,followRequested:false};
  const h=harness(s);h.actionReply.status='following';
  assert.equal((await h.send(followMessage({action:'follow',expectedStatus:'not_following'}))).ok,true);
  assert.equal(h.writes.length,1);
  assert.equal(C.rows(h.get(),'followers')[0].ownStatus,'following');
  h.actionReply.status='not_following';
  assert.equal((await h.send(followMessage())).ok,true);
  assert.equal(h.verifications.length,1);
  for (const [following,followRequested] of [[null,false],[false,true]]) {
    s.lists.followers.users['1']={id:'1',username:'alice',following,followRequested};
    const k=harness(s);
    assert.equal((await k.send(followMessage({action:'follow',expectedStatus:'not_following'}))).ok,false);
    assert.equal(k.writes.length,0);
  }
});


test('勾选自动分页后继续采集，恢复所选列表的分页并保留双列表结果', async () => {
  const s = actionSession(); s.active = false;
  s.lists.followers.users['2'] = {id:'2',username:'bob'};
  const h = harness(s);
  const result = await h.send({type:'RESUME',automatic:true,kind:'followers'});
  assert.equal(result.ok,true);
  assert.equal(h.get().auto?.enabled,true);
  assert.equal(h.get().scanKind,'followers');
  assert.ok(h.get().lists.following.users['1']);
  assert.ok(h.get().lists.followers.users['2']);
  assert.equal(h.navigations.at(-1).url,'https://x.com/harvey/followers');
  await h.send({type:'PAGE',page:{owner:'harvey',targetId:'99',kind:'followers',cursor:null,
    requestedAt:Date.now(),users:[],nextCursor:'next'}},{url:'https://x.com/harvey/followers',tab:{id:7},frameId:0});
  const tick = await h.send({type:'AUTO_TICK',owner:'harvey',pathname:'/harvey/followers',visible:true,
    ready:{targetId:'99',kind:'followers'}},{url:'https://x.com/harvey/followers',tab:{id:7},frameId:0});
  assert.equal(tick.data.request,null);
  assert.equal(tick.data.scroll.kind,'followers');
});

test('关闭旧标签页后从当前同账号 X 标签页恢复采集，拒绝旧标签页响应', async () => {
  for (const type of ['RESUME','OPEN_LIST']) {
    const s = actionSession(); s.active = false;
    const h = harness(s, {}, {}, {closed:true,current:{id:8,url:'https://x.com/home'}});
    const result = await h.send({type,automatic:true,kind:'followers'});
    assert.equal(result.ok,true,result.error);
    assert.equal(h.get().tabId,8);
    assert.equal(h.get().targetId,'99');
    assert.ok(h.get().lists.following.users['1']);
    assert.equal(h.navigations.at(-1).id,8);
    assert.equal(h.navigations.at(-1).url,'https://x.com/harvey/followers');
    await h.send({type:'PAGE',page:{owner:'harvey',targetId:'99',kind:'followers',requestedAt:Date.now(),
      users:[{id:'3',username:'late'}],terminal:true}}, {url:'https://x.com/harvey/followers',tab:{id:7},frameId:0});
    assert.equal(h.get().lists.followers.users['3'],undefined);
  }
});

test('恢复采集时新标签页未登录、账号不同或不是 X 均不替换会话', async () => {
  for (const [owner,url,expected] of [['other','https://x.com/home',/账号不同/],
    [null,'https://x.com/home',/登录/],['harvey','https://example.com',/X 标签页/]]) {
    const s=actionSession(); s.active=false;
    const h=harness(s, {}, {}, {closed:true,current:{id:8,url}}); h.setOwner(owner);
    const result=await h.send({type:'RESUME',kind:'followers',automatic:true});
    assert.equal(result.ok,false);
    assert.match(result.error,expected);
    assert.deepEqual(h.get(),s);
    assert.equal(h.navigations.length,0);
  }
});

test('恢复时未勾选自动分页清除旧停止状态，打开选定列表等待手动采集', async () => {
  const s=actionSession(); s.active=false;
  s.auto={enabled:false,status:'stopped',kind:'following'};
  const h=harness(s);
  assert.equal((await h.send({type:'RESUME',kind:'followers',automatic:false})).ok,true);
  assert.equal(h.get().auto,null);
  assert.equal(h.get().active,true);
  assert.equal(h.navigations.at(-1).url,'https://x.com/harvey/followers');
});

test('核对前恢复自动扫描仍先打开本人资料，拒绝无效列表和已完成自动续采', async () => {
  const s=C.newSession('harvey',7,100); s.active=false;
  const h=harness(s);
  assert.equal((await h.send({type:'RESUME',kind:'followers',automatic:true})).ok,true);
  assert.equal(h.get().auto?.enabled,true);
  assert.equal(h.get().targetId,null);
  assert.equal(h.navigations.at(-1).url,'https://x.com/harvey');
  await h.send({type:'PROFILE',profile:{owner:'harvey',id:'99',requestedAt:Date.now()}},
    {url:'https://x.com/harvey',tab:{id:7},frameId:0});
  assert.equal(h.navigations.at(-1).url,'https://x.com/harvey/followers');
  const k=harness(actionSession());
  assert.equal((await k.send({type:'RESUME',kind:'other',automatic:true})).ok,false);
  assert.equal((await k.send({type:'RESUME',kind:'following',automatic:true})).ok,false);
  assert.equal(k.navigations.length,0);
});

test('页面控制提示只允许暂停本账号本标签页的当前粉丝轮次',async()=>{
  const s=C.newSession('harvey',7,100);s.targetId='99';
  s.auto={enabled:true,kind:'followers',mode:'scroll',runId:'run'};
  const message={type:'SCROLL_PAUSE',owner:'harvey',targetId:'99',runId:'run'};
  const sender={url:'https://x.com/harvey/followers',tab:{id:7},frameId:0};
  for(const [change,source] of [[{owner:'other'},sender],[{targetId:'88'},sender],[{runId:'old'},sender],
    [{},{...sender,tab:{id:8}}],[{},{...sender,frameId:1}],[{},{...sender,url:'https://x.com/other/followers'}]]){
    const h=harness(s);await h.send({...message,...change},source);
    assert.equal(h.get().active,true);assert.equal(h.get().auto.enabled,true);
  }
  const h=harness(s);assert.equal((await h.send(message,sender)).ok,true);
  assert.equal(h.get().active,false);assert.equal(h.get().auto.enabled,false);
  s.auto.kind='following';const k=harness(s);await k.send(message,sender);assert.equal(k.get().active,true);
});

test('页面心跳与资料响应同步更新本人头像至会话', async () => {
  const s = actionSession();
  s.avatarUrl = null;
  const h = harness(s);
  const sender = { url: 'https://x.com/harvey/following', tab: { id: 7 }, frameId: 0 };
  const tick = { type: 'AUTO_TICK', owner: 'harvey', pathname: '/harvey/following', visible: true,
    avatarUrl: 'https://pbs.twimg.com/profile_images/tick/avatar.jpg' };
  await h.send(tick, sender);
  assert.equal(h.get().avatarUrl, 'https://pbs.twimg.com/profile_images/tick/avatar.jpg');
});
