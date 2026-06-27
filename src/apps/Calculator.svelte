<script lang="ts">
  import { onMount } from 'svelte';

  let display = $state('0');
  let prev = $state<number | null>(null);
  let op = $state<string | null>(null);
  let resetNext = $state(false); // 下次输入数字时是否清空（刚算完/刚选运算符）

  // 计算历史（本会话内存，最新在前；点一条把结果填回显示屏）
  let history = $state<{ expr: string; result: string }[]>([]);
  let showHistory = $state(false);

  let rootEl = $state<HTMLElement>();
  onMount(() => rootEl?.focus()); // 开窗即聚焦 → 立刻能用键盘

  function inputDigit(d: string) {
    if (resetNext) {
      display = d;
      resetNext = false;
    } else {
      display = display === '0' ? d : display + d;
    }
  }
  function inputDot() {
    if (resetNext) {
      display = '0.';
      resetNext = false;
    } else if (!display.includes('.')) {
      display += '.';
    }
  }
  function backspace() {
    if (resetNext) return; // 刚算完/刚选运算符，退格无意义
    display = display.length > 1 ? display.slice(0, -1) : '0';
    if (display === '-' || display === '') display = '0';
  }
  function clearAll() {
    display = '0';
    prev = null;
    op = null;
    resetNext = false;
  }
  function compute() {
    if (op === null || prev === null) return;
    const cur = parseFloat(display);
    let r = 0;
    if (op === '+') r = prev + cur;
    else if (op === '−') r = prev - cur;
    else if (op === '×') r = prev * cur;
    else if (op === '÷') r = cur === 0 ? NaN : prev / cur;
    const result = Number.isFinite(r) ? String(+r.toFixed(10)) : '错误';
    if (result !== '错误') {
      history.push({ expr: `${prev} ${op} ${cur}`, result });
      if (history.length > 30) history.shift();
    }
    display = result;
    prev = null;
    op = null;
    resetNext = true;
  }
  function setOp(o: string) {
    if (op !== null && !resetNext) compute();
    prev = parseFloat(display);
    op = o;
    resetNext = true;
  }

  // 统一分发：按钮只携带 label，点击时按 label 决定动作（避免把函数塞进 each）
  function press(key: string) {
    if (key >= '0' && key <= '9') inputDigit(key);
    else if (key === '.') inputDot();
    else if (key === 'C') clearAll();
    else if (key === '±') display = String(parseFloat(display) * -1);
    else if (key === '%') display = String(parseFloat(display) / 100);
    else if (key === '=') compute();
    else setOp(key); // ÷ × − +
  }

  // 键盘：数字/./运算符/Enter=等于/Backspace 退格/c·Delete 清空。Esc 不拦 → 仍能关窗。
  function onKey(e: KeyboardEvent) {
    // 带修饰键的组合（Cmd/Ctrl+C 复制、Ctrl+V 粘贴、Cmd+0/- 等）放行，别被当成计算器按键吞掉
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k >= '0' && k <= '9') inputDigit(k);
    else if (k === '.') inputDot();
    else if (k === '+') setOp('+');
    else if (k === '-') setOp('−');
    else if (k === '*') setOp('×');
    else if (k === '/') setOp('÷');
    else if (k === 'Enter' || k === '=') compute();
    else if (k === 'Backspace') backspace();
    else if (k === '%') display = String(parseFloat(display) / 100);
    else if (k === 'c' || k === 'C' || k === 'Delete') clearAll();
    else return; // 其它键（含 Esc）不处理 → 冒泡给桌面（Esc 关窗）
    e.preventDefault();
  }

  function recall(item: { result: string }) {
    display = item.result;
    resetNext = true;
    showHistory = false;
    rootEl?.focus();
  }
  function onButton(key: string) {
    press(key);
    rootEl?.focus(); // 点完按钮把焦点收回根 → 键盘继续可用
  }

  const rows = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['0', '.', '='],
  ];
  const isOp = (k: string) => '÷×−+'.includes(k);
  const isFn = (k: string) => 'C±%'.includes(k);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={rootEl}
  class="flex h-full flex-col gap-2 p-3 outline-none"
  tabindex="0"
  role="presentation"
  onkeydown={onKey}
>
  <!-- 顶栏：历史开关 -->
  <div class="flex shrink-0 items-center justify-end">
    <button
      class="rounded px-2 py-0.5 text-xs text-qz-muted hover:bg-qz-elevated"
      class:bg-qz-elevated={showHistory}
      title="计算历史"
      tabindex="-1"
      onclick={() => { showHistory = !showHistory; rootEl?.focus(); }}>🕘 历史</button>
  </div>

  <!-- 显示屏 -->
  <div
    class="flex min-h-14 items-end justify-end overflow-hidden rounded-qz bg-qz-surface px-3 py-2 text-right text-3xl font-light tabular-nums"
  >
    {display}
  </div>

  {#if showHistory}
    <!-- 历史面板（替换键盘区） -->
    <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto rounded-qz bg-qz-surface/60 p-2">
      {#if history.length === 0}
        <div class="grid flex-1 place-items-center text-sm text-qz-muted">暂无历史</div>
      {:else}
        <div class="mb-1 flex items-center justify-between">
          <span class="text-[11px] text-qz-muted">点一条填回结果</span>
          <button class="rounded px-1.5 py-0.5 text-[11px] text-qz-muted hover:bg-qz-elevated" tabindex="-1" onclick={() => (history = [])}>清空</button>
        </div>
        {#each [...history].reverse() as h, i (history.length - i)}
          <button
            class="flex w-full flex-col items-end rounded px-2 py-1 text-right hover:bg-qz-elevated"
            tabindex="-1"
            onclick={() => recall(h)}
          >
            <span class="text-[11px] text-qz-muted">{h.expr} =</span>
            <span class="tabular-nums">{h.result}</span>
          </button>
        {/each}
      {/if}
    </div>
  {:else}
    <!-- 按键 -->
    <div class="flex flex-1 flex-col gap-2">
      {#each rows as row (row[0])}
        <div class="grid flex-1 grid-cols-4 gap-2">
          {#each row as key (key)}
            <button
              class="rounded-qz text-lg font-medium transition-transform active:scale-95"
              class:col-span-2={key === '0'}
              class:bg-qz-elevated={!isOp(key) && !isFn(key) && key !== '='}
              class:bg-qz-accent={isOp(key) || key === '='}
              class:text-qz-accent-contrast={isOp(key) || key === '='}
              style={isFn(key) ? 'background: color-mix(in srgb, var(--color-qz-text) 12%, transparent)' : ''}
              tabindex="-1"
              onclick={() => onButton(key)}>{key}</button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>
