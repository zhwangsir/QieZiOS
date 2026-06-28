<script lang="ts">
  import { onMount } from 'svelte';
  import { evalExpr } from '../lib/calc';

  // ── 模式：标准（状态机）/ 科学（表达式 + 安全 parser） ──
  let mode = $state<'std' | 'sci'>('std');

  // ── 标准计算器（状态机，与原版完全一致，零回归） ──
  let display = $state('0');
  let prev = $state<number | null>(null);
  let op = $state<string | null>(null);
  let resetNext = $state(false); // 下次输入数字时是否清空（刚算完/刚选运算符）

  // 计算历史（本会话内存，最新在前；点一条把结果填回显示屏）
  let history = $state<{ expr: string; result: string }[]>([]);
  let showHistory = $state(false);

  let rootEl = $state<HTMLElement>();
  onMount(() => rootEl?.focus()); // 开窗即聚焦 → 立刻能用键盘

  function pushHistory(expr: string, result: string) {
    history.push({ expr, result });
    if (history.length > 30) history.shift();
  }

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
    if (result !== '错误') pushHistory(`${prev} ${op} ${cur}`, result);
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
    else if (key === '±') { if (Number.isFinite(parseFloat(display))) display = String(parseFloat(display) * -1); }
    else if (key === '%') { if (Number.isFinite(parseFloat(display))) display = String(parseFloat(display) / 100); }
    else if (key === '=') compute();
    else setOp(key); // ÷ × − +
  }

  // ── 科学计算器（表达式录入 + lib/calc 安全求值，非 eval） ──
  let expr = $state(''); // 当前表达式串（或上次结果）
  let sciResetNext = $state(false); // 刚 = 出结果：下次输入数字/函数从头开始、运算符则续算
  let sciErr = $state(false);
  let memory = $state(0);
  const sciDisplay = $derived(sciErr ? '错误' : expr === '' ? '0' : expr);

  function fmt(n: number): string {
    if (!Number.isFinite(n)) return '错误';
    return String(+n.toFixed(10));
  }
  function curVal(): number {
    try {
      return evalExpr(expr || '0');
    } catch {
      return NaN;
    }
  }
  // 插入 token。tok 以 + - × ÷ * / ^ ! 开头视为「续算」（接在结果后），否则（数字/函数/常量/括号）从头开始
  function sciInsert(tok: string) {
    if (sciErr) {
      sciErr = false;
      expr = '';
    }
    if (sciResetNext) {
      const continues = /^[+\-−×÷*/^!]/.test(tok); // 注意含 U+2212「−」（按钮/键盘插入的就是它），否则减号会丢弃结果
      if (!continues) expr = '';
      sciResetNext = false;
    }
    expr += tok;
  }
  function sciClear() {
    expr = '';
    sciErr = false;
    sciResetNext = false;
  }
  function sciBack() {
    if (sciErr) {
      sciErr = false;
      expr = '';
      return;
    }
    if (sciResetNext) return;
    expr = expr.slice(0, -1);
  }
  function sciNegate() {
    const v = curVal();
    if (Number.isFinite(v)) {
      expr = fmt(-v);
      sciResetNext = true;
      sciErr = false;
    }
  }
  function sciEquals() {
    if (!expr.trim()) return;
    try {
      const r = evalExpr(expr);
      if (!Number.isFinite(r)) {
        sciErr = true;
        return;
      }
      const result = fmt(r);
      pushHistory(expr, result);
      expr = result;
      sciResetNext = true;
    } catch {
      sciErr = true;
    }
  }
  function sciMem(action: 'MC' | 'MR' | 'M+' | 'M-') {
    if (action === 'MC') {
      memory = 0;
      return;
    }
    if (action === 'MR') {
      sciInsert(fmt(memory));
      return;
    }
    const v = curVal();
    if (!Number.isFinite(v)) return;
    memory += action === 'M+' ? v : -v;
  }
  // 科学按钮 → 动作映射
  function sciPress(key: string) {
    switch (key) {
      case 'C':
        return sciClear();
      case '⌫':
        return sciBack();
      case '=':
        return sciEquals();
      case '±':
        return sciNegate();
      case 'MC':
      case 'MR':
      case 'M+':
      case 'M-':
        return sciMem(key);
      case '√':
        return sciInsert('√(');
      case 'sin':
      case 'cos':
      case 'tan':
      case 'ln':
      case 'log':
        return sciInsert(key + '(');
      case 'x²':
        return sciInsert('^2');
      case '1/x':
        return sciInsert('^-1');
      case 'π':
        return sciInsert('π');
      case 'e':
        return sciInsert('e');
      default:
        return sciInsert(key); // 数字 . ( ) ^ ! ÷ × − +
    }
  }

  // ── 键盘：按模式分发 ──
  function onKey(e: KeyboardEvent) {
    // 带修饰键的组合（Cmd/Ctrl+C 复制、Ctrl+V 粘贴、Cmd+0/- 等）放行，别被当成计算器按键吞掉
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (mode === 'sci') {
      if (k >= '0' && k <= '9') sciInsert(k);
      else if (k === '.' || k === '(' || k === ')' || k === '^' || k === '!') sciInsert(k);
      else if (k === '+') sciInsert('+');
      else if (k === '-') sciInsert('−');
      else if (k === '*') sciInsert('×');
      else if (k === '/') sciInsert('÷');
      else if (k === 'Enter' || k === '=') sciEquals();
      else if (k === 'Backspace') sciBack();
      else if (k === 'c' || k === 'C' || k === 'Delete') sciClear();
      else return; // 其它键（含 Esc）冒泡 → 桌面关窗
      e.preventDefault();
      return;
    }
    // 标准模式
    if (k >= '0' && k <= '9') inputDigit(k);
    else if (k === '.') inputDot();
    else if (k === '+') setOp('+');
    else if (k === '-') setOp('−');
    else if (k === '*') setOp('×');
    else if (k === '/') setOp('÷');
    else if (k === 'Enter' || k === '=') compute();
    else if (k === 'Backspace') backspace();
    else if (k === '%') { if (Number.isFinite(parseFloat(display))) display = String(parseFloat(display) / 100); }
    else if (k === 'c' || k === 'C' || k === 'Delete') clearAll();
    else return; // 其它键（含 Esc）不处理 → 冒泡给桌面（Esc 关窗）
    e.preventDefault();
  }

  function recall(item: { result: string }) {
    if (mode === 'sci') {
      expr = item.result;
      sciResetNext = true;
      sciErr = false;
    } else {
      display = item.result;
      resetNext = true;
    }
    showHistory = false;
    rootEl?.focus();
  }
  function onButton(key: string) {
    if (mode === 'sci') sciPress(key);
    else press(key);
    rootEl?.focus(); // 点完按钮把焦点收回根 → 键盘继续可用
  }

  const rows = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['0', '.', '='],
  ];
  // 科学键盘：5 列。最后一行 0 占 2 列、= 占 3 列。
  const sciRows = [
    ['MC', 'MR', 'M+', 'M-', 'C'],
    ['sin', 'cos', 'tan', '√', '⌫'],
    ['ln', 'log', 'x²', '^', '÷'],
    ['1/x', '!', '(', ')', '×'],
    ['π', '7', '8', '9', '−'],
    ['e', '4', '5', '6', '+'],
    ['±', '1', '2', '3', '.'],
    ['0', '='],
  ];
  const isOp = (k: string) => '÷×−+'.includes(k);
  const isFn = (k: string) => 'C±%'.includes(k);
  // 科学键分类（着色用）：运算符 / 等号强调；功能键（函数/内存/常量/控制）次强调；数字默认
  const sciOpKey = (k: string) => '÷×−+'.includes(k) || k === '^';
  const sciNumKey = (k: string) => (k >= '0' && k <= '9') || k === '.';
  const sciAccent = (k: string) => k === '=';
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
  <!-- 顶栏：标准/科学 切换 + 历史开关 -->
  <div class="flex shrink-0 items-center justify-between">
    <div class="flex overflow-hidden rounded text-[11px] ring-1 ring-qz-border">
      <button
        class="px-2 py-0.5 transition"
        class:bg-qz-accent={mode === 'std'}
        class:text-qz-accent-contrast={mode === 'std'}
        class:hover:bg-qz-elevated={mode !== 'std'}
        tabindex="-1"
        onclick={() => { mode = 'std'; rootEl?.focus(); }}>标准</button>
      <button
        class="px-2 py-0.5 transition"
        class:bg-qz-accent={mode === 'sci'}
        class:text-qz-accent-contrast={mode === 'sci'}
        class:hover:bg-qz-elevated={mode !== 'sci'}
        tabindex="-1"
        onclick={() => { mode = 'sci'; rootEl?.focus(); }}>科学</button>
    </div>
    <button
      class="rounded px-2 py-0.5 text-xs text-qz-muted hover:bg-qz-elevated"
      class:bg-qz-elevated={showHistory}
      title="计算历史"
      tabindex="-1"
      onclick={() => { showHistory = !showHistory; rootEl?.focus(); }}>🕘 历史</button>
  </div>

  <!-- 显示屏 -->
  <div
    class="flex min-h-14 items-end justify-end overflow-x-auto overflow-y-hidden rounded-qz bg-qz-surface px-3 py-2 text-right font-light tabular-nums {mode === 'sci' ? 'text-2xl' : 'text-3xl'}"
  >
    <span class="whitespace-nowrap">{mode === 'sci' ? sciDisplay : display}</span>
  </div>

  {#if mode === 'sci' && memory !== 0 && !showHistory}
    <div class="-mt-1 shrink-0 text-right text-[10px] text-qz-muted">M = {fmt(memory)}</div>
  {/if}

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
  {:else if mode === 'sci'}
    <!-- 科学键盘（5 列） -->
    <div class="grid flex-1 grid-cols-5 gap-1.5">
      {#each sciRows as row (row[0])}
        {#each row as key (key)}
          <button
            class="rounded-qz text-sm font-medium transition-transform active:scale-95"
            class:col-span-2={key === '0'}
            class:col-span-3={key === '='}
            class:bg-qz-elevated={sciNumKey(key)}
            class:bg-qz-accent={sciOpKey(key) || sciAccent(key)}
            class:text-qz-accent-contrast={sciOpKey(key) || sciAccent(key)}
            style={!sciNumKey(key) && !sciOpKey(key) && !sciAccent(key)
              ? 'background: color-mix(in srgb, var(--color-qz-text) 12%, transparent)'
              : ''}
            tabindex="-1"
            onclick={() => onButton(key)}>{key}</button>
        {/each}
      {/each}
    </div>
  {:else}
    <!-- 标准键盘 -->
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
