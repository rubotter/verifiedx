<script lang="ts">
  let {
    listKind = 'following',
    filter = $bindable('all'),
    badgeFilter = $bindable('all'),
    searchQuery = $bindable(''),
    resultCount = 0,
    historyStatusText = '核对账号后开始记录首次发现时间。'
  } = $props<{
    listKind: string;
    filter: string;
    badgeFilter: string;
    searchQuery: string;
    resultCount: number;
    historyStatusText?: string;
  }>();
</script>

<div class="filter-section space-y-2">
  <!-- 列表标题与匹配数量 -->
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <h2 id="results-heading" class="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full bg-[#1d9bf0]"></span>
        {listKind === 'followers' ? '粉丝列表' : '关注列表'}
      </h2>
      <span id="result-count" class="rounded-full bg-sky-50 px-2.5 py-0.5 text-[10.5px] font-black text-sky-700 border border-sky-200/80 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/60 shadow-2xs tabular-nums">
        {resultCount}
      </span>
    </div>
  </div>

  <!-- 搜索与筛选组合 -->
  <div class="space-y-1.5">
    <label class="search-wrap flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2 shadow-2xs backdrop-blur-md transition-all focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20 dark:border-slate-800/90 dark:bg-[#151921]/95 dark:focus-within:border-sky-500">
      <span class="search-icon flex items-center text-slate-400 dark:text-slate-500" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"></circle>
          <line x1="21" y1="21" x2="16.5" y2="16.5"></line>
        </svg>
      </span>
      <input
        id="search"
        type="search"
        bind:value={searchQuery}
        placeholder="搜索昵称或 @用户名…"
        aria-label="搜索昵称或用户名"
        autocomplete="off"
        spellcheck="false"
        class="w-full min-w-0 border-0 bg-transparent text-xs text-slate-900 placeholder-slate-400 outline-none dark:text-slate-100 dark:placeholder-slate-500 font-normal"
      />
    </label>

    <div class="filter-dropdowns grid grid-cols-2 gap-2">
      <div class="select-box w-full">
        <label class="sr-only" for="filter">筛选条件</label>
        <select
          id="filter"
          bind:value={filter}
          class="w-full cursor-pointer truncate rounded-xl border border-slate-200/80 bg-white/90 py-1.5 pr-6 pl-2.5 text-xs font-medium text-slate-800 shadow-2xs outline-none transition-all hover:border-slate-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 appearance-none bg-[url('data:image/svg+xml,%3Csvg_xmlns=\'http://www.w3.org/2000/svg\'_width=\'12\'_height=\'12\'_viewBox=\'0_0_24_24\'_fill=\'none\'_stroke=\'%23536471\'_stroke-width=\'2\'_stroke-linecap=\'round\'_stroke-linejoin=\'round\'%3E%3Cpolyline_points=\'6_9_12_15_18_9\'%3E%3C/polyline%3E%3C/svg%3E')] bg-[length:12px_12px] bg-[right_8px_center] bg-no-repeat dark:border-slate-800 dark:bg-[#151921]/90 dark:text-slate-200 dark:hover:border-slate-700 dark:bg-[url('data:image/svg+xml,%3Csvg_xmlns=\'http://www.w3.org/2000/svg\'_width=\'12\'_height=\'12\'_viewBox=\'0_0_24_24\'_fill=\'none\'_stroke=\'%2371767b\'_stroke-width=\'2\'_stroke-linecap=\'round\'_stroke-linejoin=\'round\'%3E%3Cpolyline_points=\'6_9_12_15_18_9\'%3E%3C/polyline%3E%3C/svg%3E')]"
        >
          <option value="all">{listKind === 'followers' ? '全部粉丝' : '全部关注'}</option>
          {#if listKind === 'followers'}
            <option value="not_following">我未关注</option>
            <option value="following">我已关注</option>
            <option value="nonblue">非蓝 V</option>
            <option value="not_following_nonblue">我未关注 & 非蓝 V</option>
          {:else}
            <option value="no">未回关</option>
            <option value="nonblue">非蓝 V</option>
            <option value="both">未回关 & 非蓝 V</option>
            <option value="new">本次新增</option>
          {/if}
          <option value="unknown">状态未知</option>
        </select>
      </div>

      <div class="select-box w-full">
        <label class="sr-only" for="badge-filter">认证分类</label>
        <select
          id="badge-filter"
          bind:value={badgeFilter}
          class="w-full cursor-pointer truncate rounded-xl border border-slate-200/80 bg-white/90 py-1.5 pr-6 pl-2.5 text-xs font-medium text-slate-800 shadow-2xs outline-none transition-all hover:border-slate-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 appearance-none bg-[url('data:image/svg+xml,%3Csvg_xmlns=\'http://www.w3.org/2000/svg\'_width=\'12\'_height=\'12\'_viewBox=\'0_0_24_24\'_fill=\'none\'_stroke=\'%23536471\'_stroke-width=\'2\'_stroke-linecap=\'round\'_stroke-linejoin=\'round\'%3E%3Cpolyline_points=\'6_9_12_15_18_9\'%3E%3C/polyline%3E%3C/svg%3E')] bg-[length:12px_12px] bg-[right_8px_center] bg-no-repeat dark:border-slate-800 dark:bg-[#151921]/90 dark:text-slate-200 dark:hover:border-slate-700 dark:bg-[url('data:image/svg+xml,%3Csvg_xmlns=\'http://www.w3.org/2000/svg\'_width=\'12\'_height=\'12\'_viewBox=\'0_0_24_24\'_fill=\'none\'_stroke=\'%2371767b\'_stroke-width=\'2\'_stroke-linecap=\'round\'_stroke-linejoin=\'round\'%3E%3Cpolyline_points=\'6_9_12_15_18_9\'%3E%3C/polyline%3E%3C/svg%3E')]"
        >
          <option value="all">全部认证</option>
          <option value="none">未认证</option>
          <option value="blue">蓝 V</option>
          <option value="business">企业认证</option>
          <option value="government">政府认证</option>
          <option value="unknown">认证未知</option>
        </select>
      </div>
    </div>
  </div>

  <p class="filter-note sr-only" id="history-status">
    {historyStatusText}
  </p>
</div>
