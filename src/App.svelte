<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './components/Header.svelte';
  import ScanCard from './components/ScanCard.svelte';
  import StatsDeck from './components/StatsDeck.svelte';
  import FilterBar from './components/FilterBar.svelte';
  import UserCard from './components/UserCard.svelte';
  import HelpDetails from './components/HelpDetails.svelte';
  import Footer from './components/Footer.svelte';

  const C = (globalThis as any).XFF;
  const PAGE_SIZE = 50;

  let theme = $state<'light' | 'dark'>('light'); // 默认白天模式
  let state = $state<any>(null);
  let pageNumber = $state(0);
  let busy = $state(false);
  let pendingUserId = $state<string | null>(null);
  let errorMessage = $state('');
  let filter = $state('all');
  let badgeFilter = $state('all');
  let searchQuery = $state('');
  let automatic = $state(true);
  let confirmStart = $state(false);
  let starting = $state(false);
  let viewKind = $state<'following' | 'followers'>('following');
  const listLabel = $derived(viewKind === 'followers' ? '粉丝' : '关注');
  const scanningLabel = $derived(state?.scanKind === 'followers' ? '粉丝' : '关注');

  function applyTheme(t: 'light' | 'dark') {
    theme = t;
    if (typeof document !== 'undefined') {
      if (t === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
    try {
      localStorage.setItem('xff_theme', t);
    } catch {}
  }

  function handleToggleTheme() {
    applyTheme(theme === 'light' ? 'dark' : 'light');
  }

  async function command(type: string, extra: Record<string, any> = {}) {
    if (!chrome?.runtime?.sendMessage) return null;
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || '扩展暂时未响应，请关闭侧栏后重试。');
    return response.data;
  }

  function showError(msg = '') {
    errorMessage = msg;
  }

  async function action(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    showError();
    try {
      await fn();
    } catch (error: any) {
      showError(error.message);
    } finally {
      busy = false;
    }
  }

  // 根据当前视图生成结果
  const rows = $derived(C ? C.rows(state, viewKind) : []);
  const matching = $derived(C ? C.filterRows(rows, filter, searchQuery, badgeFilter) : []);
  const pages = $derived(Math.max(1, Math.ceil(matching.length / PAGE_SIZE)));
  
  $effect(() => {
    // 筛选或视图变化后保持页码有效
    if (pageNumber >= pages) {
      pageNumber = Math.max(0, pages - 1);
    }
  });

  const pagedUsers = $derived(matching.slice(pageNumber * PAGE_SIZE, (pageNumber + 1) * PAGE_SIZE));

  const total = $derived(rows.length);
  const noCount = $derived(rows.filter((u: any) => viewKind === 'followers' ? u.ownStatus === 'not_following' : u.relationship === 'no').length);
  const unverifiedCount = $derived(rows.filter((u: any) => u.badge === 'none').length);

  const ownerText = $derived(state?.owner ? `@${state.owner.replace(/^@+/, '')}` : '等待连接 X');
  const ownerAvatar = $derived(state?.avatarUrl || null);
  const statusText = $derived(
    starting ? '正在启动…' :
    !state ? '未开始' :
    !state.active ? '已暂停' :
    !state.targetId ? '核对账号中' :
    state.auto?.enabled ? '自动采集中' :
    state.auto?.status === 'complete' ? '自动采集完成' :
    state.auto?.status === 'partial' ? '采集结束 · 结果不完整' :
    state.auto && !state.auto.enabled ? '自动采集已停止' :
    '采集中'
  );
  const isActive = $derived(
    !!state?.active &&
    (!state?.auto || state.auto.enabled) &&
    state?.auto?.status !== 'complete' &&
    state?.auto?.status !== 'stopped' &&
    state?.auto?.status !== 'stalled'
  );
  const hasSession = $derived(!!state);
  const selectedComplete = $derived(!!state?.lists[viewKind].complete);
  const pauseText = $derived(isActive ? '暂停采集' : selectedComplete ? '该列表已完成' : '继续采集');
  const canPause = $derived(isActive || !selectedComplete);
  const autoToggleText = $derived(state?.auto?.enabled ? '停止自动采集' : '自动采集当前列表');
  const canToggleAuto = $derived(!!(state?.active && state?.targetId));
  const showAutoStatus = $derived(!!state?.auto);
  const autoStatusText = $derived(
    state?.auto?.enabled ? '自动采集已开启，请保持扫描标签页可见。遇到长时间无新增或加载错误会停止。' :
    state?.auto?.message || '自动采集已停止，已采集结果保留；仍可手动滚动。'
  );

  const instructionText = $derived(
    !state ? '先打开已登录的 X 标签页。勾选自动采集后，保持该标签页可见即可。' :
    state.active ? (
      state.targetId ? (
        state.auto?.enabled ? (state.auto.kind === 'followers'
          ? '扩展正在自动滚动粉丝页，由 X 加载后续列表。请保持标签页可见，你可以随时暂停。'
          : '扩展正在通过 API 逐页采集关注列表，页面不会自动滚动。你可以随时暂停采集。') :
        '可扫描关注或粉丝列表补充关系信息；切换结果视图不会改变正在采集的列表。'
      ) : `正在本人资料页核对账号，成功后自动进入${scanningLabel}列表。请等待资料加载；若一直停在这里，请刷新本人资料页或重新扫描。`
    ) : '结果已保留。点击继续采集会打开所选列表；勾选自动采集时，粉丝列表自动滚动，关注列表自动分页。'
  );

  const unknownCount = $derived(C ? C.filterRows(rows, 'unknown').length : 0);
  const coverageText = $derived(
    !state ? '结果将随页面加载出现。' :
    `${state.lists[viewKind].complete ? '已取得连续分页及末页证据' : '仅代表已采集部分，可继续采集'}${unknownCount ? ` · ${unknownCount} 个账号含未知状态` : ''}`
  );

  const followersCount = $derived(state ? Object.keys(state.lists.followers.users).length : 0);
  const followersStatus = $derived(state?.lists.followers.complete ? '已确认连续分页至末页。' : '尚未取得完整分页证据。');

  const historyStatusText = $derived(
    viewKind === 'followers' ? '粉丝视图展示我是否关注对方；缺少明确字段且关注列表不完整时保留未知。关注首次发现历史不用于粉丝列表。' :
    !state?.targetId ? '核对账号后开始记录首次发现时间。' :
    state.historyBaselineAt ? '历史基线已建立；「新增」仅标记本次扫描首次发现的账号。首次发现时间不是实际关注时间。' :
    '正在建立历史基线：已记录首次发现时间，首次完整扫描完成前不标记「新增」。'
  );

  const updatedText = $derived(
    state?.updatedAt ? `更新于 ${new Date(state.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '数据仅保存在此浏览器'
  );

  const emptyTitle = $derived(!state ? `从你的${listLabel}列表开始` : rows.length ? '没有符合条件的账号' : `等待页面加载${listLabel}列表`);
  const emptyDesc = $derived(
    !state ? '采集后，你可以在这里查看和筛选账号。' :
    rows.length ? '试试其他筛选条件，或继续采集。' :
    '等待 X 页面加载；可开启自动采集，或手动滚动。如果一直为 0，请查看下方说明。'
  );

  // 用户操作
  async function handleStart() {
    if (busy) return;
    showError();
    if (state) { confirmStart = true; return; }
    await beginScan();
  }

  async function beginScan() {
    if (busy) return;
    confirmStart = false;
    starting = true;
    try {
      await action(async () => {
        state = await command('START', { automatic, kind: viewKind });
        pageNumber = 0;
      });
    } finally {
      starting = false;
    }
  }

  async function handlePause() {
    await action(async () => {
      state = await command(isActive ? 'PAUSE' : 'RESUME', { automatic, kind: viewKind });
    });
  }

  async function handleAutoToggle() {
    await action(async () => {
      state = await command(state.auto?.enabled ? 'AUTO_STOP' : 'AUTO_START');
    });
  }

  function selectView(kind: 'following' | 'followers') {
    viewKind = kind;
    filter = 'all';
    badgeFilter = 'all';
    searchQuery = '';
    pageNumber = 0;
  }

  async function openList(kind: 'following' | 'followers') {
    await action(async () => {
      state = await command('OPEN_LIST', { kind, automatic });
      selectView(kind);
    });
  }

  async function handleClear() {
    await action(async () => {
      if (!confirm('清空本次扫描结果？首次发现历史会保留。')) return;
      state = await command('CLEAR');
      pageNumber = 0;
    });
  }

  async function handleResetHistory() {
    await action(async () => {
      const session = state;
      if (!confirm(`删除 @${session.owner} 的全部首次发现历史和本次结果？此操作无法恢复，下次扫描将重新建立基线。`)) return;
      state = await command('RESET_HISTORY', {
        owner: session.owner,
        targetId: session.targetId,
        startedAt: session.startedAt
      });
      pageNumber = 0;
    });
  }

  async function handleFriendship(u: any) {
    if (busy) return;
    const session = state;
    const canFollow = u.ownStatus === 'not_following';
    pendingUserId = u.id;
    await action(async () => {
      state = await command('FRIENDSHIP', {
        owner: session.owner,
        startedAt: session.startedAt,
        userId: u.id,
        action: u.canVerify ? 'verify_unfollow' : canFollow ? 'follow' : 'unfollow',
        expectedStatus: u.ownStatus
      });
    });
    pendingUserId = null;
  }

  onMount(() => {
    // 读取持久化主题或默认白天模式
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('xff_theme');
    } catch {}
    if (saved === 'dark' || saved === 'light') {
      applyTheme(saved);
    } else {
      applyTheme('light');
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.session) {
          state = changes.session.newValue || null;
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'STORAGE_FAILURE' && sender.id === chrome.runtime.id && !sender.tab) {
          void command('GET').then(value => { state = value; }).catch(err => showError(err.message));
        }
      });
    }

    void action(async () => {
      state = await command('GET');
      selectView(state?.scanKind === 'followers' ? 'followers' : 'following');
    });
  });
</script>

<div class="min-h-screen bg-[#f8fafc] text-slate-900 dark:bg-[#0b0e14] dark:text-slate-100 flex flex-col font-sans select-none antialiased transition-colors duration-200 relative overflow-x-hidden">
  <!-- 顶部微光氛围光环，提升纵深层次感 -->
  <div class="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_90%_45%_at_50%_-10%,rgba(29,155,240,0.08),transparent)] dark:bg-[radial-gradient(ellipse_90%_45%_at_50%_-10%,rgba(29,155,240,0.14),transparent)]" aria-hidden="true"></div>

  <Header {theme} onToggleTheme={handleToggleTheme} />

  <main class="flex-1 p-3 max-w-[460px] mx-auto w-full space-y-2.5 relative z-10">
    {#if confirmStart}
      <section id="start-confirmation" aria-label="确认重新扫描"
        class="rounded-2xl border border-amber-300/90 bg-amber-50/95 p-3.5 text-xs leading-relaxed text-amber-900 shadow-xs backdrop-blur-md dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
        <p class="font-medium">重新扫描我的{listLabel}会替换本次关注和粉丝结果，首次发现历史会保留。需要保留当前结果时，请取消重新扫描。</p>
        <div class="mt-2.5 flex gap-2">
          <button id="confirm-start" disabled={busy} onclick={beginScan}
            class="rounded-xl bg-slate-900 px-3.5 py-1.5 font-bold text-white shadow-xs hover:bg-[#1d9bf0] transition-colors dark:bg-white dark:text-slate-900 dark:hover:bg-sky-400 dark:hover:text-white">确认开始扫描</button>
          <button id="cancel-start" disabled={busy} onclick={() => { confirmStart = false; }}
            class="rounded-xl border border-amber-300 bg-white/80 px-3 py-1.5 font-semibold text-amber-800 hover:bg-amber-100/60 transition-colors dark:border-amber-800 dark:bg-[#1a202c]/60 dark:text-amber-300">取消</button>
        </div>
      </section>
    {/if}
    <ScanCard
      {viewKind}
      {listLabel}
      {scanningLabel}
      owner={ownerText}
      {ownerAvatar}
      statusText={statusText}
      isActive={isActive}
      isBusy={busy || confirmStart}
      {starting}
      {canPause}
      hasSession={hasSession}
      pauseText={pauseText}
      autoToggleText={autoToggleText}
      canToggleAuto={canToggleAuto}
      instruction={instructionText}
      autoStatus={autoStatusText}
      showAutoStatus={showAutoStatus}
      bind:automatic={automatic}
      onSelectView={selectView}
      onStart={handleStart}
      onPause={handlePause}
      onAutoToggle={handleAutoToggle}
      onFollowing={() => openList('following')}
      onFollowers={() => openList('followers')}
    />

    <!-- 显示操作错误及采集提示 -->
    <div
      id="error"
      class="notice error rounded-xl border border-rose-300 bg-rose-50/90 px-3 py-2 text-xs font-semibold text-rose-700 shadow-2xs dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
      role="alert"
      hidden={!errorMessage}
    >
      {errorMessage}
    </div>

    <div
      id="issue"
      class="notice rounded-xl border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs font-semibold text-amber-800 shadow-2xs dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
      role="status"
      hidden={!state?.issue}
    >
      {state?.issue || ''}
    </div>

    <StatsDeck
      listKind={viewKind}
      total={total}
      noCount={noCount}
      unverifiedCount={unverifiedCount}
      coverageText={coverageText}
    />

    <section class="results-section space-y-2" aria-labelledby="results-heading">
      <FilterBar
        listKind={viewKind}
        bind:filter={filter}
        bind:badgeFilter={badgeFilter}
        bind:searchQuery={searchQuery}
        resultCount={matching.length}
        historyStatusText={historyStatusText}
      />

      <div id="results" class="results-list space-y-1" aria-label="用户列表">
        {#each pagedUsers as u (u.id)}
          <UserCard
            {u}
            isBusy={busy}
            {pendingUserId}
            hasTarget={!!state?.targetId}
            onFriendship={handleFriendship}
          />
        {/each}
      </div>

      <div id="empty" class="empty my-6 flex flex-col items-center justify-center text-center p-6 rounded-2xl border border-dashed border-[#cfd9de] bg-[#f7f9f9]/70 dark:border-[#202327] dark:bg-[#121417]/50" hidden={matching.length > 0}>
        <div class="empty-icon mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#8b98a5] shadow-xs dark:bg-[#16181c] dark:text-[#536471] dark:shadow-none" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 8v4M12 16h.01"></path>
          </svg>
        </div>
        <strong class="text-xs font-bold text-[#0f1419] dark:text-[#e7e9ea]">{emptyTitle}</strong>
        <p class="mt-1 max-w-[240px] text-[11px] leading-relaxed text-[#536471] dark:text-[#71767b]">{emptyDesc}</p>
      </div>

      <nav class="pagination mt-2 flex items-center justify-between border-t border-[#eff3f4] pt-2 text-xs text-[#536471] dark:border-[#202327] dark:text-[#71767b]" id="pagination" aria-label="结果分页" hidden={pages <= 1}>
        <button
          id="prev"
          class="rounded-lg border border-[#cfd9de] bg-white px-3 py-1 text-xs font-medium text-[#0f1419] transition-colors hover:bg-[#f7f9f9] disabled:cursor-default disabled:opacity-35 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-[#e7e9ea] dark:hover:bg-[#1e2228]"
          disabled={pageNumber === 0}
          onclick={() => { pageNumber--; }}
        >
          上一页
        </button>
        <span id="page-label" class="font-semibold">{pageNumber + 1} / {pages} 页</span>
        <button
          id="next"
          class="rounded-lg border border-[#cfd9de] bg-white px-3 py-1 text-xs font-medium text-[#0f1419] transition-colors hover:bg-[#f7f9f9] disabled:cursor-default disabled:opacity-35 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-[#e7e9ea] dark:hover:bg-[#1e2228]"
          disabled={pageNumber >= pages - 1}
          onclick={() => { pageNumber++; }}
        >
          下一页
        </button>
      </nav>
    </section>

    <HelpDetails
      followersCount={followersCount}
      followersStatus={followersStatus}
      isResetDisabled={!state?.targetId || busy}
      onResetHistory={handleResetHistory}
    />

    <Footer
      updatedText={updatedText}
      isClearDisabled={!state || busy}
      onClear={handleClear}
    />
  </main>
</div>
