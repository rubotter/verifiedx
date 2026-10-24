<script lang="ts">
  let {
    listKind = 'following',
    total = 0,
    noCount = 0,
    unverifiedCount = 0,
    coverageText = '结果将随页面加载出现。'
  } = $props<{
    listKind: string;
    total: number;
    noCount: number;
    unverifiedCount: number;
    coverageText: string;
  }>();
</script>

<section class="stats rounded-2xl border border-slate-200/80 bg-white/90 p-2.5 backdrop-blur-md shadow-xs transition-all dark:border-slate-800/80 dark:bg-[#151921]/90" aria-label="采集统计">
  <div class="grid grid-cols-3 gap-2">
    <!-- 1. 已采集 -->
    <div class="stat-card flex flex-col items-center justify-center rounded-xl bg-slate-50/90 p-2 border border-slate-200/60 shadow-2xs transition-all hover:bg-slate-100/80 dark:bg-[#1a202c]/70 dark:border-slate-800/70 dark:hover:bg-[#1f2635]">
      <span class="stat-label text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">已采集</span>
      <strong id="total" class="mt-1 font-sans text-xl font-black tracking-tight text-slate-900 dark:text-white tabular-nums leading-none">{total}</strong>
    </div>

    <!-- 2. 未回关 / 我未关注 (核心重点突出) -->
    <div class="stat-card stat-alert relative overflow-hidden flex flex-col items-center justify-center rounded-xl bg-gradient-to-b from-rose-50 to-rose-100/50 p-2 border border-rose-200/90 shadow-xs transition-all hover:border-rose-300 dark:from-rose-950/45 dark:to-rose-950/25 dark:border-rose-900/60 dark:hover:border-rose-800">
      <span class="stat-label flex items-center gap-1 text-[10.5px] font-bold text-rose-600 dark:text-rose-400">
        <span class="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-xs shadow-rose-500/50"></span>
        {listKind === 'followers' ? '我未关注' : '未回关'}
      </span>
      <strong id="no-count" class="mt-1 font-sans text-xl font-black tracking-tight text-rose-600 dark:text-rose-400 tabular-nums leading-none">{noCount}</strong>
    </div>

    <!-- 3. 未认证 -->
    <div class="stat-card flex flex-col items-center justify-center rounded-xl bg-slate-50/90 p-2 border border-slate-200/60 shadow-2xs transition-all hover:bg-slate-100/80 dark:bg-[#1a202c]/70 dark:border-slate-800/70 dark:hover:bg-[#1f2635]">
      <span class="stat-label text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">未认证</span>
      <strong id="unverified-count" class="mt-1 font-sans text-xl font-black tracking-tight text-slate-800 dark:text-slate-200 tabular-nums leading-none">{unverifiedCount}</strong>
    </div>
  </div>

  <div class="coverage-bar mt-2 flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-slate-100/70 py-1.5 px-2.5 dark:bg-[#11141b]/70 border border-slate-200/50 dark:border-slate-800/50">
    <span class="coverage-dot relative flex h-2 w-2 shrink-0">
      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1d9bf0] opacity-75"></span>
      <span class="relative inline-flex rounded-full h-2 w-2 bg-[#1d9bf0]"></span>
    </span>
    <p class="coverage truncate text-[10.5px] font-medium text-slate-500 dark:text-slate-400" id="coverage">{coverageText}</p>
  </div>
</section>
