(function (root) {
  'use strict';
  const validTime = value => Number.isFinite(value) && value > 0;
  function record(state, previous, now = Date.now()) {
    if (!state?.targetId || !/^\d{1,25}$/.test(state.targetId)) return { state, history: null };
    const history = previous?.ownerId === state.targetId ? previous :
      { version: 1, ownerId: state.targetId, baselineAt: null, baselineSession: null, users: {} };
    const records = { ...history.users };
    const users = {};
    for (const u of Object.values(state.lists.following.users)) {
      let saved = records[u.id];
      if (!saved) {
        // 旧版本只能迁移目前保留的采集时间，不能还原更早的关注或发现时间。
        saved = records[u.id] = { firstSeenAt: validTime(u.observedAt) ? u.observedAt : now,
          firstSeenSession: state.startedAt,
          discoveredAfterBaseline: validTime(history.baselineAt) && history.baselineSession !== state.startedAt };
      }
      users[u.id] = { ...u, firstSeenAt: saved.firstSeenAt,
        isNew: saved.discoveredAfterBaseline === true && saved.firstSeenSession === state.startedAt };
    }
    const baselineAt = history.baselineAt || (state.lists.following.complete ? now : null);
    const next = { ...history, users: records, baselineAt,
      baselineSession: history.baselineSession ?? (baselineAt ? state.startedAt : null) };
    return { history: next, state: { ...state, historyBaselineAt: baselineAt,
      lists: { ...state.lists, following: { ...state.lists.following, users } } } };
  }
  const api = { record };
  root.XFFHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
