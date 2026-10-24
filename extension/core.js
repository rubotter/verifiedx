(function (root) {
  'use strict';
  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const ID = /^\d{1,25}$/;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const bool = (...values) => values.find(v => typeof v === 'boolean') ?? null;

  function normalizeUser(result) {
    const u = result?.__typename === 'UserWithVisibilityResults' ? result.user : result;
    if (!u || (u.__typename && u.__typename !== 'User')) return null;
    const legacy = u.legacy || {};
    const username = u.core?.screen_name || legacy.screen_name;
    if (!ID.test(u.rest_id || '') || !HANDLE.test(username || '')) return null;
    // 新版将认证类型放在 verification 中；旧版及扩展字段作为兼容回退。
    const kind = [u.verification?.verified_type, u.verified_type, legacy.verified_type,
      u.ext_verified_type, legacy.ext_verified_type].map(value => String(value ?? '').trim().toLowerCase()).find(Boolean) || '';
    const blueFlag = bool(u.is_blue_verified, legacy.is_blue_verified);
    const verifiedFlags = [u.verification?.verified, u.verified, legacy.verified];
    const hasVerified = verifiedFlags.includes(true);
    let blue = null;
    let badge = 'unknown';
    if (kind === 'business' || kind === 'government') {
      blue = false;
      badge = kind;
    } else if (kind && !['blue', 'none'].includes(kind)) {
      // 新出现的认证类型保留未知，不能仅凭非蓝 V 标记归入未认证。
      blue = blueFlag === false ? false : null;
    } else if (kind === 'blue' || blueFlag === true) {
      blue = true;
      badge = 'blue';
    } else if (kind === 'none' || blueFlag === false) {
      blue = false;
      // 非蓝 V 也可能是黄标/灰标；仅凭 false 不能证明未认证。
      badge = !hasVerified && (kind === 'none' || verifiedFlags.includes(false)) ? 'none' : 'unknown';
    }
    const avatarUrl =
      u.avatar?.image_url ||
      u.avatar?.image?.image_url ||
      u.core?.avatar?.image_url ||
      u.core?.avatar?.image?.image_url ||
      legacy.profile_image_url_https ||
      u.profile_image_url_https ||
      u.core?.profile_image_url_https ||
      legacy.profile_image_url ||
      u.profile_image_url ||
      null;
    return { id: String(u.rest_id), username, name: String(u.core?.name || legacy.name || username).slice(0, 200),
      followedBy: bool(u.relationship_perspectives?.followed_by, legacy.followed_by, u.followed_by),
      following: bool(u.relationship_perspectives?.following, legacy.following, u.following),
      followRequested: bool(u.relationship_perspectives?.follow_request_sent, u.relationship_perspectives?.following_requested,
        legacy.follow_request_sent, u.follow_request_sent), blue, badge, avatarUrl };
  }

  function parseTimeline(body) {
    const result = body?.data?.user?.result;
    const instructions = result?.timeline?.timeline?.instructions || result?.timeline?.instructions;
    if (!Array.isArray(instructions) || body.errors?.length) return { ok: false };
    const users = [];
    let nextCursor = null, terminal = false, unreadable = 0, recognized = instructions.length === 0;
    function readEntry(entry) {
      const content = entry?.content;
      if (content?.cursorType === 'Bottom') {
        nextCursor = typeof content.value === 'string' && content.value ? content.value : null;
        return;
      }
      const item = content?.itemContent;
      if (/^user-/.test(entry?.entryId || '') || item?.itemType === 'TimelineUser') {
        const u = normalizeUser(item?.user_results?.result);
        if (u) users.push(u); else unreadable++;
      } else if (content?.items?.length) {
        // 模块可能是推荐区域，不把其中的账号混入关注列表，也不宣称分页完整。
        unreadable++;
      }
    }
    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) {
        recognized = true;
        instruction.entries.forEach(readEntry);
      } else if (instruction.type === 'TimelineReplaceEntry' && instruction.entry) {
        recognized = true;
        readEntry(instruction.entry);
      } else if (instruction.type === 'TimelineTerminateTimeline' && instruction.direction === 'Bottom') {
        recognized = true;
        terminal = true;
      } else if (instruction.type === 'TimelineAddToModule') {
        unreadable++;
      }
    }
    return { ok: recognized, users, nextCursor, terminal, unreadable };
  }

  function requestInfo(value) {
    try {
      const url = new URL(value, 'https://x.com');
      if (!['x.com', 'twitter.com'].includes(url.hostname) || url.protocol !== 'https:') return null;
      const match = url.pathname.match(/^\/i\/api\/graphql\/[^/]+\/(Following|Followers|UserByScreenName)$/);
      if (!match) return null;
      const variables = JSON.parse(url.searchParams.get('variables'));
      if (match[1] === 'UserByScreenName') {
        if (!HANDLE.test(variables?.screen_name || '')) return null;
        return { kind: 'profile', username: variables.screen_name.toLowerCase() };
      }
      if (!ID.test(variables?.userId || '')) return null;
      return { kind: match[1].toLowerCase(), targetId: String(variables.userId),
        cursor: typeof variables.cursor === 'string' && variables.cursor ? variables.cursor : null };
    } catch { return null; }
  }

  function currentOwner(doc) {
    const link = doc.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const match = link?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    return match ? match[1].toLowerCase() : null;
  }

  function ownRoute(pathname, owner) {
    const match = pathname.match(/^\/([A-Za-z0-9_]{1,15})\/(following|followers)\/?$/i);
    return match && match[1].toLowerCase() === owner ? match[2].toLowerCase() : null;
  }

  const blankList = () => ({ users: {}, pages: {}, complete: false, batches: 0 });
  function newSession(owner, tabId, now = Date.now()) {
    if (!HANDLE.test(owner)) throw new Error('无法识别当前账号，请打开 X 的个人资料页。');
    return { version: 1, owner: owner.toLowerCase(), tabId, targetId: null, startedAt: now,
      acceptAfter: now, updatedAt: null, active: true, issue: '', lists: { following: blankList(), followers: blankList() } };
  }

  function completeChain(pages) {
    let key = 'root';
    const seen = new Set();
    while (own(pages, key) && !seen.has(key)) {
      seen.add(key);
      const p = pages[key];
      if (p.unreadable) return false;
      if (p.terminal && !p.nextCursor) return true;
      if (!p.nextCursor) return false;
      key = `cursor:${p.nextCursor}`;
    }
    return false;
  }

  function bindProfile(state, profile, tabId) {
    if (!state?.active || state.tabId !== tabId || profile.owner !== state.owner ||
        !ID.test(profile.id || '') || profile.requestedAt < state.acceptAfter) return state;
    if (state.targetId && state.targetId !== profile.id) return { ...state, active: false,
      issue: '本人资料的账号 ID 发生变化，采集已暂停。请重新扫描。' };
    const avatarUrl = typeof profile.avatarUrl === 'string' && /^https?:\/\//.test(profile.avatarUrl)
      ? profile.avatarUrl
      : (state.avatarUrl || null);
    const next = { ...state, targetId: profile.id };
    if (avatarUrl) next.avatarUrl = avatarUrl;
    return next;
  }

  function acceptPage(state, page, tabId, now = Date.now()) {
    if (!state?.active || state.tabId !== tabId || page.owner !== state.owner ||
        !['following', 'followers'].includes(page.kind) || !ID.test(page.targetId || '') ||
        (!state.targetId || state.targetId !== page.targetId) || !Array.isArray(page.users) ||
        (page.requestedAt != null && page.requestedAt < state.acceptAfter)) return state;
    const list = state.lists[page.kind];
    const users = { ...list.users };
    for (const u of page.users) {
      if (!u || !ID.test(u.id || '') || !HANDLE.test(u.username || '')) continue;
      users[u.id] = { id: u.id, username: u.username, name: String(u.name || u.username).slice(0, 200),
        blue: bool(u.blue), followedBy: bool(u.followedBy), following: bool(u.following), followRequested: bool(u.followRequested),
        badge: ['blue', 'business', 'government', 'none', 'other'].includes(u.badge) ? u.badge : 'unknown',
        avatarUrl: typeof u.avatarUrl === 'string' && /^https?:\/\//.test(u.avatarUrl) ? u.avatarUrl : null,
        observedAt: now };
    }
    const isFollowingEmpty = page.kind === 'following' && page.users.length === 0;
    const isFollowersEmpty = page.kind === 'followers' && page.users.length === 0 && page.cursor && page.terminal !== false;
    const isEmptyTerminal = isFollowingEmpty || isFollowersEmpty;
    const terminal = isEmptyTerminal || page.terminal === true;
    const nextCursor = isEmptyTerminal ? null : (page.nextCursor || null);
    const unreadable = isEmptyTerminal ? 0 : (page.unreadable || 0);
    const key = page.cursor ? `cursor:${page.cursor}` : 'root';
    const pages = { ...list.pages, [key]: { nextCursor,
      terminal, unreadable } };
    return { ...state, targetId: page.targetId, updatedAt: now, issue: '', lists: {
      ...state.lists, [page.kind]: { users, pages, complete: completeChain(pages), batches: list.batches + 1 }
    } };
  }

  function ownRelationship(state, id) {
    const record = state.friendships?.[id];
    if (record) return { ownStatus: record.status, ownEvidence: '本次单账号操作或复核结果' };
    const following = state.lists.following.users[id];
    const follower = state.lists.followers.users[id];
    // 优先较新的明确字段；尚未采集完整的关注列表不能用于排除关系。
    if (follower && (!following || (follower.observedAt || 0) >= (following.observedAt || 0))) {
      if (follower.following === true) return { ownStatus: 'following', ownEvidence: '粉丝响应明确表示我已关注' };
      if (follower.followRequested === true) return { ownStatus: 'requested', ownEvidence: '已发送关注申请，等待批准' };
      if (follower.following === false) return { ownStatus: 'not_following', ownEvidence: '粉丝响应明确表示我未关注' };
    }
    if (following) return { ownStatus: 'following', ownEvidence: '本次关注列表中存在' };
    if (state.lists.following.complete) return { ownStatus: 'not_following', ownEvidence: '本次完整关注列表中不存在' };
    return { ownStatus: 'unknown', ownEvidence: '缺少明确字段，且关注列表尚未采集完整' };
  }

  function rows(state, kind = 'following') {
    if (!state || !['following', 'followers'].includes(kind)) return [];
    const followers = state.lists.followers;
    return Object.values(state.lists[kind].users).map(u => {
      let relationship = 'unknown', evidence = '缺少关系信息';
      const follower = followers.users[u.id];
      if (follower && (u.followedBy === null || follower.observedAt >= u.observedAt)) {
        relationship = 'yes'; evidence = '本次粉丝列表中存在';
      } else if (u.followedBy !== null) {
        relationship = u.followedBy ? 'yes' : 'no'; evidence = '页面返回明确关系字段';
      } else if (followers.complete) {
        relationship = 'no'; evidence = '本次完整粉丝列表中不存在';
      }
      if (kind === 'followers') { relationship = 'yes'; evidence = '本次粉丝列表中存在'; }
      const ownState = ownRelationship(state, u.id);
      const record = state.friendships?.[u.id];
      return { ...u, relationship, evidence, ...ownState, listKind: kind, verifiedAt: record?.verifiedAt, canVerify: canVerifyFriendship(record) };
    });
  }

  const badgeCategory = value => ['none', 'blue', 'business', 'government'].includes(value) ? value : 'unknown';

  function filterRows(items, filter = 'all', query = '', badge = 'all') {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    return items.filter(u => {
      if (q && !`${u.username} ${u.name}`.toLowerCase().includes(q)) return false;
      if (badge !== 'all' && badgeCategory(u.badge) !== badge) return false;
      if (filter === 'not_following') return u.ownStatus === 'not_following';
      if (filter === 'following') return u.ownStatus === 'following';
      if (filter === 'not_following_nonblue') return u.ownStatus === 'not_following' && u.blue === false;
      if (filter === 'no') return u.relationship === 'no';
      if (filter === 'nonblue') return u.blue === false;
      if (filter === 'both') return u.relationship === 'no' && u.blue === false;
      if (filter === 'unknown') return (u.listKind === 'followers' ? ['unknown', 'pending', 'verifying'].includes(u.ownStatus) : u.relationship === 'unknown') || badgeCategory(u.badge) === 'unknown';
      if (filter === 'new') return u.isNew === true;
      return true;
    });
  }

  const badgeLabel = value => ({ blue: '蓝 V', business: '企业认证', government: '政府认证',
    none: '未认证', unknown: '认证未知' }[value] || '认证未知');
  const relationshipLabel = value => ({ yes: '已回关', no: '未回关', unknown: '回关未知' }[value] || '回关未知');
  const canVerifyFriendship = record => record?.action === 'unfollow' && ['pending', 'verifying', 'unknown'].includes(record.status);
  const ownStatusLabel = (value, kind = 'following') => ({ following: '已关注', not_following: kind === 'followers' ? '未关注' : '已取关', requested: '已申请',
    verifying: '正在验证', pending: '结果待核对', unknown: kind === 'followers' ? '关注未知' : '结果待核对' }[value] || '关注未知');
  const api = { normalizeUser, parseTimeline, requestInfo, currentOwner, ownRoute, newSession, bindProfile, acceptPage,
    rows, filterRows, badgeCategory, badgeLabel, relationshipLabel, ownStatusLabel, canVerifyFriendship, ownRelationship };
  root.XFF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
