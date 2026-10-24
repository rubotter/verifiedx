<script lang="ts">
  let {
    theme = 'light',
    onToggleTheme
  } = $props<{
    theme: 'light' | 'dark';
    onToggleTheme: () => void;
  }>();
</script>

<header class="topbar sticky top-0 z-20 flex items-center justify-between border-b px-3.5 py-2.5 backdrop-blur-md bg-white/90 dark:bg-[#0b0e14]/90 border-slate-200/80 dark:border-slate-800/80 transition-colors duration-200 shadow-2xs">
  <div class="brand flex items-center gap-2 text-sm font-bold tracking-tight">
    <img class="brand-logo h-6 w-6 shrink-0" src="./icons/48.png" width="24" height="24" alt="" aria-hidden="true" />
    <div class="flex items-baseline gap-1.5 min-w-0">
      <span class="brand-name font-black tracking-tight text-slate-900 dark:text-white text-[13.5px]">VerifiedX</span>
      <a class="author-link text-[10px] font-medium text-slate-400 hover:text-[#1d9bf0] hover:underline dark:text-slate-500 transition-colors" href="https://x.com/gegesobig" target="_blank" rel="noopener noreferrer" aria-label="作者 @gegesobig 的 X 主页">@gegesobig</a>
    </div>
  </div>

  <div class="flex items-center gap-2 shrink-0">
    <!-- 白天 / 夜晚切换按钮 -->
    <button
      id="theme-toggle"
      class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200/80 bg-slate-50/80 text-slate-600 transition-all hover:border-slate-300 hover:bg-white hover:text-slate-900 hover:shadow-2xs active:scale-95 dark:border-slate-800 dark:bg-[#16181c] dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-[#1e2228] dark:hover:text-white"
      onclick={onToggleTheme}
      title={theme === 'light' ? '切换至深色模式' : '切换至浅色模式'}
      aria-label={theme === 'light' ? '切换至深色模式' : '切换至浅色模式'}
    >
      {#if theme === 'light'}
        <!-- 月亮图标 (深色模式) -->
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      {:else}
        <!-- 太阳图标 (浅色模式) -->
        <svg class="h-3.5 w-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      {/if}
    </button>

    <span class="local inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-50/80 px-2.5 py-0.75 text-[10.5px] font-semibold text-sky-700 dark:border-sky-500/30 dark:bg-sky-950/40 dark:text-sky-300 shadow-2xs">
      <span class="relative flex h-1.5 w-1.5">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1d9bf0] opacity-75"></span>
        <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#1d9bf0]"></span>
      </span>
      本地处理
    </span>
  </div>
</header>
