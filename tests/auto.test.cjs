const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const file = require('node:path').join(__dirname, '../extension/auto.js');
const A = fs.existsSync(file) ? require(file) : {};
const C = require('../extension/core');
function state() {
  return { ...C.newSession('harvey', 7, 100), targetId: '99',
    auto: { enabled: true, runId: 'run', kind: 'following', status: 'running', lastProgressAt: 100, count: 0 } };
}
const tick = { owner: 'harvey', pathname: '/harvey/following', visible: true, ready: { kind: 'following', targetId: '99' } };
test('只有绑定账号、标签页和列表全部匹配时允许自动请求', () => {
  assert.equal(typeof A.decide, 'function');
  assert.equal(A.decide(state(), tick, 7, 200).request != null, true);
  assert.equal(A.decide(state(), tick, 8, 200).request, null);
  assert.equal(A.decide(state(), { ...tick, owner: 'other' }, 7, 200).request, null);
  assert.equal(A.decide({ ...state(), active: false }, tick, 7, 200).request, null);
  assert.equal(A.decide({ ...state(), targetId: null }, tick, 7, 200).request, null);
});
test('连续一分钟无新用户则停止，不能标记为完整', () => {
  const result = A.decide(state(), tick, 7, 60101);
  assert.equal(result.request, null);
  assert.equal(result.state.auto.status, 'stalled');
  assert.equal(result.state.auto.enabled, false);
  assert.equal(result.state.lists.following.complete, false);
});
test('取得完整分页证据后自动停止并显示完成', () => {
  const s = state(); s.lists.following.complete = true;
  const result = A.decide(s, tick, 7, 200);
  assert.equal(result.request, null);
  assert.equal(result.state.auto.status, 'complete');
});
test('新用户进展刷新等待窗口，重复同一页不刷新', () => {
  const s = state(); s.lists.following.users['1'] = { id: '1' };
  const next = A.progress(s, 50000);
  assert.equal(next.auto.lastProgressAt, 50000);
  assert.equal(A.progress(next, 60000).auto.lastProgressAt, 50000);
  assert.equal(A.decide(next, tick, 7, 60101).request != null, true);
});
test('离开列表或切换到后台标签页会停止自动请求', () => {
  for (const change of [{ pathname: '/harvey/followers' }, { pathname: '/other/following' }, { visible: false }]) {
    const result = A.decide(state(), { ...tick, ...change }, 7, 200);
    assert.equal(result.request, null);
    assert.equal(result.state.auto.enabled, false);
    assert.equal(result.state.auto.status, 'stopped');
  }
});
test('等待账号核对时不滚动、不误报无进展，核对后重新计时', () => {
  const s = state(); s.targetId = null; s.auto.status = 'waiting';
  assert.equal(A.decide(s, { ...tick, pathname: '/harvey' }, 7, 70000).state.auto.enabled, true);
  s.targetId = '99';
  const result = A.decide(s, tick, 7, 80000);
  assert.equal(result.request != null, true);
  assert.equal(result.state.auto.lastProgressAt, 80000);
});
test('核对完成后正在跳转关注列表时，不被旧资料页的轮询停止', () => {
  const s = state(); s.auto.status = 'waiting';
  const result = A.decide(s, { ...tick, pathname: '/harvey' }, 7, 200);
  assert.equal(result.request, null);
  assert.equal(result.state.auto.enabled, true);
  assert.equal(A.decide(s, { ...tick, pathname: '/harvey' }, 7, 16000).state.auto.enabled, false);
});
test('页面身份入口加载较慢时先等待，30 秒仍未识别才停止', () => {
  const first = A.decide(state(), { ...tick, owner: null }, 7, 2000);
  assert.equal(first.request, null);
  assert.equal(first.state.auto.enabled, true);
  const ready = A.decide(first.state, tick, 7, 5000);
  assert.equal(ready.request != null, true);
  assert.equal(A.decide(first.state, { ...tick, owner: null }, 7, 32000).state.auto.enabled, false);
});

test('分页沿连续游标链补齐缺页，单次只授权一个请求', () => {
  const s = state();
  s.lists.following.pages.root = { nextCursor: 'next', terminal: false };
  const first = A.decide(s, tick, 7, 200);
  assert.equal(first.request.cursor, 'next');
  assert.equal(first.request.targetId, '99');
  assert.equal(first.request.kind, 'following');
  assert.equal(A.decide(first.state, tick, 7, 5000).request, null);
  assert.equal(A.decide(first.state, tick, 7, 21000).state.auto.status, 'error');
});
test('无模板时等待，模板属于其他目标或列表也不授权', () => {
  for (const ready of [null, { kind: 'followers', targetId: '99' }, { kind: 'following', targetId: '777' }]) {
    assert.equal(A.decide(state(), { ...tick, ready }, 7, 200).request, null);
  }
});
test('无末页证据或循环游标立即停止，不循环请求', () => {
  for (const pages of [ { root: { nextCursor: null, terminal: false } },
    { root: { nextCursor: 'a' }, 'cursor:a': { nextCursor: 'a' } } ]) {
    const s = state(); s.lists.following.pages = pages;
    const result = A.decide(s, tick, 7, 200);
    assert.equal(result.request, null);
    assert.equal(result.state.auto.status, 'error');
    assert.equal(result.state.lists.following.complete, false);
  }
});
test('每次发起请求至少间隔三秒，错误停止后清除待响应标记', () => {
  const s = state(); s.auto.lastRequestAt = 100;
  assert.equal(A.decide(s, tick, 7, 200).request, null);
  const result = A.decide(s, tick, 7, 3100);
  assert.ok(result.request);
  assert.equal(A.stop(result.state).auto.pending, null);
});

test('无新增页计数只针对自动分页，有新增时重置，明确末页优先完成', () => {
  let s = state();
  const page = { requestId: 'run:1', kind: 'following' };
  s = A.received(s, page, 200);
  assert.equal(s.auto.noNewPages, 1);
  s = A.received(s, page, 300);
  assert.equal(s.auto.noNewPages, 2);
  s.lists.following.users['1'] = { id: '1' };
  s = A.received(s, page, 400);
  assert.equal(s.auto.noNewPages, 0);
  assert.equal(s.auto.lastProgressAt, 400);
  s = A.received(s, { kind: 'following' }, 500);
  assert.equal(s.auto.noNewPages, 0);
  s = A.received(s, { ...page, kind: 'followers' }, 600);
  assert.equal(s.auto.noNewPages, 0);
  s.auto.noNewPages = 2;
  s.lists.following.complete = true;
  s = A.received(s, page, 700);
  assert.equal(s.auto.status, 'complete');
  assert.equal(s.auto.enabled, false);
});

test('切换到粉丝列表期间旧页面轮询不误停，跳转超时仍停止', () => {
  const s=state();s.auto={...s.auto,kind:'followers',status:'waiting',navigationFrom:'/harvey/following'};
  assert.equal(A.decide(s,tick,7,200).state.auto.enabled,true);
  assert.equal(A.decide(s,tick,7,16000).state.auto.enabled,false);
  s.lists.followers.pages.root = { nextCursor: 'next' };
  const ready=A.decide(s,{...tick,pathname:'/harvey/followers',ready:{kind:'followers',targetId:'99'}},7,300);
  assert.equal(ready.request,null);
  assert.equal(ready.scroll.kind,'followers');
  assert.equal(ready.state.auto.status,'running');
});

test('粉丝页存在无法解析账号时仍沿有效游标获取后续页，末页后保留不完整提示', () => {
  let s = state(); s.auto.kind = 'followers';
  const followersTick = {...tick,pathname:'/harvey/followers',ready:{kind:'followers',targetId:'99'}};
  s = C.acceptPage(s, {owner:'harvey',targetId:'99',kind:'followers',cursor:null,
    users:[{id:'1',username:'one'}],unreadable:1,nextCursor:'next',terminal:false},7,200);
  const next = A.decide(s,followersTick,7,300);
  assert.equal(next.request,null);
  assert.equal(next.scroll.kind,'followers');
  s = C.acceptPage(next.state, {owner:'harvey',targetId:'99',kind:'followers',cursor:'next',
    users:[{id:'2',username:'two'}],unreadable:0,nextCursor:null,terminal:true},7,400);
  s = A.received(s,{kind:'followers'},400);
  const ended = A.decide(s,followersTick,7,500);
  assert.equal(ended.request,null);
  assert.equal(ended.state.auto.enabled,false);
  assert.equal(ended.state.auto.status,'partial');
  assert.equal(ended.state.lists.followers.complete,false);
  assert.equal(Object.keys(ended.state.lists.followers.users).length,2);
  assert.match(ended.state.auto.message,/末页.*无法解析/);
});

const followersTick = { ...tick, pathname: '/harvey/followers', ready: { kind: 'followers', targetId: '99' } };
function followersState() {
  const s = A.start(state(), 'followers', 100);
  s.lists.followers.pages.root = { nextCursor: 'next' };
  return s;
}
test('粉丝自动采集等待首屏后授权滚动，间隔三秒且不重放请求', () => {
  const s = followersState();
  assert.equal(s.auto.mode,'scroll');
  const first=A.decide(s,followersTick,7,200);
  assert.equal(first.request,null);
  assert.equal(first.scroll.kind,'followers');
  assert.equal(first.scroll.owner,'harvey');
  assert.equal(A.decide(first.state,followersTick,7,3199).scroll,null);
  assert.ok(A.decide(first.state,followersTick,7,3200).scroll);
  delete s.lists.followers.pages.root;
  assert.equal(A.decide(s,followersTick,7,200).scroll,null);
});
test('粉丝滚动遵守身份、路由、标签页、可见性和暂停限制',()=>{
  for(const change of [{owner:'other'},{visible:false},{pathname:'/harvey/following'},{pathname:'/other/followers'},
    {ready:null},{ready:{kind:'followers',targetId:'88'}}]){
    const result=A.decide(followersState(),{...followersTick,...change},7,200);
    assert.equal(result.request,null);assert.equal(result.scroll,null);
  }
  assert.equal(A.decide(followersState(),followersTick,8,200).scroll,null);
  assert.equal(A.decide({...followersState(),active:false},followersTick,7,200).scroll,null);
  assert.equal(A.decide(A.stop(followersState()),followersTick,7,200).scroll,null);
});
test('旧粉丝 API 会话切换为滚动，清除旧请求并保留名单',()=>{
  const s=followersState();s.auto.mode='request';s.auto.pending={issuedAt:100};
  const result=A.decide(s,followersTick,7,25000);
  assert.equal(result.state.auto.mode,'scroll');assert.equal(result.state.auto.pending,null);
  assert.equal(result.request,null);assert.equal(result.scroll.kind,'followers');
  assert.equal(result.state.lists,s.lists);
});
test('粉丝原生响应连续三页无新增或一分钟无进展则停止，不冒充完整',()=>{
  let s=followersState();
  for(let i=1;i<=3;i++)s=A.received(s,{kind:'followers'},i*1000);
  assert.equal(s.auto.status,'stalled');assert.equal(s.lists.followers.complete,false);
  assert.equal(A.decide(followersState(),followersTick,7,60100).state.auto.status,'stalled');
});
test('恢复粉丝滚动可经过旧快照账号，本轮重复页仍停止，完整末页优先完成',()=>{
  let s=followersState();
  for(let id=1;id<=5;id++)s.lists.followers.users[id]={id:String(id),username:`u${id}`};
  s=A.start(s,'followers',100);
  for(let id=1;id<=5;id++){
    s=A.received(s,{kind:'followers',users:[s.lists.followers.users[id]]},id*30000);
    assert.equal(s.auto.enabled,true);assert.equal(s.auto.lastProgressAt,id*30000);
  }
  for(let i=0;i<3;i++)s=A.received(s,{kind:'followers',users:[s.lists.followers.users['5']]},151000+i);
  assert.equal(s.auto.status,'stalled');assert.equal(s.lists.followers.complete,false);
  s=A.start(s,'followers',152000);s.lists.followers.complete=true;
  s=A.received(s,{kind:'followers'},152100);
  assert.equal(s.auto.status,'complete');assert.equal(A.decide(s,followersTick,7,153000).scroll,null);
});

test('粉丝滚动到达末尾页面底部且无新增时，即判定采集结束并关闭滚动', () => {
  const s = followersState();
  s.auto.lastProgressAt = 1000;
  const result = A.decide(s, { ...followersTick, atBottom: true }, 7, 7000);
  assert.equal(result.scroll, null);
  assert.equal(result.state.auto.status, 'complete');
  assert.equal(result.state.auto.enabled, false);
  assert.equal(result.state.lists.followers.complete, true);
});

test('粉丝接口返回后续空页时，即判定采集结束并标记完整', () => {
  let s = followersState();
  s = A.received(s, { kind: 'followers', cursor: 'next', users: [] }, 2000);
  assert.equal(s.auto.status, 'complete');
  assert.equal(s.auto.enabled, false);
  assert.equal(s.lists.followers.complete, true);
});
