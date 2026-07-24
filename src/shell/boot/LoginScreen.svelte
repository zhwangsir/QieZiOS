<script lang="ts">
  // M3/U7 登录页：壁纸 + 毛玻璃罩 + 用户列表（读 users.svelte.ts 用户表，访客 qiezi 也在列）。
  // 头像 = 首字母圆形 + Lucide User 角标；点击用户即进桌面（无密码，PIN 留待后续）。
  import { users } from '../../system/users.svelte';
  import { loginAs } from '../../system/session.svelte';
  import Icon from '../../lib/Icon.svelte';

  // 大时钟（登录页的时间感，与锁屏同款排版）
  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });
  const clock = $derived(
    now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
  );
  const date = $derived(
    now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
  );
</script>

<div
  class="fixed inset-0 z-[10004] select-none"
  style="background: var(--qz-wallpaper)"
>
  <!-- 毛玻璃罩：把壁纸压成登录页底色 -->
  <div class="absolute inset-0 bg-black/30 backdrop-blur-2xl"></div>

  <div class="relative flex h-full flex-col items-center justify-center px-6">
    <!-- 时钟 -->
    <div class="pointer-events-none mb-10 text-center text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
      <div class="text-lg font-medium opacity-90">{date}</div>
      <div class="mt-1 text-[5rem] font-semibold leading-none tracking-tight tabular-nums">{clock}</div>
    </div>

    <!-- 用户列表 -->
    <div class="flex flex-wrap items-start justify-center gap-8">
      {#each users.list as u (u.uid)}
        <button
          class="group flex w-24 flex-col items-center gap-2.5 outline-none"
          onclick={() => loginAs(u.name)}
        >
          <span
            class="relative grid h-20 w-20 place-items-center rounded-full border border-white/25 bg-white/15 text-3xl font-semibold text-white shadow-lg backdrop-blur-md transition group-hover:scale-105 group-hover:bg-white/25 group-focus-visible:ring-2 group-focus-visible:ring-white/70"
          >
            {u.name[0].toUpperCase()}
            <span class="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-qz-accent text-qz-accent-contrast shadow">
              <Icon name="User" size={13} />
            </span>
          </span>
          <span class="max-w-full truncate text-sm font-medium text-white/90 drop-shadow">{u.name}</span>
        </button>
      {/each}
    </div>

    <p class="pointer-events-none mt-10 text-xs text-white/60">点击用户进入桌面</p>
  </div>
</div>
