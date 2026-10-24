const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('一次后台通信失败后仍调度轮询，并取消未确认的请求', async () => {
  const timers = [], controls = [];
  let ticks = 0;
  const ctx = vm.createContext({
    location: { origin: 'https://x.com', pathname: '/harvey/following' },
    document: { hidden: false, querySelector: () => ({ getAttribute: () => '/harvey' }), addEventListener() {} },
    MutationObserver: class { observe() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    fetch: async () => ({}), addEventListener() {}, postMessage: message => controls.push(message),
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
      if (message.type === 'AUTO_TICK') {
        ticks++;
        if (ticks === 1) throw new Error('临时通信失败');
      }
      return { ok: true, data: { enabled: false, request: null } };
    } } }
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8'), ctx);
  await timers.shift().fn();
  assert.equal(timers.length, 1, '失败后仍须安排下一轮轮询');
  assert.equal(controls.at(-1).type, 'CANCEL_REQUEST');
  await timers.shift().fn();
  assert.equal(ticks, 2);
});
test('页面伪造写命令或结果、其他扩展的消息不能发起关注请求', async () => {
  const listeners = {}, calls = [];
  let runtimeListener;
  const ctx = vm.createContext({ URL, URLSearchParams, Headers, AbortController, Date,
    location: { origin: 'https://x.com', pathname: '/harvey/following' },
    document: { hidden: false, querySelector: () => ({ getAttribute: () => '/harvey' }), addEventListener() {} },
    MutationObserver: class { observe() {} }, setTimeout() {}, clearTimeout() {},
    fetch: async (...args) => { calls.push(args); return { status: 200 }; },
    addEventListener: (name, fn) => { listeners[name] = fn; }, postMessage() {},
    chrome: { runtime: { id: 'ours', onMessage: { addListener: fn => { runtimeListener = fn; } },
      sendMessage: async () => ({ ok: true }) } }
  });
  ctx.window = ctx;
  for (const file of ['friendship.js', 'content.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'), ctx);
  const request = { owner: 'harvey', ownerId: '99', userId: '1', action: 'unfollow', requestId: 'forged', issuedAt: Date.now() };
  for (const type of ['FRIENDSHIP', 'FRIENDSHIP_RESULT', 'AUTH_TEMPLATE']) {
    listeners.message({ source: vm.runInContext('window', ctx), origin: 'https://x.com',
      data: { source: 'x-follow-filter:v1', type, request, owner: 'harvey', requestId: 'forged', headers: [] } });
  }
  runtimeListener({ type: 'FRIENDSHIP', request }, { id: 'other' }, () => assert.fail('不可接受外部扩展消息'));
  runtimeListener({ type: 'FRIENDSHIP', request }, { id: 'ours', tab: { id: 7 } }, () => assert.fail('不可接受网页来源'));
  assert.equal(calls.length, 0);
  assert.equal(ctx.__xffFriendship, undefined);
});

function requestHarness(replayable = true, kind = 'following') {
  const timers = [], controls = [], messages = [], listeners = {}, documentListeners = {};
  let runtimeListener, resolveTick, pause, pauseReply={ok:true};
  const scrolls=[],overlay={visible:false,show:data=>{overlay.visible=true;overlay.data=data;},hide:()=>{overlay.visible=false;}};
  const ctx = vm.createContext({ Date,
    location: { origin: 'https://x.com', pathname: '/harvey/'+kind },
    document: { hidden: false, querySelector: () => ({ getAttribute: () => '/harvey' }),
      addEventListener: (name, fn) => { documentListeners[name] = fn; } },
    scrollBy: options => scrolls.push(options),
    XFFOverlay: {create: options => {pause=options.onPause;return overlay;}},
    MutationObserver: class { observe() {} },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    fetch: async () => ({}), addEventListener: (name, fn) => { listeners[name] = fn; },
    postMessage: message => controls.push(message),
    chrome: { runtime: { id: 'ours', onMessage: { addListener: fn => { runtimeListener = fn; } },
      sendMessage: message => { messages.push(message); return message.type === 'AUTO_TICK'
        ? new Promise(resolve => { resolveTick = resolve; }) : Promise.resolve(message.type==='SCROLL_PAUSE'?pauseReply:{ok:true}); } } }
  });
  ctx.window=ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8'),ctx);
  listeners.message({source:vm.runInContext('window',ctx),origin:'https://x.com',data:{source:'x-follow-filter:v1',type:'PAGE',
    page:{owner:'harvey',kind,targetId:'99',replayable}}});
  return {ctx,timers,controls,messages,listeners,documentListeners,scrolls,overlay,
    pause:()=>pause(),failPause:()=>{pauseReply=null;},
    cancel:()=>runtimeListener({type:'CANCEL_REQUEST'},{id:'ours'},()=>{}),
    reply: (change={})=>resolveTick({ok:true,data:{enabled:true,runId:'run',request:{owner:'harvey',targetId:'99',kind,
      cursor:'next',requestId:'run:1',runId:'run',issuedAt:Date.now()},...change}})};
}
test('关注 API 授权转发到分页执行器，不滚动、不显示控制提示',async()=>{
  const h=requestHarness();const tick=h.timers.shift()();h.reply();await tick;
  assert.equal(h.messages.at(-1).ready.kind,'following');
  assert.equal(h.scrolls.length,0);assert.equal(h.overlay.visible,false);
  assert.equal(h.controls.filter(m=>m.type==='REQUEST_PAGE').length,1);
  assert.equal(h.controls.at(-1).request.cursor,'next');
});
test('没有可重放模板不能准备或执行关注请求',async()=>{
  const h=requestHarness(false);const tick=h.timers.shift()();
  assert.equal(h.messages.at(-1).ready,null);h.reply();await tick;
  assert.equal(h.controls.some(m=>m.type==='REQUEST_PAGE'),false);
});
test('等待回复期间暂停、隐藏、离开或换号后丢弃关注请求授权',async()=>{
  for(const change of [h=>h.cancel(),h=>{h.ctx.document.hidden=true;h.documentListeners.visibilitychange();},
    h=>{h.ctx.location.pathname='/harvey/followers';},h=>{h.ctx.document.querySelector=()=>({getAttribute:()=>'/other'});},h=>h.listeners.pagehide()]){
    const h=requestHarness();const tick=h.timers.shift()();change(h);h.reply();await tick;
    assert.equal(h.controls.some(m=>m.type==='REQUEST_PAGE'),false);
  }
});
test('忽略旧滚动授权、停用状态及身份、轮次或时效不符的请求',async()=>{
  const request={owner:'harvey',targetId:'99',kind:'following',cursor:'next',requestId:'run:1',runId:'run',issuedAt:Date.now()};
  for(const change of [{enabled:false},{request:null,scroll:request},{runId:'old'},
    ...[{owner:'other'},{kind:'followers'},{targetId:'88'},{issuedAt:Date.now()-10000}].map(p=>({request:{...request,...p}}))]){
    const h=requestHarness();const tick=h.timers.shift()();h.reply(change);await tick;
    assert.equal(h.controls.some(m=>m.type==='REQUEST_PAGE'),false);
  }
});

function replyScroll(h,change={}){
  h.reply({request:null,scroll:{owner:'harvey',targetId:'99',kind:'followers',runId:'run',issuedAt:Date.now()},...change});
}
test('粉丝原生首屏无需请求模板即可滚动并显示控制提示，暂停后隐藏',async()=>{
  const h=requestHarness(false,'followers');const tick=h.timers.shift()();replyScroll(h);await tick;
  assert.equal(h.scrolls.length,1);assert.equal(h.overlay.visible,true);
  assert.equal(h.overlay.data.owner,'harvey');assert.equal(h.controls.some(m=>m.type==='REQUEST_PAGE'),false);
  const waiting=h.timers.shift()();await h.pause();replyScroll(h);await waiting;
  assert.equal(h.scrolls.length,1);assert.equal(h.overlay.visible,false);
  assert.equal(h.messages.find(m=>m.type==='SCROLL_PAUSE').runId,'run');
});
test('粉丝忽略旧 API 请求授权；隐藏或取消后不执行迟到滚动',async()=>{
  const api=requestHarness(true,'followers');const t=api.timers.shift()();api.reply();await t;
  assert.equal(api.controls.some(m=>m.type==='REQUEST_PAGE'),false);
  for(const change of [h=>h.cancel(),h=>{h.ctx.document.hidden=true;h.documentListeners.visibilitychange();},
    h=>{h.ctx.location.pathname='/harvey/following';},h=>h.listeners.pagehide()]){
    const h=requestHarness(false,'followers');const tick=h.timers.shift()();change(h);replyScroll(h);await tick;
    assert.equal(h.scrolls.length,0);assert.equal(h.overlay.visible,false);
  }
});
test('提示层暂停通信失败保留重试入口，同轮不再滚动；采集停止移除提示',async()=>{
  const h=requestHarness(false,'followers');const tick=h.timers.shift()();replyScroll(h);await tick;
  h.failPause();await h.pause();assert.match(h.overlay.data.error,/重试/);
  const next=h.timers.shift()();replyScroll(h);await next;assert.equal(h.scrolls.length,1);
  const ended=h.timers.shift()();h.reply({enabled:false,request:null});await ended;assert.equal(h.overlay.visible,false);
});
