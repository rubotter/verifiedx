<script lang="ts">
  let {
    viewKind = 'following',
    listLabel = '关注',
    scanningLabel = '关注',
    owner = '等待连接 X',
    ownerAvatar = null,
    statusText = '未开始',
    isActive = false,
    isBusy = false,
    starting = false,
    canPause = true,
    hasSession = false,
    pauseText = '暂停采集',
    autoToggleText = '自动采集当前列表',
    canToggleAuto = false,
    instruction = '先打开已登录的 X 标签页。保持该标签页可见即可。',
    autoStatus = '',
    showAutoStatus = false,
    automatic = $bindable(true),
    onSelectView,
    onStart,
    onPause,
    onAutoToggle,
    onFollowing,
    onFollowers
  } = $props<{
    viewKind: 'following' | 'followers';
    listLabel: string;
    scanningLabel: string;
    owner: string;
    ownerAvatar?: string | null;
    statusText: string;
    isActive: boolean;
    isBusy: boolean;
    starting: boolean;
    canPause: boolean;
    hasSession: boolean;
    pauseText: string;
    autoToggleText: string;
    canToggleAuto: boolean;
    instruction: string;
    autoStatus: string;
    showAutoStatus: boolean;
    automatic: boolean;
    onSelectView: (kind: 'following' | 'followers') => void;
    onStart: () => void;
    onPause: () => void;
    onAutoToggle: () => void;
    onFollowing: () => void;
    onFollowers: () => void;
  }>();

  let avatarFailed = $state(false);

  $effect(() => {
    if (ownerAvatar) {
      avatarFailed = false;
    }
  });

  const ownerInitial = $derived(
    owner && owner !== '等待连接 X'
      ? owner.replace(/^@+/, '')[0]?.toUpperCase() || '?'
      : '?'
  );
</script>

<section
  class="scan-card relative overflow-hidden rounded-2xl border bg-white/95 p-3.5 backdrop-blur-md transition-all duration-200 border-slate-200/80 text-slate-900 dark:border-slate-800/80 dark:bg-[#151921]/95 dark:text-slate-100 shadow-xs hover:shadow-sm {isActive ? 'border-sky-500/50 ring-2 ring-sky-500/20' : ''}"
  aria-label="采集控制"
>
  <!-- 扫描时顶部的激光动画光束 -->
  {#if isActive}
    <div class="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] overflow-hidden" aria-hidden="true">
      <div class="h-full w-1/3 bg-gradient-to-r from-transparent via-[#1d9bf0] to-transparent animate-scan-beam shadow-xs shadow-sky-500/50"></div>
    </div>
  {/if}

  <!-- 账号、列表选择与状态顶栏（整合为单行紧凑布局） -->
  <div class="account-row mb-3 flex items-center justify-between gap-2">
    <div class="account-meta flex items-center gap-2 min-w-0">
      <div
        class="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/5 bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 dark:border-white/10 dark:from-slate-800 dark:to-slate-900 dark:text-slate-300 shadow-2xs"
        aria-hidden="true"
      >
        {#if ownerAvatar && !avatarFailed}
          <img
            id="owner-avatar"
            class="h-full w-full object-cover"
            src={ownerAvatar}
            alt=""
            referrerpolicy="no-referrer"
            onerror={() => { avatarFailed = true; }}
          />
        {:else if owner && owner !== '等待连接 X'}
          <span class="text-[11px] font-bold text-slate-900 dark:text-white">
            {ownerInitial}
          </span>
        {:else}
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        {/if}
      </div>
      <strong id="owner" class="truncate text-xs font-bold text-slate-900 dark:text-slate-100">{owner}</strong>
    </div>

    <!-- 列表切换与状态指示器 -->
    <div class="flex items-center gap-1.5 shrink-0">
      <select
        id="list-kind"
        aria-label="列表类型"
        value={viewKind}
        disabled={isBusy}
        onchange={(e) => onSelectView(e.currentTarget.value as 'following' | 'followers')}
        class="cursor-pointer rounded-full border border-slate-200/90 bg-slate-50/90 py-0.5 pr-5 pl-2.5 text-[11px] font-semibold text-slate-800 outline-none transition-all hover:border-sky-500 hover:bg-white shadow-2xs appearance-none bg-[url('data:image/svg+xml,%3Csvg_xmlns=\'http://www.w3.org/2000/svg\'_width=\'10\'_height=\'10\'_viewBox=\'0_0_24_24\'_fill=\'none\'_stroke=\'%23536471\'_stroke-width=\'2\'_stroke-linecap=\'round\'_stroke-linejoin=\'round\'%3E%3Cpolyline_points=\'6_9_12_15_18_9\'%3E%3C/polyline%3E%3C/svg%3E')] bg-[length:10px_10px] bg-[right_6px_center] bg-no-repeat dark:border-slate-800 dark:bg-[#16181c] dark:text-slate-200 dark:hover:border-slate-700 dark:bg-[url('data:image/svg+xml,%3Csvg_xmlns=\'http://www.w3.org/2000/svg\'_width=\'10\'_height=\'10\'_viewBox=\'0_0_24_24\'_fill=\'none\'_stroke=\'%2371767b\'_stroke-width=\'2\'_stroke-linecap=\'round\'_stroke-linejoin=\'round\'%3E%3Cpolyline_points=\'6_9_12_15_18_9\'%3E%3C/polyline%3E%3C/svg%3E')]"
      >
        <option value="following">我的关注</option>
        <option value="followers">我的粉丝</option>
      </select>

      <span
        id="status"
        class="status inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold leading-normal shadow-2xs {isActive ? 'active border-emerald-500/30 bg-emerald-50/90 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/50 dark:text-emerald-300' : 'border-slate-200/80 bg-slate-100/70 text-slate-600 dark:border-slate-800/80 dark:bg-[#1a202c]/70 dark:text-slate-400'}"
      >
        {#if isActive}
          <span class="relative flex h-1.5 w-1.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
        {:else}
          <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500"></span>
        {/if}
        {statusText}
      </span>
    </div>
  </div>

  {#if !hasSession}
    <!-- 初始状态：醒目主扫描按钮（带品牌微光与动效） -->
    <button
      id="start"
      class="primary w-full rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 hover:from-[#1d9bf0] hover:to-[#0284c7] py-2.5 text-center text-xs font-bold text-white shadow-xs hover:shadow-md hover:shadow-sky-500/20 active:scale-[0.99] transition-all duration-200 disabled:cursor-default disabled:opacity-45 dark:from-white dark:to-slate-200 dark:text-slate-900 dark:hover:from-[#38bdf8] dark:hover:to-[#0284c7] dark:hover:text-white"
      disabled={isBusy}
      onclick={onStart}
    >
      {starting ? '正在启动…' : `开始扫描我的${listLabel}`}
    </button>
  {:else if isActive}
    <!-- 扫描中状态：丰富天蓝雷达态 + 显眼停顿按钮 -->
    <div class="flex items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-gradient-to-r from-sky-50/90 via-sky-50/50 to-transparent p-2.5 dark:border-sky-500/25 dark:from-sky-950/40 dark:via-sky-950/20 dark:to-transparent">
      <div class="flex items-center gap-2 min-w-0">
        <svg class="h-4 w-4 shrink-0 animate-radar-sweep text-[#1d9bf0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="12" x2="12" y2="2"></line>
        </svg>
        <span class="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">正在采集{scanningLabel}…</span>
      </div>

      <!-- 停止扫描 / 暂停采集按钮 -->
      <button
        id="pause"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-300/90 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 shadow-2xs transition-all hover:bg-rose-50 hover:border-rose-400 active:scale-95 disabled:cursor-default disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/70"
        disabled={isBusy}
        onclick={onPause}
      >
        <span class="h-1.5 w-1.5 rounded-[1px] bg-rose-600 dark:bg-rose-400"></span>
        {pauseText}
      </button>
    </div>

    <!-- 扫描中也可重新开始 -->
    <div class="mt-1.5 text-right">
      <button
        id="start"
        class="text-[10.5px] text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 underline cursor-pointer transition-colors"
        disabled={isBusy}
        onclick={onStart}
      >
        {starting ? '正在启动…' : `重新扫描${listLabel}`}
      </button>
    </div>
  {:else}
    <!-- 暂停或已完成状态：紧凑双按钮 -->
    <div class="grid grid-cols-2 gap-2">
      <button
        id="pause"
        class="flex items-center justify-center gap-1.5 rounded-xl border border-sky-500/35 bg-gradient-to-b from-sky-50 to-sky-100/50 py-2 text-xs font-bold text-sky-700 shadow-2xs transition-all hover:from-sky-100 hover:to-sky-200/60 hover:border-sky-500/50 active:scale-[0.98] disabled:cursor-default disabled:opacity-45 dark:border-sky-500/30 dark:from-sky-950/40 dark:to-sky-950/20 dark:text-sky-300 dark:hover:bg-sky-950/60"
        disabled={isBusy || !canPause}
        onclick={onPause}
      >
        <svg class="h-3 w-3 fill-current" viewBox="0 0 24 24">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        {pauseText}
      </button>

      <button
        id="start"
        class="truncate rounded-xl border border-slate-200/90 bg-white/90 py-2 text-center text-xs font-semibold text-slate-800 shadow-2xs transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:cursor-default disabled:opacity-45 dark:border-slate-800 dark:bg-[#1a202c]/70 dark:text-slate-300 dark:hover:bg-[#1f2635] dark:hover:text-white"
        disabled={isBusy}
        onclick={onStart}
      >
        {starting ? '正在启动…' : '重新扫描'}
      </button>
    </div>
  {/if}

  <!-- 控制与选项底栏：精简自动采集勾选与快捷入口 -->
  <div class="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-2.5 dark:border-slate-800/60">
    <label class="auto-option flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors">
      <input
        type="checkbox"
        id="automatic"
        bind:checked={automatic}
        disabled={isBusy}
        class="h-3.5 w-3.5 cursor-pointer accent-[#1d9bf0] rounded"
      />
      <span>{listLabel === '粉丝' ? '自动滚动' : '自动分页'}</span>
    </label>

    <!-- 列表快捷入口 -->
    <div class="controls flex items-center gap-1" id="controls" hidden={!hasSession}>
      <button
        id="following"
        class="inline-flex items-center gap-1 rounded-md px-2 py-0.75 text-xs font-medium text-slate-500 hover:bg-sky-50 hover:text-sky-700 transition-colors dark:text-slate-400 dark:hover:bg-sky-950/40 dark:hover:text-sky-300"
        disabled={isBusy}
        onclick={onFollowing}
        title="关注列表"
      >
        <span>关注 ↗</span>
      </button>

      <button
        id="followers"
        class="inline-flex items-center gap-1 rounded-md px-2 py-0.75 text-xs font-medium text-slate-500 hover:bg-sky-50 hover:text-sky-700 transition-colors dark:text-slate-400 dark:hover:bg-sky-950/40 dark:hover:text-sky-300"
        disabled={isBusy}
        onclick={onFollowers}
        title="粉丝列表"
      >
        <span>粉丝 ↗</span>
      </button>

      <!-- 保持 auto-toggle 在 DOM 中供测试访问 -->
      <button
        id="auto-toggle"
        class="hidden"
        disabled={isBusy || !canToggleAuto}
        onclick={onAutoToggle}
        aria-hidden="true"
      >
        {autoToggleText}
      </button>
    </div>
  </div>


  <!-- 提示信息：仅在活动扫描或尚未连接时显示，避免空闲时冗余文本堆叠 -->
  <p class="hint {isActive || starting || !hasSession ? 'mt-2 text-[11px] leading-relaxed text-[#536471] dark:text-[#8b98a5]' : 'sr-only'}" id="instruction">{instruction}</p>
  <div
    class="hint auto-alert mt-2.5 flex items-center gap-1.5 rounded-lg border border-sky-100 bg-sky-50/80 px-2.5 py-1 text-[10.5px] leading-snug text-sky-700 dark:border-sky-950 dark:bg-sky-950/30 dark:text-sky-300"
    id="auto-status"
    role="status"
    hidden={!showAutoStatus}
  >
    <svg class="h-3 w-3 shrink-0 text-[#1d9bf0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
    <span>{autoStatus}</span>
  </div>
</section>
