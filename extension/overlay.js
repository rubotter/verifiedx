(() => {
  'use strict';
  // 独立的提示层只负责展示；暂停权限和滚动状态由隔离内容脚本管理。
  function create({ onPause }) {
    let host, title, detail, hint, button;
    function hide() { host?.remove(); host = null; }
    function show({ owner, pending = false, error = '' }) {
      if (!document.documentElement) return;
      if (!host?.isConnected) {
        host = document.createElement('div');
        host.id = 'verifiedx-activity-overlay';
        host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
          :host { color-scheme: light dark; }
          * { box-sizing: border-box; }
          .frame { position: absolute; inset: 0; border: 2px solid #1d9bf099;
            background: #1d9bf006; box-shadow: inset 0 0 28px #1d9bf012; pointer-events: none; }
          .card { position: absolute; bottom: max(24px, env(safe-area-inset-bottom)); left: 50%;
            transform: translateX(-50%); width: min(600px, calc(100% - 32px)); padding: 16px;
            display: flex; gap: 12px; align-items: center; border: 1px solid #b8def8;
            border-radius: 18px; background: #fff; color: #0f1419;
            box-shadow: 0 8px 36px #0f141933; font: 14px/1.5 system-ui, -apple-system, sans-serif;
            text-align: left; pointer-events: none; }
          .icon { flex: 0 0 32px; height: 32px; border-radius: 10px; display: grid;
            place-items: center; background: #e8f5ff; color: #0879c6; font-size: 20px; font-weight: 600; }
          .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
          .title { margin: 0 0 3px; font-size: 14px; font-weight: 700; }
          .detail { margin: 0; font-size: 12px; color: #536471; }
          .hint { margin: 4px 0 0; font-size: 11px; color: #536471; }
          button { pointer-events: auto; flex-shrink: 0; border: 1px solid #cfd9de; border-radius: 999px;
            background: #0f1419; color: white; padding: 10px 16px; font: 600 12px/1.5 system-ui, sans-serif;
            cursor: pointer; min-height: 40px; }
          button:hover { background: #2f3336; }
          button:focus-visible { outline: 3px solid #1d9bf0; outline-offset: 3px; }
          button:disabled { opacity: .55; cursor: wait; }
          @media (max-width: 420px) {
            .card { flex-wrap: wrap; padding: 14px; bottom: max(16px, env(safe-area-inset-bottom)); }
            .icon { display: none; }
            .text { flex-basis: 100%; }
            button { width: 100%; }
          }
          @media (prefers-color-scheme: dark) {
            .card { background: #15202b; color: #f7f9f9; border-color: #1d9bf077; }
            .detail, .hint { color: #a6b5c2; }
            .icon { background: #1d9bf026; color: #6ac1ff; }
            button { background: #eff3f4; color: #0f1419; border-color: #eff3f4; }
            button:hover { background: #cfd9de; }
          }
        `;
        const frame = document.createElement('div'); frame.className = 'frame'; frame.setAttribute('aria-hidden', 'true');
        const card = document.createElement('section'); card.className = 'card'; card.setAttribute('aria-label', 'VerifiedX 浏览器控制');
        const icon = document.createElement('span'); icon.className = 'icon'; icon.textContent = '↓'; icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('div'); text.className = 'text';
        title = document.createElement('p'); title.className = 'title'; title.setAttribute('role', 'status');
        detail = document.createElement('p'); detail.className = 'detail';
        hint = document.createElement('p'); hint.className = 'hint';
        button = document.createElement('button'); button.type = 'button';
        button.addEventListener('click', event => {
          if (!event.isTrusted || button.disabled) return;
          event.preventDefault(); event.stopPropagation(); void onPause();
        });
        text.append(title, detail, hint); card.append(icon, text, button); shadow.append(style, frame, card);
        document.documentElement.append(host);
      }
      // 账号名仅作为文本插入，不把页面数据拼入 HTML。
      const nextTitle = pending ? '正在暂停 VerifiedX 采集…' : error ? 'VerifiedX 已停止滚动' : '浏览器正在由 VerifiedX 控制';
      if (title.textContent !== nextTitle) title.textContent = nextTitle;
      detail.textContent = `@${owner} · 正在自动滚动粉丝列表`;
      hint.textContent = error || '请保持此标签页可见，你可以随时暂停。';
      button.textContent = pending ? '正在暂停…' : error ? '重试暂停' : '暂停采集';
      button.disabled = pending;
      if (pending || error) detail.textContent = `@${owner} · 已停止自动滚动`;
    }
    return { show, hide };
  }
  globalThis.XFFOverlay = { create };
})();
