<script>
  import '../app.css';
  import { page } from '$app/stores';

  let { children } = $props();

  const nav = [
    { href: '/', label: 'Overview', code: '00' },
    { href: '/backlog', label: 'Backlog', code: '01' },
    { href: '/audit', label: 'Audit Log', code: '02' },
    { href: '/guardrails', label: 'Guardrails', code: '03' },
    { href: '/evals', label: 'Evals', code: '04' },
    { href: '/controls', label: 'Controls', code: '05' }
  ];

  const isActive = (href, path) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<div class="shell">
  <aside class="rail">
    <a class="mark" href="/">
      <span class="mark-glyph">A</span>
      <span class="mark-text">
        <span class="mark-name">ADG</span>
        <span class="mark-sub">Governance Ledger</span>
      </span>
    </a>

    <nav>
      {#each nav as item}
        <a href={item.href} class="nav-item" class:active={isActive(item.href, $page.url.pathname)}>
          <span class="nav-code">{item.code}</span>
          <span class="nav-label">{item.label}</span>
          <span class="nav-arrow" aria-hidden="true">&rarr;</span>
        </a>
      {/each}
    </nav>

    <div class="rail-foot">
      <p class="rail-foot-line">SQL-first &middot; deny-by-default</p>
      <p class="rail-foot-line dim">read-only view &middot; no auth</p>
    </div>
  </aside>

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--rail-w) 1fr;
    min-height: 100vh;
  }

  .rail {
    background: var(--ink);
    color: var(--paper);
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100vh;
    padding: 28px 0;
  }

  .mark {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 24px 28px;
    text-decoration: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  }

  .mark-glyph {
    font-family: var(--serif);
    font-style: italic;
    font-size: 34px;
    line-height: 1;
  }

  .mark-name {
    display: block;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.28em;
  }

  .mark-sub {
    display: block;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  nav {
    flex: 1;
    padding-top: 16px;
  }

  .nav-item {
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding: 13px 24px;
    text-decoration: none;
    font-size: 12px;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.66);
    transition: color 0.12s ease, background 0.12s ease;
  }

  .nav-code {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.35);
  }

  .nav-arrow {
    margin-left: auto;
    opacity: 0;
    transform: translateX(-6px);
    transition: opacity 0.15s ease, transform 0.15s ease;
  }

  .nav-item:hover {
    color: var(--paper);
  }

  .nav-item:hover .nav-arrow {
    opacity: 1;
    transform: none;
  }

  .nav-item.active {
    background: var(--paper);
    color: var(--ink);
  }

  .nav-item.active .nav-code {
    color: var(--grey-3);
  }

  .nav-item.active .nav-arrow {
    opacity: 1;
    transform: none;
  }

  .rail-foot {
    padding: 20px 24px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
  }

  .rail-foot-line {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.6);
  }

  .rail-foot-line.dim {
    color: rgba(255, 255, 255, 0.32);
  }

  .content {
    padding: 48px 56px 72px;
    min-width: 0;
  }

  @media (max-width: 860px) {
    .shell {
      grid-template-columns: 1fr;
    }
    .rail {
      position: static;
      height: auto;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
    }
    .content {
      padding: 32px 20px 56px;
    }
  }
</style>
