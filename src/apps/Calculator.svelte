<script lang="ts">
  let display = $state('0');
  let prev = $state<number | null>(null);
  let op = $state<string | null>(null);
  let resetNext = $state(false); // 下次输入数字时是否清空（刚算完/刚选运算符）

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
    display = Number.isFinite(r) ? String(+r.toFixed(10)) : '错误';
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

<div class="flex h-full flex-col gap-2 p-3">
  <!-- 显示屏 -->
  <div
    class="flex min-h-14 items-end justify-end overflow-hidden rounded-qz bg-qz-surface px-3 py-2 text-right text-3xl font-light tabular-nums"
  >
    {display}
  </div>

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
            onclick={() => press(key)}>{key}</button>
        {/each}
      </div>
    {/each}
  </div>
</div>
