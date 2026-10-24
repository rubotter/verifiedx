const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../extension/core');
const H = fs.existsSync(require('node:path').join(__dirname, '../extension/history.js')) ? require('../extension/history') : {};
function snapshot(start, ids, complete = false, targetId = '99') {
  const s = C.newSession('harvey', 7, start); s.targetId = targetId;
  s.lists.following.complete = complete;
  for (const id of ids) s.lists.following.users[id] = { id, username: 'user' + id, name: '账号', observedAt: start + 1 };
  return s;
}
test('首次完整扫描前记录发现时间但不把补采账号标为新增', () => {
  let r = H.record(snapshot(100, ['1']), null, 110);
  assert.equal(r.history.baselineAt, null);
  assert.equal(r.state.lists.following.users['1'].firstSeenAt, 101);
  r = H.record(snapshot(200, ['1', '2'], true), r.history, 210);
  assert.equal(r.history.baselineAt, 210);
  assert.equal(r.state.lists.following.users['1'].firstSeenAt, 101);
  assert.equal(r.state.lists.following.users['2'].isNew, false);
  r = H.record(snapshot(200, ['1', '2', '3'], true), r.history, 220);
  assert.equal(r.state.lists.following.users['3'].isNew, false);
});
test('基线后仅首次出现的账号标新增，重复分页和下次扫描保留首次时间', () => {
  let r = H.record(snapshot(100, ['1'], true), null, 110);
  r = H.record(snapshot(200, ['1', '2']), r.history, 210);
  assert.equal(r.state.lists.following.users['1'].isNew, false);
  assert.equal(r.state.lists.following.users['2'].isNew, true);
  r = H.record(snapshot(200, ['1', '2'], true), r.history, 220);
  assert.equal(r.state.lists.following.users['2'].isNew, true);
  r = H.record(snapshot(300, ['2'], true), r.history, 310);
  assert.equal(r.state.lists.following.users['2'].firstSeenAt, 201);
  assert.equal(r.state.lists.following.users['2'].isNew, false);
  r = H.record(snapshot(400, ['1', '2'], true), r.history, 410);
  assert.equal(r.state.lists.following.users['1'].firstSeenAt, 101);
  assert.equal(r.state.lists.following.users['1'].isNew, false);
});
test('本人和关注者都按数字 ID 隔离，改名不重置历史', () => {
  const base = H.record(snapshot(100, ['1'], true), null, 110);
  const renamed = snapshot(200, ['1']); renamed.owner = 'renamed'; renamed.lists.following.users['1'].username = 'changed';
  assert.equal(H.record(renamed, base.history, 210).state.lists.following.users['1'].firstSeenAt, 101);
  const other = H.record(snapshot(200, ['1'], true, '88'), base.history, 210);
  assert.equal(other.state.lists.following.users['1'].firstSeenAt, 201);
  assert.equal(other.state.lists.following.users['1'].isNew, false);
});
test('未绑定账号不建历史，粉丝列表不作为关注记录，历史不包含资料或凭证', () => {
  const s = snapshot(100, []); s.lists.followers.users['2'] = { id: '2' };
  const r = H.record(s, null, 110);
  assert.deepEqual(r.history.users, {});
  s.targetId = null;
  assert.equal(H.record(s, null, 110).history, null);
  const record = H.record(snapshot(100, ['1'], true), null, 110);
  assert.doesNotMatch(JSON.stringify(record.history), /username|authorization|账号/);
});
test('新增筛选与认证搜索叠加，保留首次发现时间', () => {
  let r = H.record(snapshot(100, ['1'], true), null, 110);
  r = H.record(snapshot(200, ['1', '2']), r.history, 210);
  r.state.lists.following.users['2'].badge = 'blue';
  const rows = C.rows(r.state);
  assert.deepEqual(C.filterRows(rows, 'new', 'user2', 'blue').map(u => u.id), ['2']);
  assert.equal(C.filterRows(rows, 'new', 'user1').length, 0);
  assert.equal(rows.find(u => u.id === '1').firstSeenAt,101);
});
