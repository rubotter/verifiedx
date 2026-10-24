const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = fs.readFileSync(path.join(__dirname, '../extension/core.js'), 'utf8');
const capturePath = path.join(__dirname, '../extension/capture.js');
const capture = fs.existsSync(capturePath) ? fs.readFileSync(capturePath, 'utf8') : '';
const url = 'https://x.com/i/api/graphql/hash/Following?variables=' + encodeURIComponent(JSON.stringify({ userId: '99' }));
const profileUrl = 'https://x.com/i/api/graphql/hash/UserByScreenName?variables=' + encodeURIComponent(JSON.stringify({ screen_name: 'harvey' }));
const body = { data: { user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
  { entryId: 'user-1', content: { itemContent: { user_results: { result: { __typename: 'User', rest_id: '1',
    legacy: { screen_name: 'alice', name: 'Alice', followed_by: false }, is_blue_verified: false } } } } }
] }] } } } } } };
function harness(owner = 'harvey', route = '/harvey/following') {
  const messages = [], calls = [], listeners = {};
  let currentOwner = owner;
  const response = { ok: true, status: 200, profileStatus: 200, clone: () => ({ json: async () => body }) };
  class XHR {
    constructor() { this.handlers = []; this.status = 200; this.responseType = ''; this.responseText = JSON.stringify(body); }
    open() {}
    setRequestHeader() {}
    send() { for (const fn of this.handlers.splice(0)) fn(); }
    addEventListener(event, fn) { if (event === 'load') this.handlers.push(fn); }
  }
  const ctx = vm.createContext({ URL, JSON, Date, Set, WeakMap, Map, Promise, Headers, Request, AbortController, setTimeout, clearTimeout, console, XMLHttpRequest: XHR,
    location: { href: 'https://x.com' + route, pathname: route, origin: 'https://x.com' },
    document: { querySelector: () => ({ getAttribute: () => '/' + currentOwner }) },
    addEventListener: (event, fn) => { (listeners[event] ||= []).push(fn); },
    fetch: async (input, init) => { calls.push({ input, init }); if (response.pending) return response.pending; return String(input?.url || input).includes('UserByScreenName') ? { status: response.profileStatus, clone: () => ({ json: async () => ({
      data: { user: { result: { __typename: 'User', rest_id: '99', core: { screen_name: 'harvey', name: '本人' } } } }
    }) }) } : response; }, postMessage: message => messages.push(message) });
  ctx.window = ctx;
  vm.runInContext(core, ctx);
  vm.runInContext(capture, ctx);
  return { ctx, messages, response, calls, command: data => { for (const fn of listeners.message || []) fn({ source: vm.runInContext('window', ctx), origin: 'https://x.com', data: { source: 'x-follow-filter:control:v1', ...data } }); }, setOwner: value => { currentOwner = value; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('网页消息不能读取认证模板或触发关注写请求', async () => {
  const h = harness();
  await h.ctx.fetch(url, { headers: { authorization: 'Bearer private-test', 'x-csrf-token': 'csrf-private-test' } });
  await tick();
  h.messages.length = 0;
  for (const type of ['READ_AUTH_TEMPLATE', 'FRIENDSHIP']) h.command({ type, owner: 'harvey', ownerId: '99', userId: '1', action: 'unfollow' });
  await tick();
  assert.equal(h.messages.length, 0);
  assert.equal(h.calls.length, 1);
});
async function bind(h) { await h.ctx.fetch(profileUrl); await tick(); h.messages.length = 0; }
test('页面 fetch 原始响应保持不变，同时转发最小化用户数据', async () => {
  const h = harness();
  await bind(h);
  assert.equal(await h.ctx.fetch(url), h.response);
  await tick();
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].page.users[0].id, '1');
  assert.equal(h.messages[0].page.owner, 'harvey');
  assert.equal('legacy' in h.messages[0].page.users[0], false);
});
test('浏览他人列表不采集', async () => {
  const h = harness('harvey', '/other/following');
  await h.ctx.fetch(url); await tick();
  assert.equal(h.messages.length, 0);
});
test('账号在请求期间切换，丢弃旧响应', async () => {
  const h = harness();
  const promise = h.ctx.fetch(url);
  h.setOwner('other');
  await promise; await tick();
  assert.equal(h.messages.length, 0);
});
test('忽略无关网络响应', async () => {
  const h = harness();
  await h.ctx.fetch('https://x.com/i/api/graphql/hash/HomeTimeline'); await tick();
  assert.equal(h.messages.length, 0);
});
test('XHR 列表响应也可被动采集', async () => {
  const h = harness();
  await bind(h);
  const xhr = new h.ctx.XMLHttpRequest();
  xhr.open('GET', url); xhr.send(); await tick();
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].page.users[0].id, '1');
});
test('限流响应提示错误而不是伪装成空列表', async () => {
  const h = harness();
  h.response.status = 429;
  await h.ctx.fetch(url); await tick();
  assert.equal(h.messages[0].type, 'ISSUE');
  assert.match(h.messages[0].message, /限制/);
});
test('新的列表文档无需再次加载资料，数字 ID 交由后台核对', async () => {
  const h = harness();
  await h.ctx.fetch(url); await tick();
  assert.equal(h.messages.length, 1);
  await h.ctx.fetch(profileUrl); await tick();
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[0].type, 'PAGE');
  assert.equal(h.messages[1].type, 'PROFILE');
});
test('转发保留列表目标 ID，后台能够拒绝其他账号的预加载', async () => {
  const h = harness();
  const other = url.replace(encodeURIComponent('99'), encodeURIComponent('777'));
  await h.ctx.fetch(other); await tick();
  await h.ctx.fetch(profileUrl); await tick();
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[0].page.targetId, '777');
  assert.equal(h.messages[1].profile.id, '99');
});
test('本人资料请求被限流时发送可见错误，避免无限核对', async () => {
  const h = harness('harvey', '/harvey');
  h.response.profileStatus = 429;
  await h.ctx.fetch(profileUrl); await tick();
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, 'ISSUE');
  assert.match(h.messages[0].message, /限制/);
});

const command = (extra = {}) => ({ type: 'REQUEST_PAGE', request: { owner: 'harvey', targetId: '99',
  kind: 'following', cursor: 'next', requestId: 'run:1', runId: 'run', issuedAt: Date.now(), ...extra } });
test('捕获 fetch 模板后主动请求下一页，保留参数和请求头且不转发凭证', async () => {
  const h = harness();
  await h.ctx.fetch(new Request(url + '&features=%7B%22test%22%3Atrue%7D', {
    headers: { authorization: 'Bearer test-only', 'x-csrf-token': 'test-csrf' }
  })); await tick();
  assert.equal(h.messages[0].page.replayable, true);
  h.command(command()); await tick();
  assert.equal(h.calls.length, 2);
  const request = h.calls[1];
  const parsed = new URL(request.input);
  assert.equal(JSON.parse(parsed.searchParams.get('variables')).cursor, 'next');
  assert.equal(JSON.parse(parsed.searchParams.get('variables')).userId, '99');
  assert.equal(parsed.searchParams.get('features'), '{"test":true}');
  assert.equal(new Headers(request.init.headers).get('authorization'), 'Bearer test-only');
  assert.equal(request.init.credentials, 'include');
  assert.equal(h.messages.at(-1).page.requestId, 'run:1');
  assert.equal(JSON.stringify(h.messages).includes('test-only'), false);
});
test('XHR 捕获的请求头也能用于分页', async () => {
  const h = harness(); const xhr = new h.ctx.XMLHttpRequest();
  xhr.open('GET', url); xhr.setRequestHeader('x-csrf-token', 'xhr-test'); xhr.send(); await tick();
  h.command(command()); await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(new Headers(h.calls[0].init.headers).get('x-csrf-token'), 'xhr-test');
});
test('没有模板、过期命令或目标不一致不能发送分页请求', async () => {
  const h = harness();
  h.command(command()); await tick(); assert.equal(h.calls.length, 0);
  await h.ctx.fetch(url); await tick();
  for (const extra of [{ issuedAt: Date.now() - 10000 }, { targetId: '777' }, { owner: 'other' }, { kind: 'followers' }]) {
    h.command(command(extra)); await tick();
  }
  assert.equal(h.calls.length, 1);
});
test('自动请求的限流错误带请求标识，停止前不发起重试', async () => {
  const h = harness(); await h.ctx.fetch(url); await tick();
  h.response.status = 429;
  h.command(command()); await tick();
  const issue = h.messages.at(-1);
  assert.equal(issue.type, 'ISSUE');
  assert.equal(issue.requestId, 'run:1');
  assert.match(issue.message, /限制/);
  assert.equal(h.calls.length, 2);
});
test('并发命令不重复请求，取消会中止请求并丢弃迟到响应', async () => {
  const h = harness(); await h.ctx.fetch(url); await tick();
  let finish;
  h.response.pending = new Promise(resolve => { finish = resolve; });
  h.command(command()); h.command(command({ requestId: 'run:2' })); await tick();
  assert.equal(h.calls.length, 2);
  h.command({ type: 'CANCEL_REQUEST' });
  assert.equal(h.calls[1].init.signal.aborted, true);
  finish(h.response); await tick();
  assert.equal(h.messages.length, 1);
});
test('请求期间切换账号，不发布结果；401 和 403 给出校验失败提示', async () => {
  for (const status of [401, 403]) {
    const h = harness(); await h.ctx.fetch(url); await tick();
    h.response.status = status; h.command(command()); await tick();
    assert.match(h.messages.at(-1).message, /校验失败/);
  }
  const h = harness(); await h.ctx.fetch(url); await tick();
  let finish; h.response.pending = new Promise(resolve => { finish = resolve; });
  h.command(command()); h.setOwner('other'); finish(h.response); await tick();
  assert.equal(h.messages.length, 1);
});
test('页面请求超时只发送一次错误，之后完成的响应不再发布', async () => {
  const h = harness(); await h.ctx.fetch(url); await tick();
  let timeout, finish;
  h.ctx.setTimeout = fn => { timeout = fn; return 1; };
  h.ctx.clearTimeout = () => {};
  h.response.pending = new Promise(resolve => { finish = resolve; });
  h.command(command());
  timeout();
  assert.equal(h.calls[1].init.signal.aborted, true);
  assert.equal(h.messages.filter(m => m.type === 'ISSUE').length, 1);
  finish(h.response); await tick();
  assert.equal(h.messages.filter(m => m.type === 'ISSUE').length, 1);
  assert.equal(h.messages.filter(m => m.type === 'PAGE').length, 1);
});

test('自动分页返回空的 404 时报告接口状态，不能误报为页面结构变化', async () => {
  const h = harness(); await h.ctx.fetch(url); await tick();
  h.response.status = 404;
  h.response.clone = () => ({json:async () => { throw new SyntaxError('空响应'); }});
  h.command(command()); await tick();
  const issue = h.messages.at(-1);
  assert.equal(issue.type,'ISSUE');
  assert.match(issue.message,/HTTP 404/);
  assert.match(issue.message,/分页请求/);
  assert.doesNotMatch(issue.message,/数据未能识别/);
  assert.equal(h.calls.length,2,'404 后不循环重试');
});

test('其他 HTTP 错误与成功响应的结构错误分别展示', async () => {
  for (const status of [400,500,503]) {
    const h=harness();h.response.status=status;
    await h.ctx.fetch(url);await tick();
    assert.match(h.messages.at(-1).message,new RegExp('HTTP '+status));
  }
  const h=harness();h.response.clone=()=>({json:async()=>({data:{}})});
  await h.ctx.fetch(url);await tick();
  assert.match(h.messages.at(-1).message,/HTTP 200.*结构/);
});
