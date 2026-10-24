<script lang="ts">
  const C = (globalThis as any).XFF || {
    badgeCategory: (v: string) => v,
    badgeLabel: (v: string) => v,
    relationshipLabel: (v: string) => v,
    ownStatusLabel: (v: string) => v
  };

  let {
    u,
    isBusy = false,
    pendingUserId = null,
    hasTarget = false,
    onFriendship
  } = $props<{
    u: any;
    isBusy: boolean;
    pendingUserId: string | null;
    hasTarget: boolean;
    onFriendship: (u: any) => void;
  }>();

  let imgFailed = $state(false);

  $effect(() => {
    if (u?.id || u?.avatarUrl) {
      imgFailed = false;
    }
  });

  const isFollower = $derived(u.listKind === 'followers');
  const relationTone = $derived(isFollower ? (u.ownStatus === 'following' ? 'yes' : u.ownStatus === 'not_following' ? 'no' : 'unknown') : u.relationship);
  const relationText = $derived(isFollower ? C.ownStatusLabel(u.ownStatus, 'followers') : C.relationshipLabel(u.relationship));
  const initial = $derived(Array.from(u.name || u.username)[0]?.toUpperCase() || '?');
  const canFollow = $derived(u.ownStatus === 'not_following');
  const isUnfollow = $derived(u.ownStatus === 'following');
  const isPendingThis = $derived(pendingUserId === u.id && isBusy);

  const actionText = $derived(
    isPendingThis ? (u.ownStatus === 'verifying' ? '正在验证…' : '处理中…') : u.canVerify ? '重新验证' : canFollow ? '关注' : isUnfollow ? '取关' : (C.ownStatusLabel(u.ownStatus, u.listKind) || '操作')
  );

  const ariaLabel = $derived(
    `${u.canVerify ? '重新验证' : canFollow ? '关注' : isUnfollow ? '取关' : (C.ownStatusLabel(u.ownStatus) || '操作')} @${u.username}`
  );

  const isButtonDisabled = $derived(
    isBusy || !hasTarget || (!u.canVerify && !['following', 'not_following'].includes(u.ownStatus))
  );

  const badgeCat = $derived(
    ['blue', 'business', 'government', 'none'].includes(u.badge)
      ? u.badge
      : (u.blue === true ? 'blue' : 'unknown')
  );

  const badgeInfo = $derived(
    badgeCat === 'blue'
      ? { title: '蓝 V', color: '#1d9bf0' }
      : badgeCat === 'business'
      ? { title: '企业认证 (黄 V)', color: '#f4b41a' }
      : badgeCat === 'government'
      ? { title: '政府认证 (灰 V)', color: '#829aab' }
      : null
  );

  const firstSeenText = $derived(
    Number.isFinite(u.firstSeenAt)
      ? `首次发现 ${new Date(u.firstSeenAt).toLocaleString('zh-CN', { hour12: false })}`
      : '首次发现时间尚未记录'
  );
</script>

<article
  class="person group flex min-w-0 items-center gap-2.5 rounded-xl border bg-white px-3 py-2 shadow-2xs transition-all duration-150 hover:shadow-xs {relationTone === 'no' ? 'border-slate-200/90 border-l-[3px] border-l-rose-500 hover:border-rose-300 dark:border-slate-800/90 dark:border-l-rose-500 dark:hover:border-rose-900/60' : 'border-slate-200/80 hover:border-slate-300 dark:border-slate-800/80 dark:hover:border-slate-700'} dark:bg-[#151921] hover:bg-slate-50/90 dark:hover:bg-[#1a202c]"
  data-user-id={u.id}
>
  <!-- 1. 头像（真实头像，失败时优雅回退；认证账号附带推特官方 V 标） -->
  <div class="relative shrink-0">
    {#if u.avatarUrl && !imgFailed}
      <img
        class="avatar h-9 w-9 rounded-full border border-black/5 object-cover dark:border-white/10"
        src={u.avatarUrl}
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        onerror={() => { imgFailed = true; }}
      />
    {:else}
      <span
        class="avatar avatar-fallback flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-bold text-slate-800 dark:from-slate-800 dark:to-slate-900 dark:text-slate-200"
        aria-hidden="true"
      >
        {initial}
      </span>
    {/if}

    {#if badgeInfo}
      <span
        class="badge-icon absolute -top-1 -right-1 flex h-4 w-4 shrink-0 items-center justify-center drop-shadow-xs"
        data-badge={badgeCat}
        title={badgeInfo.title}
        aria-label={badgeInfo.title}
      >
        <svg
          class="h-full w-full"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <!-- 推特官方 8 瓣多边花形认证印章底座 -->
          <path
            fill={badgeInfo.color}
            stroke="white"
            stroke-width="1.5"
            stroke-linejoin="round"
            style="paint-order: stroke fill;"
            class="dark:stroke-[#151921]"
            d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
          />
          <!-- 纯白实心对勾 -->
          <path
            fill="#ffffff"
            d="M10.54 16.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"
          />
        </svg>
      </span>
    {/if}
  </div>

  <!-- 2. 用户信息（用户名、handle、新增、首次发现） -->
  <div class="person-meta flex min-w-0 flex-1 flex-col justify-center gap-0.5 leading-snug">
    <div class="person-name-row flex min-w-0 items-center gap-1.5">
      <a
        class="person-name truncate text-[12.5px] font-bold text-slate-900 hover:text-[#1d9bf0] transition-colors dark:text-slate-100 dark:hover:text-[#1d9bf0]"
        href="https://x.com/{u.username}"
        target="_blank"
        rel="noopener noreferrer"
      >
        {u.name}
      </a>
      <a
        class="person-link shrink-0 text-[10px] leading-none text-slate-400 hover:text-[#1d9bf0] dark:text-slate-500 transition-colors"
        href="https://x.com/{u.username}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="打开 {u.username} 的主页"
      >
        ↗
      </a>
      {#if !isFollower && u.isNew}
        <span
          class="tag new-account shrink-0 rounded-full bg-sky-50 px-1.5 py-0.2 text-[9px] font-bold text-[#0284c7] border border-sky-200/80 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-[#38bdf8] shadow-2xs"
          title="历史基线建立后，本次扫描首次发现的账号；不代表实际关注时间。"
        >
          新增
        </span>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 min-w-0">
      <span class="handle shrink-0 max-w-[120px] truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">@{u.username?.replace(/^@+/, '')}</span>
      {#if !isFollower}
      <span class="text-slate-300 dark:text-slate-700 text-[10px] select-none shrink-0">·</span>
      <span class="first-seen text-[9.5px] text-slate-400 dark:text-slate-500 truncate min-w-0" title={firstSeenText}>
        {firstSeenText}
      </span>
      {/if}
    </div>

    {#if (!isFollower && u.ownStatus !== 'following') || u.verifiedAt || u.canVerify}
      <div class="mt-0.5">
        <span
          title={u.verifiedAt ? `验证时间：${new Date(u.verifiedAt).toLocaleString('zh-CN', { hour12: false })}` : undefined}
          class="own-status {u.ownStatus} inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold leading-tight shadow-2xs {u.ownStatus === 'not_following' ? 'border border-rose-200/90 bg-rose-50 text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400' : 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400'}"
        >
          <span class="h-1 w-1 rounded-full {u.ownStatus === 'not_following' ? 'bg-rose-500' : 'bg-amber-500'}"></span>
          {u.verifiedAt ? (u.ownStatus === 'not_following' ? '已取关 · 已验证' : '仍在关注 · 已验证') : C.ownStatusLabel(u.ownStatus)}
        </span>
      </div>
    {/if}
  </div>

  <!-- 3. 状态标签（回关状态，带颜色指示微标） -->
  <div class="tags flex shrink-0 items-center justify-end">
    <span
      class="tag {relationTone} inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.75 text-[9.5px] font-bold leading-none shadow-2xs {relationTone === 'no' ? 'border border-rose-200/90 bg-rose-50/90 text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400' : relationTone === 'yes' ? 'border border-emerald-200/90 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border border-slate-200/80 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-[#1a202c]/70 dark:text-slate-400'}"
      title={isFollower ? u.ownEvidence : u.evidence}
    >
      <span class="h-1.5 w-1.5 rounded-full {relationTone === 'no' ? 'bg-rose-500' : relationTone === 'yes' ? 'bg-emerald-500' : 'bg-slate-400'}"></span>
      {relationText}
    </span>
  </div>

  <!-- 4. 取关/关注按钮（高对比焦点按钮） -->
  <div class="person-action flex shrink-0 items-center">
    <button
      class="friendship-button inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold leading-none shadow-2xs transition-all duration-150 disabled:cursor-default disabled:opacity-40 {canFollow ? 'bg-slate-900 text-white hover:bg-sky-600 hover:shadow-xs active:scale-95 dark:bg-white dark:text-slate-900 dark:hover:bg-sky-400 dark:hover:text-white' : isUnfollow ? 'unfollow border border-slate-300/90 bg-white text-slate-700 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-600 active:scale-95 dark:border-slate-700 dark:bg-[#1a202c] dark:text-slate-200 dark:hover:border-rose-800 dark:hover:bg-rose-950/50 dark:hover:text-rose-300' : 'border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 active:scale-95 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300'}"
      disabled={isButtonDisabled}
      aria-label={ariaLabel}
      onclick={() => onFriendship(u)}
    >
      {actionText}
    </button>
  </div>
</article>
