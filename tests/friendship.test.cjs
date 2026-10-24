const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = path.join(__dirname, '../extension/friendship.js');
function harness(options = {}) {
  let owner = 'harvey';
  const calls = [], waits = [];
  const verification = { status: 200, body: { relationship: { source: { id_str: '99', following: false }, target: { id_str: '1' } } } };
  const verificationReplies = [];
  const reply = { status: 200, body: { id_str: '1', following: false, follow_request_sent: false } };
  const template = { headers: new Headers({ authorization: 'Bearer test-only', 'x-csrf-token': 'test-csrf' }) };
  const ctx = vm.createContext({ URL, URLSearchParams, Headers, AbortController, setTimeout: options.timeout ? (fn, ms) => setTimeout(fn, ms === 6000 ? 0 : ms) : setTimeout, clearTimeout, Date,
    location: { origin: 'https://x.com', pathname: '/harvey/following' } });
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  const execute = ctx.XFFFriendship?.createExecutor({ owner: () => owner,
    template: () => template, sleep: async ms => { waits.push(ms); options.onWait?.(); }, fetch: async (url, options) => {
      calls.push({ url, options });
      const selected = options.method === 'GET' ? (verificationReplies.shift() || verification) : reply;
      if (selected.fail) throw new Error('查询断线');
      if (selected.pending) await selected.pending;
      if (options.method === 'GET') return { status: selected.status, json: async () => selected.body };
      if (reply.fail) throw new Error('断线');
      if (reply.pending) await reply.pending;
      return { status: reply.status, json: async () => reply.body };
    } });
  return { execute, calls, waits, reply, verification, verificationReplies, template, setOwner: value => { owner = value; } };
}
const request = (extra = {}) => ({ owner: 'harvey', ownerId: '99', userId: '1', action: 'unfollow', requestId: 'a1', issuedAt: Date.now(), ...extra });
test('取关只发单个同源 POST，目标 ID 固定且返回最小确认信息', async () => {
  const h = harness();
  assert.equal(typeof h.execute, 'function');
  const result = await h.execute(request());
  assert.equal(result.status, 'not_following');
  assert.equal(result.userId, '1');
  assert.equal(h.calls[0].url, 'https://x.com/i/api/1.1/friendships/destroy.json');
  assert.equal(h.calls[0].options.method, 'POST');
  assert.equal(new URLSearchParams(h.calls[0].options.body).get('user_id'), '1');
  assert.equal(JSON.stringify(result).includes('test-only'), false);
});
test('关注与私密账号待批准分别确认，不把 HTTP 200 直接当作成功', async () => {
  const h = harness(); h.reply.body.following = true;
  assert.equal((await h.execute(request({ action: 'follow' }))).status, 'following');
  h.reply.body.following = false; h.reply.body.follow_request_sent = true;
  assert.equal((await h.execute(request({ action: 'follow', requestId: 'a2' }))).status, 'requested');
  h.reply.body = { id_str: '999', following: true };
  assert.equal((await h.execute(request({ action: 'follow', requestId: 'a3' }))).status, 'unknown');
});
test('身份不符、目标非法、凭证缺失或过期命令均不发送写请求', async () => {
  for (const extra of [{ owner: 'other' }, { userId: '99' }, { userId: '../evil' },
    { action: 'delete' }, { issuedAt: Date.now() - 10000 }]) {
    const h = harness(); assert.equal((await h.execute(request(extra))).ok, false);
    assert.equal(h.calls.length, 0);
  }
  const h = harness(); h.template.headers.delete('x-csrf-token');
  assert.equal((await h.execute(request())).ok, false);
  assert.equal(h.calls.length, 0);
});
test('限流与权限错误保留可重试失败，网络中断标为待核对且不重试', async () => {
  for (const status of [401, 403, 429]) {
    const h = harness(); h.reply.status = status;
    const result = await h.execute(request());
    assert.equal(result.ok, false); assert.equal(result.status, 'failed');
    assert.equal(h.calls.length, 1);
  }
  const h = harness(); h.reply.fail = true;
  assert.equal((await h.execute(request())).status, 'unknown');
  await h.execute(request());
  assert.equal(h.calls.length, 1, '同一操作标识不得重复发送');
});
test('请求期间切换账号或重复点击不会报告错误账号的成功结果', async () => {
  const h = harness(); let finish;
  h.reply.pending = new Promise(resolve => { finish = resolve; });
  const first = h.execute(request());
  assert.equal((await h.execute(request({ requestId: 'a2' }))).ok, false);
  h.setOwner('other'); finish();
  assert.equal((await first).status, 'unknown');
  assert.equal(h.calls.length, 1);
});

test('独立复核只发无缓存 GET，核对双 ID 后返回验证时间', async () => {
  const h = harness();
  const result = await h.execute(request({ action: 'verify_unfollow' }));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'not_following');
  assert.ok(Number.isFinite(result.verifiedAt));
  assert.equal(result.userId, '1');
  assert.deepEqual(h.waits, [1000]);
  assert.equal(h.calls.length, 1);
  const {url, options} = h.calls[0];
  assert.equal(new URL(url).pathname, '/i/api/1.1/friendships/show.json');
  assert.equal(new URL(url).searchParams.get('source_id'), '99');
  assert.equal(new URL(url).searchParams.get('target_id'), '1');
  assert.equal(options.method, 'GET');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.body, undefined);
});
test('复核等待关系同步，最多三次，始终不重复写入', async () => {
  const h = harness();
  const following = { status: 200, body: { relationship: { source: { id_str: '99', following: true }, target: { id_str: '1' } } } };
  h.verificationReplies.push(following, following);
  assert.equal((await h.execute(request({ action: 'verify_unfollow' }))).status, 'not_following');
  assert.deepEqual(h.waits, [1000, 3000, 3000]);
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every(c => c.options.method === 'GET'));
  h.verification.body = following.body;
  const result = await h.execute(request({ action: 'verify_unfollow', requestId: 'v2' }));
  assert.equal(result.status, 'following');
  assert.ok(Number.isFinite(result.verifiedAt));
  assert.equal(h.calls.length, 6);
});
test('复核缺失字段、反向 ID 和接口错误绝不确认已取关', async () => {
  for (const body of [{}, {errors: [{}]},
    { relationship: {source: {id_str:'99'}, target: {id_str:'1', following:false}} },
    { relationship: {source: {id_str:'1', following:false}, target: {id_str:'99'}} },
    { relationship: {source: {id_str:'99', following:false, following_requested:true}, target: {id_str:'1'}} }]) {
    const h = harness(); h.verification.body = body;
    assert.equal((await h.execute(request({action:'verify_unfollow'}))).status, 'unknown');
    assert.equal(h.calls.length, 3);
  }
});
test('查询限流或鉴权失败立即停止，网络失败与超时只有限重试', async () => {
  for (const status of [401,403,429]) {
    const h=harness();h.verification.status=status;
    assert.equal((await h.execute(request({action:'verify_unfollow'}))).status,'unknown');
    assert.equal(h.calls.length,1);
  }
  for (const failure of ['network','timeout']) {
    const h=harness({timeout:true});
    if(failure==='network')h.verification.fail=true;
    else h.verification.pending=new Promise(()=>{});
    assert.equal((await h.execute(request({action:'verify_unfollow'}))).status,'unknown');
    assert.equal(h.calls.length,3);
  }
});
test('复核等待及响应期间切换账号不发下一次请求、不确认成功', async () => {
  const h=harness({onWait:()=>h.setOwner('other')});
  assert.equal((await h.execute(request({action:'verify_unfollow'}))).status,'unknown');
  assert.equal(h.calls.length,0);
  const k=harness();let finish;
  k.verification.pending=new Promise(resolve=>{finish=resolve;});
  const result=k.execute(request({action:'verify_unfollow'}));
  await new Promise(resolve=>setImmediate(resolve));
  k.setOwner('other');finish();
  assert.equal((await result).status,'unknown');
  assert.equal(k.calls.length,1);
});
