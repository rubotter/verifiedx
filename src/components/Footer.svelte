<script lang="ts">
  let {
    updatedText = '数据仅保存在此浏览器',
    isClearDisabled = true,
    onClear
  } = $props<{
    updatedText: string;
    isClearDisabled: boolean;
    onClear: () => void;
  }>();
</script>

<footer class="mt-5 mb-2 flex items-center justify-between border-t border-[#eff3f4] pt-3 text-[11px] text-[#8b98a5] dark:border-[#202327] dark:text-[#536471]">
  <span id="updated" class="truncate">{updatedText}</span>
  <button
    id="clear"
    class="text-button shrink-0 rounded px-2 py-0.75 text-[11px] font-medium text-[#536471] transition-colors hover:text-[#e11d48] disabled:cursor-default disabled:opacity-35 dark:text-[#71767b] dark:hover:text-[#f87171]"
    disabled={isClearDisabled}
    onclick={onClear}
  >
    清空本次结果
  </button>
</footer>
