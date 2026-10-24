const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../extension/core.js');
const C = fs.existsSync(file) ? require(file) : {};

const user = (id, extra = {}) => ({ __typename: 'User', rest_id: id,
  legacy: { screen_name: `person${id}`, name: `用户${id}`, ...extra } });
const entry = (u) => ({ entryId: `user-${u.rest_id}`, content: {
  itemContent: { itemType: 'TimelineUser', user_results: { result: u } } } });
const payload = (entries, end = false) => ({ data: { user: { result: { timeline: { timeline: {
  instructions: [{ type: 'TimelineAddEntries', entries }, ...(end ? [{
    type: 'TimelineTerminateTimeline', direction: 'Bottom' }] : [])]
} } } } } });
const page = (overrides = {}) => ({ owner: 'harvey', targetId: '99', kind: 'following',
  cursor: null, nextCursor: 'next', terminal: false, unreadable: 0,
  users: [C.normalizeUser?.(user('1', { followed_by: false }))], ...overrides });
const boundSession = (owner, tabId, now) => C.bindProfile(C.newSession(owner, tabId, now),
  { owner, id: '99', requestedAt: now }, tabId);

test('绑定本人资料数字 ID 之前不得用首个列表请求认领账号', () => {
  const s = C.newSession('harvey', 10, 100);
  assert.equal(C.acceptPage(s, page({ targetId: '777' }), 10, 101), s);
});
test('只能绑定同账号同标签页的新资料响应', () => {
  const s = C.newSession('harvey', 10, 100);
  assert.equal(C.bindProfile(s, { owner: 'other', id: '99', requestedAt: 101 }, 10), s);
  assert.equal(C.bindProfile(s, { owner: 'harvey', id: '99', requestedAt: 99 }, 10), s);
  assert.equal(C.bindProfile(s, { owner: 'harvey', id: '99', requestedAt: 101 }, 11), s);
  assert.equal(boundSession('harvey', 10, 100).targetId, '99');
});

test('缺少回关或认证字段保持未知', () => {
  assert.equal(typeof C.normalizeUser, 'function');
  const u = C.normalizeUser(user('1'));
  assert.equal(u.followedBy, null);
  assert.equal(u.blue, null);
});
test('蓝 V、其他认证、明确未认证分开处理', () => {
  assert.equal(C.normalizeUser({ ...user('1'), is_blue_verified: true }).blue, true);
  assert.equal(C.normalizeUser({ ...user('1'), is_blue_verified: false }).blue, false);
  assert.equal(C.normalizeUser({ ...user('1'), verified_type: 'Business', is_blue_verified: true }).badge, 'business');
  assert.equal(C.normalizeUser({ ...user('1'), verified_type: 'Business', is_blue_verified: true }).blue, false);
  assert.equal(C.normalizeUser(user('1', { verified: false })).blue, null);
});
test('支持新版 core 与 relationship_perspectives 字段', () => {
  const u = C.normalizeUser({ rest_id: '2', core: { screen_name: 'newname', name: '新用户' },
    relationship_perspectives: { followed_by: false }, is_blue_verified: false });
  assert.equal(u.username, 'newname');
  assert.equal(u.followedBy, false);
});
test('拒绝无用户 ID、用户名不合法和不可用用户', () => {
  assert.equal(C.normalizeUser({ legacy: { screen_name: 'name' } }), null);
  assert.equal(C.normalizeUser(user('1', { screen_name: '../../evil' })), null);
  assert.equal(C.normalizeUser({ __typename: 'UserUnavailable', rest_id: '1' }), null);
});
test('只解析时间线用户，不把附带推荐对象当成关注对象', () => {
  const data = payload([entry(user('1')), { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: 'abc' } }]);
  data.unrelated = user('900');
  const p = C.parseTimeline(data);
  assert.deepEqual(p.users.map(x => x.id), ['1']);
  assert.equal(p.nextCursor, 'abc');
  assert.equal(p.terminal, false);
});
test('未识别响应和缺失用户不伪装成空列表', () => {
  assert.equal(C.parseTimeline({ data: {} }).ok, false);
  const p = C.parseTimeline(payload([entry({ rest_id: '1', __typename: 'UserUnavailable' })], true));
  assert.equal(p.unreadable, 1);
});
test('完整分页之前，差集不能认定未回关', () => {
  let s = boundSession('harvey', 10, 100);
  s = C.acceptPage(s, page({ users: [C.normalizeUser(user('1'))] }), 10, 101);
  assert.equal(C.rows(s)[0].relationship, 'unknown');
  s = C.acceptPage(s, page({ kind: 'followers', users: [], terminal: true, nextCursor: null }), 10, 102);
  assert.equal(C.rows(s)[0].relationship, 'no');
});
test('缺页、无末页证据和无法识别条目均不能判定完整', () => {
  for (const extra of [{ cursor: 'missing' }, { unreadable: 1 }, { terminal: false }]) {
    let s = boundSession('harvey', 10, 100);
    s = C.acceptPage(s, page({ kind: 'followers', users: [], terminal: true, nextCursor: null, ...extra }), 10, 101);
    assert.equal(s.lists.followers.complete, false);
  }
});
test('乱序返回的连续分页最终可连接到末页', () => {
  let s = boundSession('harvey', 10, 100);
  s = C.acceptPage(s, page({ kind: 'followers', cursor: 'next', terminal: true, nextCursor: null, users: [] }), 10, 101);
  assert.equal(s.lists.followers.complete, false);
  s = C.acceptPage(s, page({ kind: 'followers', users: [] }), 10, 102);
  assert.equal(s.lists.followers.complete, true);
});
test('关注列表出现空页即判定为采集结束并标记完整', () => {
  let s = boundSession('harvey', 10, 100);
  s = C.acceptPage(s, page({ kind: 'following', users: [C.normalizeUser(user('1'))], nextCursor: 'p2' }), 10, 101);
  assert.equal(s.lists.following.complete, false);
  s = C.acceptPage(s, page({ kind: 'following', cursor: 'p2', users: [], nextCursor: 'p3', terminal: false }), 10, 102);
  assert.equal(s.lists.following.complete, true);
});
test('跨账号、跨标签页、暂停以及目标 ID 不一致均拒绝写入', () => {
  let s = boundSession('harvey', 10, 100);
  assert.equal(C.acceptPage(s, page({ owner: 'other' }), 10, 101), s);
  assert.equal(C.acceptPage(s, page(), 11, 101), s);
  s = C.acceptPage(s, page(), 10, 101);
  assert.equal(C.acceptPage(s, page({ targetId: '100' }), 10, 102), s);
  s = { ...s, active: false };
  assert.equal(C.acceptPage(s, page(), 10, 103), s);
});
test('数字 ID 去重并使用较新的关系和认证状态', () => {
  let s = boundSession('harvey', 10, 100);
  s = C.acceptPage(s, page(), 10, 101);
  s = C.acceptPage(s, page({ cursor: 'next', users: [C.normalizeUser({ ...user('1', { screen_name: 'renamed', followed_by: true }), is_blue_verified: true })] }), 10, 102);
  assert.equal(C.rows(s).length, 1);
  assert.equal(C.rows(s)[0].username, 'renamed');
  assert.equal(C.rows(s)[0].relationship, 'yes');
});
test('粉丝中的正向证据可补全未知回关状态', () => {
  let s = boundSession('harvey', 10, 100);
  s = C.acceptPage(s, page({ users: [C.normalizeUser(user('1'))] }), 10, 101);
  s = C.acceptPage(s, page({ kind: 'followers' }), 10, 102);
  assert.equal(C.rows(s)[0].relationship, 'yes');
});
test('组合筛选不混入状态未知的用户', () => {
  const rows = [{ username: 'a', name: '甲', relationship: 'no', blue: false },
    { username: 'b', name: '乙', relationship: 'unknown', blue: false },
    { username: 'c', name: '丙', relationship: 'no', blue: null }];
  assert.deepEqual(C.filterRows(rows, 'both', '').map(x => x.username), ['a']);
  assert.equal(C.filterRows(rows, 'all', '乙').length, 1);
});
test('只接受 X 的白名单列表请求并解析目标用户 ID', () => {
  const url = 'https://x.com/i/api/graphql/hash/Following?variables=' + encodeURIComponent(JSON.stringify({ userId: '99', cursor: 'abc' }));
  assert.deepEqual(C.requestInfo(url), { kind: 'following', targetId: '99', cursor: 'abc' });
  assert.equal(C.requestInfo(url.replace('x.com', 'evil.com')), null);
  assert.equal(C.requestInfo(url.replace('/Following?', '/UserTweets?')), null);
});

test('新扫描和继续采集之前已经发出的请求不得写入', () => {
  const s = boundSession('harvey', 10, 200);
  assert.equal(C.acceptPage(s, page({ requestedAt: 199 }), 10, 300), s);
});
test('游标成环不能判为已采集完整', () => {
  let s = boundSession('harvey', 10, 100);
  s = C.acceptPage(s, page(), 10, 101);
  s = C.acceptPage(s, page({ cursor: 'next', nextCursor: 'next' }), 10, 102);
  assert.equal(s.lists.following.complete, false);
});

test('认证分类可独立筛选，并与回关和搜索取交集', () => {
  const items = ['none', 'blue', 'business', 'government', 'unknown', 'other'].map((badge, index) => ({
    id: String(index), username: `person${index}`, name: '账号', badge,
    relationship: index === 2 ? 'yes' : 'no', blue: badge === 'blue' ? true : badge === 'unknown' ? null : false
  }));
  for (const badge of ['none', 'blue', 'business', 'government']) {
    assert.deepEqual(C.filterRows(items, 'all', '', badge).map(u => u.badge), [badge]);
  }
  assert.equal(C.filterRows(items, 'no', '', 'business').length, 0);
  assert.equal(C.filterRows(items, 'no', 'person3', 'government').length, 1);
  assert.equal(C.filterRows(items, 'all', 'person0', 'government').length, 0);
  assert.equal(C.filterRows(items, 'all', '', 'unknown').length, 2);
});
test('认证标签明确区分四类，旧的其他认证保留为未知', () => {
  const badges = ['none', 'blue', 'business', 'government', 'other'];
  const labels = ['未认证', '蓝 V', '企业认证', '政府认证', '认证未知'];
  assert.deepEqual(badges.map(C.badgeLabel), labels);

});
test('四类认证解析优先采用明确类型，陌生类型不能当作未认证', () => {
  for (const kind of ['Business', 'Government']) {
    for (const blue of [true, false]) {
      const u = C.normalizeUser({ ...user('1'), verified_type: kind, is_blue_verified: blue });
      assert.equal(u.badge, kind.toLowerCase());
      assert.equal(u.blue, false);
    }
    assert.equal(C.normalizeUser(user('1', { verified_type: kind })).badge, kind.toLowerCase());
  }
  assert.equal(C.normalizeUser({ ...user('1'), is_blue_verified: false }).badge, 'unknown');
  assert.equal(C.normalizeUser({ ...user('1'), verified_type: 'FutureType', is_blue_verified: false }).badge, 'unknown');
  assert.equal(C.normalizeUser(user('1', { verified: true, is_blue_verified: false })).badge, 'unknown');
  assert.equal(C.normalizeUser(user('1')).badge, 'unknown');
});

test('新版嵌套认证字段识别企业黄标和政府灰标，优先于旧字段及蓝 V 布尔值', () => {
  for (const [kind, expected] of [['Business', 'business'], ['Government', 'government']]) {
    for (const blue of [true, false]) {
      const result = { ...user('1', { verified_type: 'None', verified: false }),
        verified_type: 'None', is_blue_verified: blue, verification: { verified: true, verified_type: kind } };
      const normalized = C.normalizeUser({ __typename: 'UserWithVisibilityResults', user: result });
      assert.equal(normalized.badge, expected);
      assert.equal(normalized.blue, false);
      const timeline = C.parseTimeline(payload([entry(result)]));
      assert.equal(timeline.users[0].badge, expected);
    }
  }
});
test('扩展认证类型字段与大小写空白可识别，缺少类型不能把非蓝 V 当成未认证', () => {
  for (const fields of [{ ext_verified_type: ' Business ' }, { legacy: { screen_name: 'alice', ext_verified_type: 'Business' } }]) {
    assert.equal(C.normalizeUser({ ...user('1'), ...fields, is_blue_verified: false }).badge, 'business');
  }
  assert.equal(C.normalizeUser({ ...user('1'), verification: { verified: true }, is_blue_verified: false }).badge, 'unknown');
  assert.equal(C.normalizeUser({ ...user('1'), verified: true, is_blue_verified: false }).badge, 'unknown');
  assert.equal(C.normalizeUser({ ...user('1'), verification: { verified: false }, is_blue_verified: false }).badge, 'none');
  assert.equal(C.normalizeUser({ ...user('1'), verification: { verified: false } }).badge, 'unknown');
  assert.equal(C.normalizeUser({ ...user('1'), verification: { verified_type: 'FutureType' }, is_blue_verified: false }).badge, 'unknown');
  assert.equal(C.normalizeUser({ ...user('1'), verification: { verified_type: 'None', verified: true }, is_blue_verified: false }).badge, 'unknown');
});

module.exports = { user, entry, payload };
test('本人关注状态与对方回关独立，取关后保留快照与我的关注状态', () => {
  let s = boundSession('harvey', 10, 100);
  s = C.acceptPage(s, page(), 10, 101);
  assert.equal(C.rows(s)[0].ownStatus, 'following');
  s.friendships = { '1': { status: 'not_following' } };
  const rows = C.rows(s);
  assert.equal(rows[0].ownStatus, 'not_following');
  assert.equal(rows[0].relationship, 'no');
  assert.equal(C.ownStatusLabel(rows[0].ownStatus), '已取关');
});

test('粉丝采集保留本人关注字段，与对方是否关注独立', () => {
  for (const fields of [
    { relationship_perspectives: { following: false, followed_by: true } },
    { legacy: { screen_name: 'alice', following: false, followed_by: true } },
    { following: false, followed_by: true }
  ]) {
    const u=C.normalizeUser({...user('1'),...fields});
    assert.equal(u.following,false);
    let s=boundSession('harvey',10,100);
    s=C.acceptPage(s,page({kind:'followers',users:[u]}),10,101);
    assert.equal(s.lists.followers.users['1'].following,false);
    assert.equal(C.rows(s,'followers')[0].ownStatus,'not_following');
    assert.equal(C.rows(s,'followers')[0].relationship,'yes');
    assert.equal(C.rows(s).length,0);
  }
});
test('粉丝未关注仅使用明确关系或完整关注差集，部分列表保持未知', () => {
  let s=boundSession('harvey',10,100);
  s=C.acceptPage(s,page({kind:'followers',users:[C.normalizeUser(user('1'))]}),10,101);
  assert.equal(C.rows(s,'followers')[0].ownStatus,'unknown');
  assert.equal(C.filterRows(C.rows(s,'followers'),'not_following').length,0);
  s=C.acceptPage(s,page({users:[],terminal:true,nextCursor:null}),10,102);
  assert.equal(C.rows(s,'followers')[0].ownStatus,'not_following');
  s=C.acceptPage(s,page({users:[C.normalizeUser(user('1'))]}),10,103);
  assert.equal(C.rows(s,'followers')[0].ownStatus,'following');
  s=C.acceptPage(s,page({kind:'followers',users:[C.normalizeUser(user('1',{following:false}))]}),10,104);
  assert.equal(C.rows(s,'followers')[0].ownStatus,'not_following','较新的明确字段覆盖旧关注快照');
  s.friendships={'1':{status:'following'}};
  assert.equal(C.rows(s,'followers')[0].ownStatus,'following','操作记录优先');
  s.friendships['1'].status='unknown';
  assert.equal(C.rows(s,'followers')[0].ownStatus,'unknown');
});
test('粉丝待批准申请不属于未关注，未知与认证组合筛选准确', () => {
  let s=boundSession('harvey',10,100);
  const users=[
    {...C.normalizeUser(user('1',{following:false,follow_request_sent:true})),badge:'blue'},
    {...C.normalizeUser(user('2',{following:false})),badge:'business',blue:false},
    {...C.normalizeUser(user('3',{following:true})),badge:'government',blue:false},
    {...C.normalizeUser(user('4')),badge:'none',blue:false}
  ];
  s=C.acceptPage(s,page({kind:'followers',users,terminal:true,nextCursor:null}),10,101);
  const rows=C.rows(s,'followers');
  assert.equal(rows[0].ownStatus,'requested');
  assert.deepEqual(C.filterRows(rows,'not_following','','business').map(u=>u.id),['2']);
  assert.deepEqual(C.filterRows(rows,'not_following_nonblue').map(u=>u.id),['2']);
  assert.deepEqual(C.filterRows(rows,'following').map(u=>u.id),['3']);
  assert.deepEqual(C.filterRows(rows,'unknown').map(u=>u.id),['4']);
  assert.equal(C.ownStatusLabel('not_following','followers'),'未关注');
});

test('资料响应包含本人真实头像时绑定至会话', () => {
  const s = C.newSession('harvey', 10, 100);
  const bound = C.bindProfile(s, {
    owner: 'harvey',
    id: '99',
    avatarUrl: 'https://pbs.twimg.com/profile_images/123/avatar_normal.jpg',
    requestedAt: 101
  }, 10);
  assert.equal(bound.targetId, '99');
  assert.equal(bound.avatarUrl, 'https://pbs.twimg.com/profile_images/123/avatar_normal.jpg');
});
