const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.SMOKE_OUTPUT || path.join(root, 'work/smoke');
fs.mkdirSync(out, { recursive: true });
const extension = path.join(root, 'extension');
const user = (id, fields = {}) => ({ entryId: `user-${id}`, content: { itemContent: { itemType: 'TimelineUser',
  user_results: { result: { __typename: 'User', rest_id: id,
    core: { screen_name: `person${id}`, name: `测试用户 ${id}` }, ...fields } } } } });
const payload = (entries, end = false) => ({ data: { user: { result: { timeline: { timeline: {
  instructions: [{ type: 'TimelineAddEntries', entries }, ...(end ? [{ type: 'TimelineTerminateTimeline', direction: 'Bottom' }] : [])]
} } } } } });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地模拟 X 页面</title>
<body><a data-testid="AppTabBar_Profile_Link" href="/harvey"><img src="https://x.com/mock-avatar.png">个人资料</a><h1>本地模拟关注列表</h1>
<div style="height:1800px">用于验证滚动触发下一页</div>
<script>
window.nativeFollowerCursors = [];
window.replayControls = [];
window.addEventListener('message', event => {
 if (event.data?.source === 'x-follow-filter:control:v1' && event.data.type === 'REQUEST_PAGE') replayControls.push(event.data.request.kind);
});
let followerCursor = null;
window.loadList = async (kind = location.pathname.endsWith('/followers') ? 'Followers' : 'Following', cursor = null) => {
 const query = encodeURIComponent(JSON.stringify({ userId: '99', ...(cursor ? { cursor } : {}) }));
 if (kind === 'Followers') {
  nativeFollowerCursors.push(cursor);
  return new Promise((resolve, reject) => {
   const xhr = new XMLHttpRequest();
   xhr.open('GET', '/i/api/graphql/test/Followers?variables=' + query);
   xhr.setRequestHeader('authorization', 'Bearer smoke-only');
   xhr.setRequestHeader('x-csrf-token', 'smoke-csrf');
   xhr.setRequestHeader('x-smoke-native-page', String(nativeFollowerCursors.length));
   xhr.onload = () => {
    const body = JSON.parse(xhr.responseText || '{}');
    const entries = body.data?.user?.result?.timeline?.timeline?.instructions?.flatMap(i => i.entries || []) || [];
    followerCursor = entries.find(e => e.content?.cursorType === 'Bottom')?.content.value || null;
    resolve(body);
   };
   xhr.onerror = reject; xhr.send();
  });
 }
 return fetch('/i/api/graphql/test/' + kind + '?variables=' + query,
   { headers: { authorization: 'Bearer smoke-only', 'x-csrf-token': 'smoke-csrf' } }).then(r => r.json());
};
if (location.pathname === '/harvey') setTimeout(() => {
 fetch('/i/api/graphql/test/UserByScreenName?variables=' + encodeURIComponent(JSON.stringify({screen_name:'harvey'})));
}, 300);
if (/\\/(following|followers)$/.test(location.pathname)) setTimeout(() => loadList(), 300);
let nextLoaded = false;
window.addEventListener('scroll', () => {
 if (location.pathname.endsWith('/followers') && followerCursor && scrollY > 500) {
  const cursor = followerCursor; followerCursor = null; loadList('Followers', cursor);
 }
 if (location.pathname.endsWith('/following') && !nextLoaded && scrollY > 500) {
  nextLoaded = true; loadList('Following', 'next');
 }
});
</script></body></html>`;

(async () => {
  assert.ok(fs.existsSync(path.join(extension, 'panel.html')), '扩展应提供可操作的侧栏页面');
  const profile = fs.mkdtempSync(path.join(out, 'profile-'));
  const keyPath = path.join(profile, 'mock.key'), certPath = path.join(profile, 'mock.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath,
    '-out', certPath, '-days', '1', '-subj', '/CN=x.com'], { stdio: 'ignore' });
  let serveRequest;
  // 使用本地 HTTPS 走完整请求头事件；直接 fulfill 会跳过 webRequest 的发送阶段。
  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      await serveRequest({ request: () => ({ url: () => 'https://x.com' + req.url,
        postData: () => body, method: () => req.method, headers: () => req.headers }),
      fulfill: async reply => { res.writeHead(reply.status || 200, { 'content-type': reply.contentType }); res.end(reply.body); } });
    } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext(profile, { channel: process.env.BROWSER_CHANNEL || 'chromium', headless: true,
    viewport: { width: 390, height: 960 }, ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server',
      `--host-resolver-rules=MAP x.com 127.0.0.1:${server.address().port}, MAP * ~NOTFOUND`] });
  const errors = [];
  let profileLimited = false;
  let nextLimited = false, nextGate = null, releaseNext, threePages = false, endlessTail = false, emptyTail = false;
  const followingRequests = [], followerRequests = [];
  let detailedFollowers = false;
  let unreadableFollower = false;
  let followerNextGate = null, releaseFollowerNext, followerFailure = 0;
  const friendshipRequests = [];
  let friendshipMode = 'success', verificationMode = 'delayed';
  const verificationRequests = [];
  const relationships = new Map();
  let testPanel, testX, testWorker, cdp;
  const worlds = [];
  context.setDefaultTimeout(15000);
  context.on('page', page => page.on('pageerror', error => errors.push(error.stack || error.message)));
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === 'x.com' || url.protocol === 'chrome-extension:' ? route.continue() : route.abort();
    });
    serveRequest = async route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/mock-avatar.png') {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
        return;
      }
      if (u.pathname === '/i/api/1.1/friendships/show.json') {
        const sourceId = u.searchParams.get('source_id'), targetId = u.searchParams.get('target_id');
        verificationRequests.push({ sourceId, targetId, method: route.request().method(), at: Date.now() });
        assert.equal(sourceId, '99');
        assert.equal(route.request().method(), 'GET');
        assert.equal(route.request().headers().authorization, 'Bearer smoke-only');
        const count = verificationRequests.filter(r => r.targetId === targetId).length;
        const following = verificationMode === 'following' || (verificationMode === 'delayed' && count < 3) || relationships.get(targetId) === true;
        await route.fulfill({ status: verificationMode === 'limited' ? 429 : 200, contentType: 'application/json',
          body: JSON.stringify(verificationMode === 'unknown' ? {} : { relationship: {
            source: {id_str: sourceId, following}, target: {id_str: targetId}
          } }) });
      } else if (/^\/i\/api\/1\.1\/friendships\/(create|destroy)\.json$/.test(u.pathname)) {
        const userId = new URLSearchParams(route.request().postData()).get('user_id');
        friendshipRequests.push({ path: u.pathname, userId, method: route.request().method() });
        assert.equal(route.request().headers().authorization, 'Bearer smoke-only');
        if (friendshipMode === 'limited') {
          await route.fulfill({ status: 429, contentType: 'application/json', body: '{}' });
        } else if (friendshipMode === 'unknown') {
          await route.fulfill({ contentType: 'application/json', body: '{}' });
        } else {
          const follow = u.pathname.endsWith('/create.json');
          relationships.set(userId, follow);
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id_str: userId,
            following: follow && friendshipMode !== 'requested', follow_request_sent: follow && friendshipMode === 'requested' }) });
        }
      } else if (u.pathname.includes('/graphql/')) {
        if (profileLimited && u.pathname.endsWith('/UserByScreenName')) {
          await route.fulfill({ status: 429, contentType: 'application/json', body: '{}' });
          return;
        }
        const variables = JSON.parse(u.searchParams.get('variables'));
        if (u.pathname.endsWith('/Following')) {
          followingRequests.push({ cursor: variables.cursor || null, userId: variables.userId,
            authorization: route.request().headers().authorization, at: Date.now() });
          if (variables.cursor === 'next' && nextGate) await nextGate;
          if (variables.cursor === 'next' && nextLimited) {
            await route.fulfill({ status: 429, contentType: 'application/json', body: '{}' });
            return;
          }
        }
        if (u.pathname.endsWith('/Followers')) {
          followerRequests.push({cursor:variables.cursor || null,userId:variables.userId});
          if (variables.cursor && followerNextGate) await followerNextGate;
          if (variables.cursor && followerFailure) {
            await route.fulfill({ status: followerFailure, contentType: 'application/json', body: '' });
            return;
          }
          if (variables.cursor && route.request().headers()['x-smoke-native-page'] !== '2') {
            await route.fulfill({ status: 404, contentType: 'application/json', body: '' });
            return;
          }

        }
        let body;
        if (u.pathname.endsWith('/UserByScreenName')) body = { data: { user: { result: {
          __typename: 'User', rest_id: '99', core: { screen_name: 'harvey', name: '本人' },
          avatar: { image_url: 'https://x.com/mock-avatar.png' }
        } } } };
        else if (u.pathname.endsWith('/Followers')) {
          if (!detailedFollowers) body = payload([user('3')], true);
          else if (variables.cursor) body = payload([
            user('13', {verification:{verified_type:'Government'}, relationship_perspectives:{following:false}}),
            user('14', {verification:{verified_type:'None'}}),
            user('15', {is_blue_verified:true, legacy:{screen_name:'person15',following:false,follow_request_sent:true}}),
            user('16', {is_blue_verified:true, relationship_perspectives:{following:true}})
          ],true);
          else body = payload([
            ...(unreadableFollower ? [{entryId:'user-unavailable',content:{itemContent:{user_results:{result:{__typename:'UserUnavailable'}}}}}] : []),
            user('10', {verification:{verified_type:'None'}, relationship_perspectives:{following:false}}),
            user('11', {is_blue_verified:true, relationship_perspectives:{following:false}}),
            user('12', {verification:{verified_type:'Business'}, relationship_perspectives:{following:false}}),
            {entryId:'cursor-bottom',content:{cursorType:'Bottom',value:'followers-next'}}
          ]);
        }
        else if (emptyTail && variables.cursor) body = payload([], false);
        else if (endlessTail && variables.cursor) body = payload([
          user('1'),
          { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: variables.cursor === 'next' ? 'tail-2' : `tail-${Number(variables.cursor.split('-')[1]) + 1}` } }
        ]);
        else if (variables.cursor === 'categories') body = payload([
          user('5', { verification: { verified: true, verified_type: 'Business' }, is_blue_verified: false, relationship_perspectives: { followed_by: false } }),
          user('6', { verification: { verified: true, verified_type: 'Government' }, is_blue_verified: true, relationship_perspectives: { followed_by: true } })
        ], true);
        else if (threePages && variables.cursor === 'next') body = payload([
          user('4', { is_blue_verified: false, verification: { verified: false } }),
          { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: 'final' } }
        ]);
        else if (variables.cursor) body = payload([user('4', { is_blue_verified: false, verification: { verified: false } })], true);
        else body = payload([
          user('1', { is_blue_verified: false, verification: { verified: false }, relationship_perspectives: { followed_by: false } }),
          user('2', { is_blue_verified: true, relationship_perspectives: { followed_by: true } }), user('3'),
          { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: 'next' } }
        ]);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }).catch(error => {
          if (!nextGate) throw error;
        });
      } else await route.fulfill({ contentType: 'text/html', body: html });
    };
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    testWorker = worker;
    assert.equal(await worker.evaluate(() => typeof XFFAuto), 'object', '测试浏览器应加载当前版本后台脚本');
    await worker.evaluate(() => chrome.storage.local.clear());
    const extensionId = new URL(worker.url()).host;
    let x = await context.newPage();
    testX = x;
    cdp = await context.newCDPSession(x);
    cdp.on('Runtime.executionContextCreated', e => worlds.push(e.context));
    await cdp.send('Runtime.enable');
    await x.goto('https://x.com/home');
    const panel = await context.newPage();
    testPanel = panel;
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await panel.waitForSelector('#start');
    async function startScan() {
      const hasSession = await worker.evaluate(async () => !!(await getState()));
      await panel.evaluate(() => document.querySelector('#start').click());
      if (hasSession) {
        await panel.waitForSelector('#confirm-start');
        await panel.evaluate(() => document.querySelector('#confirm-start').click());
      }
    }

    assert.equal(await panel.locator('.brand-name').innerText(), 'VerifiedX');
    assert.equal(await panel.locator('.author-link').getAttribute('href'), 'https://x.com/gegesobig');
    await panel.waitForFunction(() => !document.querySelector('#start').disabled);
    await panel.uncheck('#automatic');
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '3');
    assert.equal(await panel.locator('.person').count(), 3);
    assert.equal(await panel.locator('#owner-avatar').getAttribute('src'), 'https://x.com/mock-avatar.png', '侧栏卡片应显示本人真实头像');
    const beforeConfirmation = await worker.evaluate(() => getState());
    const dismissNative = dialog => dialog.dismiss();
    panel.on('dialog', dismissNative);
    await panel.click('#start');
    assert.equal(await panel.locator('#confirm-start').isVisible(), true, '重扫必须在侧栏显示确认，不能依赖原生弹窗');
    assert.equal(await worker.evaluate(async () => (await getState()).startedAt), beforeConfirmation.startedAt);
    await panel.click('#cancel-start');
    assert.equal(await panel.locator('#confirm-start').count(), 0);
    assert.equal(await panel.locator('#total').innerText(), '3', '取消重扫保留结果');
    panel.off('dialog', dismissNative);

    await panel.selectOption('#filter', 'both');
    assert.equal(await panel.locator('.person').count(), 1);
    assert.ok((await panel.locator('#results').innerText()).includes('@person1'));
    await panel.fill('#search', 'person2');
    assert.equal(await panel.locator('.person').count(), 0);
    await panel.fill('#search', '');
    await panel.selectOption('#filter', 'all');
    await panel.click('#pause');
    await panel.waitForFunction(() => document.querySelector('#pause').textContent.trim() === '继续采集');
    await x.evaluate(() => loadList('Following', 'next'));
    // 等待页面到扩展消息队列排空，确认暂停后的响应没有进入结果。
    await worker.evaluate(() => queue);
    assert.equal(await panel.locator('#total').innerText(), '3');
    await panel.click('#pause');
    await panel.waitForFunction(() => document.querySelector('#pause').textContent.trim() === '暂停采集');
    await x.waitForFunction(() => typeof loadList === 'function');
    await x.evaluate(() => loadList('Following', 'next'));
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '4');
    await panel.click('#followers');
    await panel.waitForFunction(() => document.querySelector('#followers-count').textContent.trim() === '1');
    await panel.selectOption('#list-kind','following');
    await panel.selectOption('#filter', 'both');
    await panel.waitForFunction(() => document.querySelectorAll('.person').length === 2);
    assert.equal(await panel.locator('#export').count(),0,'侧栏不再提供导出入口');
    const baselineFirstSeen = await worker.evaluate(async () => (await getState()).lists.following.users['1'].firstSeenAt);
    assert.ok(Number.isFinite(baselineFirstSeen));
    assert.equal(await panel.locator('.new-account').count(), 0, '建立基线的扫描不显示新增');
    await panel.screenshot({ path: path.join(out, 'panel.png'), fullPage: true });
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '窄侧栏不应横向溢出');
    await x.evaluate(() => document.querySelector('[data-testid="AppTabBar_Profile_Link"]').href = '/other');
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '已暂停');
    assert.ok((await panel.locator('#issue').innerText()).includes('账号改变'));
    await x.evaluate(() => loadList('Following', 'next'));
    await worker.evaluate(() => queue);
    assert.equal(await panel.locator('#total').innerText(), '4');
    panel.on('dialog', d => d.accept());
    await panel.click('#clear');
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '0');
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('history:99'))['history:99'].users['1'].firstSeenAt), baselineFirstSeen);
    await x.evaluate(() => document.querySelector('[data-testid="AppTabBar_Profile_Link"]').href = '/harvey');
    await panel.check('#automatic');
    const automaticStart = followingRequests.length;
    threePages = true;
    assert.equal(await panel.isChecked('#automatic'), true);
    await panel.waitForFunction(() => !document.querySelector('#start').disabled);
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#auto-status').hidden === false);
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '4');
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '自动采集完成');
    assert.equal(await panel.locator('.animate-scan-beam, #status.active').count(), 0, '完成后必须关闭扫描动画');
    assert.equal(await x.evaluate(() => scrollY), 0, '主动请求第二页不能改变页面滚动位置');
    assert.equal(await x.locator('#verifiedx-activity-overlay').count(), 0, '关注请求模式不显示浏览器控制提示');
    assert.deepEqual(followingRequests.slice(automaticStart).map(r => r.cursor), [null, 'next', 'final']);
    const automaticRequests = followingRequests.slice(automaticStart);
    assert.ok(automaticRequests[2].at - automaticRequests[1].at >= 2900, '连续分页请求之间应保留间隔');
    threePages = false;
    assert.ok(followingRequests.slice(automaticStart).every(r => r.userId === '99' && r.authorization === 'Bearer smoke-only'));
    assert.equal(JSON.stringify(await worker.evaluate(() => chrome.storage.local.get())).includes('smoke-only'), false);
    await panel.screenshot({ path: path.join(out, 'auto-panel.png'), fullPage: true });
    await x.evaluate(() => loadList('Following', 'categories'));
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '6');
    await panel.selectOption('#filter', 'all');
    assert.equal(await panel.locator('.new-account').count(), 2);
    assert.equal(await worker.evaluate(async () => (await getState()).lists.following.users['1'].firstSeenAt), baselineFirstSeen);
    await panel.reload();
    await panel.waitForFunction(() => document.querySelectorAll('.new-account').length === 2);
    assert.match(await panel.locator('.person[data-user-id="5"] .first-seen').innerText(), /首次发现/);
    await panel.selectOption('#filter', 'new');
    assert.equal(await panel.locator('.person').count(), 2);
    await panel.screenshot({ path: path.join(out, 'first-seen-panel.png'), fullPage: true });
    await panel.selectOption('#filter', 'all');
    for (const [category, label, count] of [
      ['none', '未认证', 2], ['blue', '蓝 V', 1], ['business', '企业认证', 1],
      ['government', '政府认证', 1], ['unknown', '认证未知', 1]
    ]) {
      await panel.selectOption('#badge-filter', category);
      assert.equal(await panel.locator('.person').count(), count);
      if (['blue', 'business', 'government'].includes(category)) {
        assert.equal(await panel.locator(`.person .badge-icon[data-badge="${category}"]`).count(), count);
        const title = await panel.locator(`.person .badge-icon[data-badge="${category}"]`).first().getAttribute('title');
        assert.ok(title && title.includes(label));
      } else {
        assert.equal(await panel.locator('.person .badge-icon').count(), 0);
      }
    }
    await panel.selectOption('#badge-filter', 'government');
    await panel.selectOption('#filter', 'no');
    assert.equal(await panel.locator('.person').count(), 0);
    await panel.selectOption('#badge-filter', 'business');
    assert.equal(await panel.locator('.person').count(), 1);
    assert.equal(await panel.locator('#export').count(),0,'侧栏不再提供导出入口');
    await panel.selectOption('#filter', 'all');
    await panel.selectOption('#badge-filter', 'all');
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: path.join(out, 'categories-panel.png'), fullPage: true });
    await panel.click('#theme-toggle');
    assert.ok(await panel.evaluate(() => document.documentElement.classList.contains('dark')));
    await panel.waitForTimeout(220);
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: path.join(out, 'dark-mode-panel.png'), fullPage: true });
    await panel.click('#theme-toggle');
    await panel.waitForTimeout(220);
    assert.ok(await panel.evaluate(() => !document.documentElement.classList.contains('dark')));
    // 页面主世界即使覆盖旧入口和 fetch，也不能接管隔离环境的写入执行器。
    await x.evaluate(() => {
      window.__xffFriendship = async () => ({ ok: true, status: 'not_following', userId: '1' });
      window.__savedFetch = window.fetch;
      window.fetch = async () => new Response('{}', { status: 200 });
      window.postMessage({ source: 'x-follow-filter:control:v1', type: 'FRIENDSHIP',
        request: { owner: 'harvey', ownerId: '99', userId: '1', action: 'unfollow' } }, location.origin);
    });
    assert.equal(friendshipRequests.length, 0);
    const firstPerson = panel.locator('.person[data-user-id="1"]');
    await firstPerson.getByRole('button', { name: '取关 @person1', exact: true }).click();
    await panel.waitForFunction(() => document.querySelector('.person[data-user-id="1"] .friendship-button').textContent.includes('正在验证'));
    await firstPerson.getByRole('button', { name: '关注 @person1', exact: true }).waitFor();
    assert.equal(verificationRequests.length, 3);
    assert.equal(friendshipRequests.length, 1, '复核只查询，不重复取关');
    assert.ok(verificationRequests[2].at - verificationRequests[1].at >= 2900);
    assert.ok((await firstPerson.innerText()).includes('已取关 · 已验证'));
    verificationMode = 'success';
    assert.ok((await firstPerson.innerText()).includes('已取关'));
    assert.equal(await panel.locator('#total').innerText(), '6', '取关后仍保留扫描快照');
    assert.equal(await panel.locator('#status').innerText(), '已暂停');
    assert.equal(await panel.locator('#export').count(),0,'侧栏不再提供导出入口');
    await firstPerson.getByRole('button', { name: '关注 @person1', exact: true }).click();
    await firstPerson.getByRole('button', { name: '取关 @person1', exact: true }).waitFor();
    assert.equal(friendshipRequests.length, 2);
    assert.ok(friendshipRequests.every(r => r.userId === '1' && r.method === 'POST'));
    friendshipMode = 'limited';
    await firstPerson.getByRole('button', { name: '取关 @person1', exact: true }).click();
    await panel.waitForFunction(() => document.querySelector('#error').textContent.includes('限制'));
    assert.equal(await firstPerson.getByRole('button', { name: '取关 @person1', exact: true }).isEnabled(), true);
    friendshipMode = 'success';
    await firstPerson.getByRole('button', { name: '取关 @person1', exact: true }).click();
    await firstPerson.getByRole('button', { name: '关注 @person1', exact: true }).waitFor();
    friendshipMode = 'requested';
    await firstPerson.getByRole('button', { name: '关注 @person1', exact: true }).click();
    await panel.waitForFunction(() => document.querySelector('.person[data-user-id="1"] .friendship-button').textContent.trim() === '已申请');
    assert.equal(await firstPerson.locator('.friendship-button').isDisabled(), true);
    friendshipMode = 'unknown';
    verificationMode = 'unknown';
    const unknownQueryStart = verificationRequests.length;
    await panel.getByRole('button', { name: '取关 @person2', exact: true }).click();
    await panel.waitForFunction(() => document.querySelector('.person[data-user-id="2"] .friendship-button').textContent.trim() === '重新验证');
    await panel.waitForFunction(() => !document.querySelector('.person[data-user-id="2"] .friendship-button').disabled);
    assert.equal(verificationRequests.length - unknownQueryStart, 3);
    const writeCount = friendshipRequests.length;
    await x.waitForTimeout(300);
    assert.equal(friendshipRequests.length, writeCount, '失败结果不自动重试');
    await panel.reload();
    await panel.getByRole('button', {name: '重新验证 @person2', exact: true}).waitFor();
    verificationMode = 'limited';
    const limitedStart = verificationRequests.length;
    await panel.getByRole('button', {name: '重新验证 @person2', exact: true}).click();
    await panel.waitForFunction(() => document.querySelector('#error').textContent.includes('限制了查询'));
    assert.equal(verificationRequests.length, limitedStart + 1);
    verificationMode = 'success';
    await panel.getByRole('button', {name: '重新验证 @person2', exact: true}).click();
    await panel.getByRole('button', {name: '关注 @person2', exact: true}).waitFor();
    assert.equal(friendshipRequests.length, writeCount, '重新验证不得重复发送 POST');
    friendshipMode = 'success';
    verificationMode = 'following';
    const stillFollowingStart = verificationRequests.length;
    await panel.getByRole('button', {name: '取关 @person3', exact: true}).click();
    await panel.waitForFunction(() => document.querySelector('#error').textContent.includes('仍在关注'));
    assert.equal(verificationRequests.length, stillFollowingStart + 3);
    assert.equal(friendshipRequests.length, writeCount + 1);
    assert.ok((await panel.locator('.person[data-user-id="3"]').innerText()).includes('仍在关注 · 已验证'));
    verificationMode = 'success';
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '复核状态不能撑宽侧栏');
    await panel.setViewportSize({width: 320, height: 960});
    assert.ok(await panel.evaluate(() => Array.from(document.querySelectorAll('.person, .topbar, .friendship-button, .own-status')).every(el => el.getBoundingClientRect().right <= innerWidth)), '320 像素侧栏操作与状态必须可见');
    assert.equal(await panel.locator('.person[data-user-id="4"] .own-status').count(), 0, '无操作记录不重复显示已关注标签');
    await panel.screenshot({ path: path.join(out, 'verification-320.png'), fullPage: true });
    await panel.setViewportSize({width: 390, height: 960});
    await panel.screenshot({ path: path.join(out, 'friendship-panel.png'), fullPage: true });
    await x.evaluate(() => { window.fetch = window.__savedFetch; delete window.__xffFriendship; delete window.__savedFetch; });
    friendshipMode = 'success';
    nextGate = new Promise(resolve => { releaseNext = resolve; });
    const pendingRequest = x.waitForRequest(request => request.url().includes('/Following?') && request.url().includes('next'));
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '3');
    assert.equal(await panel.locator('.new-account').count(), 0, '重新扫描不重复标记已发现账号');
    assert.equal(await worker.evaluate(async () => (await getState()).lists.following.users['1'].firstSeenAt), baselineFirstSeen);
    await pendingRequest;
    await panel.evaluate(() => document.querySelector('#auto-toggle').click());
    await panel.waitForFunction(() => document.querySelector('#auto-toggle').textContent.trim() === '自动采集当前列表');
    releaseNext();
    // 给已取消的网络响应和跨世界消息留出处理时间，确认不会写入迟到的一页。
    await x.waitForTimeout(300);
    assert.equal(await panel.locator('#total').innerText(), '3');
    assert.equal(await worker.evaluate(async () => (await getState()).auto.enabled), false);
    nextGate = null;
    nextLimited = true;
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#issue').textContent.includes('限制'));
    assert.equal(await panel.locator('#total').innerText(), '3');
    assert.equal(await worker.evaluate(async () => (await getState()).auto.enabled), false);
    const requestCountAfterLimit = followingRequests.length;
    await x.waitForTimeout(2200);
    assert.equal(followingRequests.length, requestCountAfterLimit, '限流后不能继续自动请求');
    nextLimited = false;
    endlessTail = true;
    const endlessStart = followingRequests.length;
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#auto-status').textContent.includes('连续 3 页'));
    assert.equal(await panel.locator('#status').innerText(), '自动采集已停止');
    assert.equal(await panel.locator('.animate-scan-beam, #status.active').count(), 0, '无新增停止后必须关闭扫描动画');
    assert.deepEqual(followingRequests.slice(endlessStart).map(r => r.cursor), [null, 'next', 'tail-2', 'tail-3']);
    const stoppedState = await worker.evaluate(() => getState());
    assert.equal(stoppedState.auto.enabled, false);
    assert.equal(stoppedState.lists.following.complete, false, '无明确末页不能误报完整');
    assert.equal(await panel.locator('#total').innerText(), '3');
    const stoppedCount = followingRequests.length;
    await x.waitForTimeout(4200);
    assert.equal(followingRequests.length, stoppedCount, '停止后不再请求下一页');
    endlessTail = false;
    emptyTail = true;
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '自动采集完成');
    assert.ok((await panel.locator('#coverage').innerText()).includes('已取得连续分页及末页证据'));
    const emptyState = await worker.evaluate(() => getState());
    assert.equal(emptyState.auto.status, 'complete');
    assert.equal(emptyState.lists.following.complete, true, '关注出现空页即判定采集结束并标记完整');
    emptyTail = false;
    detailedFollowers = true;
    await panel.selectOption('#list-kind', 'followers');
    const followersStart = followerRequests.length;
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '7' && document.querySelector('#status').textContent.trim() === '自动采集完成');
    assert.equal(new URL(x.url()).pathname, '/harvey/followers');
    assert.ok(await x.evaluate(() => scrollY > 0),'粉丝通过自动滚动触发原生分页');
    assert.deepEqual(await x.evaluate(() => nativeFollowerCursors), [null,'followers-next'],'两页均由网页原生加载');
    assert.deepEqual(await x.evaluate(() => replayControls), [],'粉丝不发请求重放指令');
    assert.deepEqual(followerRequests.slice(followersStart).map(r => r.cursor), [null,'followers-next']);
    assert.equal(await panel.locator('#no-count').innerText(), '4');
    assert.equal(await panel.locator('.first-seen, .new-account').count(), 0, '粉丝不展示关注首次发现历史');
    const followerState = await worker.evaluate(() => getState());
    assert.equal(Object.keys(followerState.lists.following.users).length, 0);
    assert.equal(followerState.lists.followers.complete, true);
    const history = await worker.evaluate(async () => (await chrome.storage.local.get('history:99'))['history:99']);
    assert.equal(history.users['10'], undefined, '粉丝不能写入关注历史');
    for (const [badge, count] of [['none',2],['blue',3],['business',1],['government',1]]) {
      await panel.selectOption('#badge-filter',badge);
      assert.equal(await panel.locator('.person').count(),count);
    }
    await panel.selectOption('#filter','not_following');
    for (const badge of ['none','blue','business','government']) {
      await panel.selectOption('#badge-filter',badge);
      assert.equal(await panel.locator('.person').count(),1);
    }
    await panel.selectOption('#badge-filter','business');
    assert.equal(await panel.locator('#export').count(),0,'侧栏不再提供导出入口');
    await panel.fill('#search','person10');
    assert.equal(await panel.locator('.person').count(),0);
    await panel.fill('#search','');
    friendshipMode = 'success';
    const followerWrites = friendshipRequests.length;
    await panel.getByRole('button',{name:'关注 @person12',exact:true}).click();
    await panel.waitForFunction(() => document.querySelectorAll('.person').length === 0);
    await panel.waitForFunction(() => !document.querySelector('#list-kind').disabled);
    assert.equal(friendshipRequests.length,followerWrites+1);
    assert.equal(friendshipRequests.at(-1).userId,'12');
    await panel.selectOption('#filter','following');
    await panel.getByRole('button',{name:'取关 @person12',exact:true}).click();
    await panel.waitForFunction(() => document.querySelectorAll('.person').length === 0);
    await panel.selectOption('#filter','not_following');
    await panel.getByRole('button',{name:'关注 @person12',exact:true}).waitFor();
    await panel.selectOption('#badge-filter','all');
    assert.equal(await panel.locator('.person').count(),4);
    await panel.selectOption('#filter','unknown');
    assert.equal(await panel.locator('.person').count(),1);
    assert.equal(await panel.locator('.person[data-user-id="14"] .friendship-button').isDisabled(),true);
    await panel.selectOption('#filter','all');
    await panel.reload();
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '7');
    assert.equal(await panel.inputValue('#list-kind'),'followers');
    await panel.setViewportSize({width:320,height:960});
    assert.ok(await panel.evaluate(() => Array.from(document.querySelectorAll('.person,.friendship-button,.topbar')).every(el => el.getBoundingClientRect().right <= innerWidth)), '粉丝视图窄屏不溢出');
    await panel.screenshot({path:path.join(out,'followers-320.png'),fullPage:true});
    await panel.setViewportSize({width:390,height:960});
    await panel.selectOption('#list-kind','following');
    assert.equal(await panel.locator('#total').innerText(),'0','切换视图不触发扫描或清除数据');
    await x.bringToFront();
    await panel.evaluate(() => document.querySelector('#following').click());
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '自动采集完成' && document.querySelector('#total').textContent.trim() === '4');
    await panel.selectOption('#list-kind','followers');
    assert.equal(await panel.locator('#total').innerText(),'7','补采关注保留粉丝快照');
    assert.equal(await panel.locator('#no-count').innerText(),'5','完整关注差集补全未知粉丝');
    await panel.screenshot({path:path.join(out,'followers-panel.png'),fullPage:true});
    await panel.locator('.help summary').click();
    await panel.click('#reset-history');
    await panel.waitForFunction(() => document.querySelector('#total').textContent.trim() === '0');
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('history:99'))['history:99']), undefined);
    profileLimited = true;
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '已暂停' &&
      document.querySelector('#issue').textContent.includes('限制'));
    assert.equal(new URL(x.url()).pathname, '/harvey', '资料请求失败不得跳过核对进入关注列表');

    // 自动扫描暂停后关闭原标签页，在新标签页点击可见的继续按钮恢复。
    profileLimited = false;
    await panel.selectOption('#list-kind', 'following');
    nextGate = new Promise(resolve => { releaseNext = resolve; });
    const beforePauseRequest = x.waitForRequest(request => request.url().includes('/Following?') && request.url().includes('next'));
    await x.bringToFront();
    await startScan();
    await beforePauseRequest;
    await panel.evaluate(() => document.querySelector('#pause').click());
    await panel.waitForFunction(() => document.querySelector('#pause').textContent.trim() === '继续采集');
    releaseNext();
    nextGate = null;
    const paused = await worker.evaluate(() => getState());
    assert.equal(Object.keys(paused.lists.following.users).length, 3);
    await x.close();
    x = await context.newPage();
    testX = x;
    await x.goto('https://x.com/home');
    await x.bringToFront();
    await panel.evaluate(() => document.querySelector('#pause').click());
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '自动采集完成' && document.querySelector('#total').textContent.trim() === '4');
    const resumed = await worker.evaluate(() => getState());
    assert.notEqual(resumed.tabId, paused.tabId, '恢复必须连接新的 X 标签页');
    assert.equal(resumed.startedAt, paused.startedAt, '恢复保留原扫描快照和历史');
    assert.equal(resumed.targetId, paused.targetId);
    assert.equal(await x.evaluate(() => scrollY), 0);
    assert.equal(await panel.locator('#pause').innerText(), '该列表已完成');
    assert.equal(await panel.locator('#pause').isDisabled(), true, '完成后不可继续空转');
    await panel.setViewportSize({width:320,height:960});
    await panel.click('#start');
    await panel.waitForSelector('#confirm-start');
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '重扫确认与完整提示在 320 像素下不溢出');
    await panel.screenshot({path:path.join(out,'scan-confirmation-320.png'),fullPage:true});
    await panel.click('#cancel-start');
    await panel.screenshot({path:path.join(out,'scan-resumed-320.png'),fullPage:true});

    // 无法解析的单个粉丝不阻断下一页，末页仍明确标注结果不完整。
    unreadableFollower = true;
    const beforePartial = followerRequests.length;
    await panel.selectOption('#list-kind', 'followers');
    await x.bringToFront();
    await startScan();
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '采集结束 · 结果不完整');
    assert.equal(await panel.locator('#total').innerText(), '7');
    assert.deepEqual(followerRequests.slice(beforePartial).map(r => r.cursor), [null, 'followers-next']);
    const partial = await worker.evaluate(() => getState());
    assert.equal(partial.lists.followers.complete, false);
    assert.equal(partial.auto.enabled, false);
    assert.match(await panel.locator('#auto-status').innerText(), /无法解析/);
    assert.ok(await x.evaluate(() => scrollY > 0));
    assert.deepEqual(await x.evaluate(() => nativeFollowerCursors), [null,'followers-next'],'两页均由网页原生加载');
    assert.deepEqual(await x.evaluate(() => replayControls), []);
    const stoppedPosition = await x.evaluate(() => scrollY);
    await x.waitForTimeout(4500);
    assert.equal(await x.evaluate(() => scrollY), stoppedPosition, '末页后不再滚动');
    assert.equal(followerRequests.length, beforePartial + 2, '末页后不再加载粉丝');
    assert.equal(await x.locator('#verifiedx-activity-overlay').count(), 0, '末页停止后移除提示层');
    await panel.screenshot({path:path.join(out,'followers-partial-320.png'),fullPage:true});

    // 原生粉丝请求已经发出时暂停，迟到响应不写入；继续后重新滚动。
    unreadableFollower = false;
    followerNextGate = new Promise(resolve => { releaseFollowerNext = resolve; });
    const pendingFollower = x.waitForRequest(request => request.url().includes('/Followers?') && request.url().includes('followers-next'));
    await x.bringToFront();
    await startScan();
    await pendingFollower;
    assert.match(await panel.locator('#instruction').innerText(), /自动滚动粉丝页/);
    const overlay=x.locator('#verifiedx-activity-overlay');
    await overlay.waitFor({state:'attached'});
    assert.match(await overlay.locator('[role=status]').innerText(),/VerifiedX.*控制/);
    assert.match(await overlay.locator('.detail').innerText(),/@harvey/);
    assert.equal(await overlay.count(),1);
    await panel.screenshot({path:path.join(out,'followers-scroll-restored-320.png'),fullPage:true});
    await x.setViewportSize({width:320,height:700});
    assert.ok(await x.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await x.screenshot({path:path.join(out,'followers-overlay-restored-320.png')});
    await x.getByRole('button',{name:'暂停采集',exact:true}).click();
    await overlay.waitFor({state:'detached'});
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '已暂停');
    const pausedFollowerPosition = await x.evaluate(() => scrollY);
    releaseFollowerNext(); followerNextGate = null;
    await x.waitForTimeout(4500);
    assert.equal(await panel.locator('#total').innerText(), '3', '暂停丢弃迟到的原生粉丝响应');
    assert.equal(await x.evaluate(() => scrollY), pausedFollowerPosition, '暂停后不再滚动');
    await x.bringToFront();
    await panel.evaluate(() => document.querySelector('#pause').click());
    await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '自动采集完成');
    assert.equal(await panel.locator('#total').innerText(), '7');
    assert.ok(await x.evaluate(() => scrollY > 0));
    assert.deepEqual(await x.evaluate(() => nativeFollowerCursors), [null,'followers-next'],'两页均由网页原生加载');
    assert.deepEqual(await x.evaluate(() => replayControls), []);

    // 原生分页限流和空 404 均停止并保留首屏，不自动重试或误报完整。
    for (const status of [429,404]) {
      followerFailure = status;
      const beforeFailedFollowers = followerRequests.length;
      await x.bringToFront();
      await startScan();
      await panel.waitForFunction(() => document.querySelector('#status').textContent.trim() === '自动采集已停止');
      assert.match(await panel.locator('#issue').innerText(),status===429?/限制/:/404/);
      const failedFollowers = await worker.evaluate(() => getState());
      assert.equal(failedFollowers.lists.followers.complete,false);
      assert.equal(Object.keys(failedFollowers.lists.followers.users).length,3);
      await x.waitForTimeout(4500);
      assert.ok(await x.evaluate(() => scrollY > 0));
      assert.equal(followerRequests.length,beforeFailedFollowers+2);
      assert.equal(await x.locator('#verifiedx-activity-overlay').count(),0);
    }
    assert.deepEqual(errors, []);
    console.log('浏览器冒烟通过：侧栏重扫确认与取消保留、自动扫描暂停后关闭旧标签页并重连继续、完成按钮禁用、320 像素完整提示、粉丝原生滚动分页、控制提示层暂停、迟到响应丢弃、恢复滚动、429 和空 404 停止、未关注和认证组合筛选、粉丝单账号关注/取关、双列表切换保留、取关后独立复核、延迟一致、限流停止、只读重新验证、仍关注提示、末页与连续无新增停止、停止后动画消失、无滚动分页、筛选、账号隔离、单账号取关与关注回来、私密申请、限流保留原状态、未知结果禁用重复写入、我的关注状态，以及原有回归。');
  } catch (error) {
    console.error('诊断', JSON.stringify({ errors,
      url: testX?.url(),
      panel: await testPanel?.locator('body').innerText().catch(() => ''),
      storage: await testWorker?.evaluate(() => chrome.storage.local.get()).catch(() => null)
    }, null, 2));
    for (const world of worlds) {
      const data = await cdp.send('Runtime.evaluate', { contextId: world.id,
        expression: 'JSON.stringify({core:typeof globalThis.XFF,href:location.href})', returnByValue: true }).catch(() => null);
      if (data) console.error('执行环境', world.name, data.result?.value);
    }
    throw error;
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
