<script lang="ts">
  let {
    followersCount = 0,
    followersStatus = '尚未采集。',
    isResetDisabled = true,
    onResetHistory
  } = $props<{
    followersCount: number;
    followersStatus: string;
    isResetDisabled: boolean;
    onResetHistory: () => void;
  }>();
</script>

<details class="help group mt-4 rounded-xl border border-[#cfd9de] bg-[#f7f9f9] p-3 transition-colors hover:border-[#b9cad2] dark:border-[#202327] dark:bg-[#0f1216] dark:hover:border-[#2f3336]">
  <summary class="flex cursor-pointer select-none items-center justify-between text-xs font-semibold text-[#536471] hover:text-[#0f1419] focus:outline-none dark:text-[#71767b] dark:hover:text-[#e7e9ea]">
    <div class="flex items-center gap-1.5">
      <svg class="h-3.5 w-3.5 text-[#8b98a5] transition-transform group-open:rotate-90 dark:text-[#536471]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
      <span>说明与依据</span>
    </div>
    <span class="followers-pill inline-flex items-center gap-1 rounded-full border border-[#cfd9de] bg-white px-2 py-0.5 text-[10.5px] font-medium text-[#536471] dark:border-[#2f3336] dark:bg-[#16181c] dark:text-[#71767b]">
      粉丝 <span id="followers-count" class="font-bold text-[#0f1419] dark:text-[#e7e9ea]">{followersCount}</span>
    </span>
  </summary>

  <div class="help-content mt-3 border-t border-[#eff3f4] pt-3 text-xs leading-relaxed text-[#536471] dark:border-[#202327] dark:text-[#71767b]">
    <div class="help-followers-row mb-2.5 flex items-center gap-1.5 rounded-md border border-[#eff3f4] bg-white px-2.5 py-1.75 dark:border-[#202327] dark:bg-[#16181c]">
      <span class="help-followers-label text-[11px] font-medium text-[#536471] dark:text-[#71767b]">粉丝采集状态：</span>
      <span id="followers-status" class="text-[11px] font-semibold text-[#0f1419] dark:text-[#e7e9ea]">{followersStatus}</span>
    </div>

    <ul class="help-list space-y-1.5 pl-4 list-disc text-[11px] text-[#536471] dark:text-[#71767b]">
      <li><strong class="text-[#0f1419] dark:text-[#e7e9ea]">自动采集：</strong>粉丝列表自动滚动，由 X 加载；关注列表通过 API 自动分页。保持扫描标签页可见，遇无新增或限流会自动停止。</li>
      <li><strong class="text-[#0f1419] dark:text-[#e7e9ea]">回关依据：</strong>来自页面明确返回的关系字段，或与完整粉丝列表对比。</li>
      <li><strong class="text-[#0f1419] dark:text-[#e7e9ea]">粉丝筛选：</strong>「我未关注」来自明确关系或完整关注列表对比；资料不足保留关注未知。可扫描另一类列表补充，顶部切换仅查看结果。</li>
      <li><strong class="text-[#0f1419] dark:text-[#e7e9ea]">数据安全：</strong>数据保存在本地浏览器，不上传任何云端服务器。</li>
      <li><strong class="text-[#0f1419] dark:text-[#e7e9ea]">取关验证：</strong>取关后自动查询确认，最多 3 次。待核对时可重新验证，只查询、不重复取关。</li>
      <li><strong class="text-[#0f1419] dark:text-[#e7e9ea]">首次发现：</strong>按数字账号 ID 保存。重新扫描、清空本次结果均保留历史；新增徽章仅在首次发现的扫描中显示。</li>
    </ul>

    <div class="mt-3.5 border-t border-[#eff3f4] pt-2.5 text-right dark:border-[#202327]">
      <button
        id="reset-history"
        class="text-button rounded-md border border-[rgba(244,33,46,0.3)] bg-[rgba(244,33,46,0.06)] px-2.5 py-1 text-[11px] font-medium text-[#e11d48] transition-all hover:bg-[rgba(244,33,46,0.14)] disabled:cursor-default disabled:opacity-35 dark:border-[rgba(244,33,46,0.25)] dark:bg-[rgba(244,33,46,0.08)] dark:text-[#f87171] dark:hover:bg-[rgba(244,33,46,0.18)]"
        disabled={isResetDisabled}
        onclick={onResetHistory}
      >
        删除当前账号历史及结果
      </button>
    </div>
  </div>
</details>
