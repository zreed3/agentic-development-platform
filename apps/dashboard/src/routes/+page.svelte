<script>
  let { data } = $props();

  const fmtDate = (iso) =>
    iso
      ? new Date(iso).toLocaleString('en-AU', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';

  const cfr = data.dora?.changeFailureRateProxy?.ratio;
</script>

<svelte:head><title>ADG — Overview</title></svelte:head>

<header class="rise">
  <p class="label">Agentic Development Platform</p>
  <h1 class="page-title">The state of <em>the system</em></h1>
</header>

<section class="stats rise">
  <div class="stat">
    <span class="stat-figure">{data.featureCount}</span>
    <span class="label">Features</span>
  </div>
  <div class="stat">
    <span class="stat-figure">{data.taskCount}</span>
    <span class="label">Tasks</span>
  </div>
  <div class="stat">
    <span class="stat-figure">{data.eventCount}</span>
    <span class="label">Audit events</span>
  </div>
  <div class="stat">
    <span class="stat-figure">
      {#if data.evals}{data.evals.passed}<span class="stat-of">/{data.evals.total}</span>{:else}—{/if}
    </span>
    <span class="label">Evals passing</span>
  </div>
  <div class="stat" class:alert={data.violations > 0}>
    <span class="stat-figure">{data.violations}</span>
    <span class="label">Gate violations</span>
  </div>
</section>

<section class="cols">
  <div class="col rise">
    <div class="col-head">
      <h2 class="label">Feature status</h2>
      <a class="more" href="/backlog">Backlog &rarr;</a>
    </div>
    {#each data.counts as row}
      <div class="bar-row">
        <span class="bar-label">{row.status}</span>
        <span class="bar-track">
          <span class="bar-fill" style:width="{(row.n / data.featureCount) * 100}%"></span>
        </span>
        <span class="num bar-n">{row.n}</span>
      </div>
    {/each}

    <div class="col-head sub">
      <h2 class="label">Delivery proxies</h2>
      <span class="dim small">{data.dora?.window ?? ''}</span>
    </div>
    {#if data.dora}
      <dl class="kv">
        <div><dt class="label">Commits / 30d</dt><dd class="num">{data.dora.deploymentFrequencyProxy?.commitsLast30Days ?? '—'}</dd></div>
        <div><dt class="label">Release evidence</dt><dd class="num">{data.dora.deploymentFrequencyProxy?.releaseEvidenceEvents ?? '—'}</dd></div>
        <div><dt class="label">Audit window</dt><dd class="num">{data.dora.changeLeadTimeProxy?.auditWindowHours ?? '—'} h</dd></div>
        <div><dt class="label">Change failure</dt><dd class="num">{cfr != null ? Math.round(cfr * 100) + '%' : '—'}</dd></div>
      </dl>
    {:else}
      <p class="dim">Run <code>npm run metrics:dora</code> to capture delivery metrics.</p>
    {/if}

    <div class="col-head sub">
      <h2 class="label">Policy</h2>
      <a class="more" href="/guardrails">Guardrails &rarr;</a>
    </div>
    <dl class="kv">
      <div><dt class="label">Version</dt><dd class="small">{data.policyVersion ?? '—'}</dd></div>
      <div><dt class="label">Governed tools</dt><dd class="num">{data.toolCount}</dd></div>
      <div><dt class="label">Default decision</dt><dd><span class="pill solid">deny</span></dd></div>
    </dl>
  </div>

  <div class="col rise">
    <div class="col-head">
      <h2 class="label">Latest audit events</h2>
      <a class="more" href="/audit">Full log &rarr;</a>
    </div>
    <ol class="feed">
      {#each data.recentEvents as ev}
        <li class="feed-item">
          <div class="feed-meta">
            <span class="pill">{ev.eventType}</span>
            <span class="dim small num">{fmtDate(ev.occurredAt)}</span>
            {#if ev.featureId}<span class="small">{ev.featureId}</span>{/if}
          </div>
          <p class="feed-summary">{ev.summary}</p>
        </li>
      {/each}
    </ol>
  </div>
</section>

<style>
  header {
    padding-bottom: 36px;
  }

  .page-title {
    margin-top: 10px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    border-top: var(--hairline);
    border-bottom: var(--hairline);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 26px 20px 22px 0;
  }

  .stat + .stat {
    border-left: 1px solid var(--grey-2);
    padding-left: 20px;
  }

  .stat.alert .stat-figure {
    background: var(--ink);
    color: var(--paper);
    padding: 0 12px;
    align-self: flex-start;
  }

  .stat-of {
    font-size: 0.45em;
    color: var(--grey-3);
  }

  .cols {
    display: grid;
    grid-template-columns: 1fr 1.2fr;
    gap: 56px;
    padding-top: 40px;
  }

  .col-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    border-bottom: var(--hairline);
    padding-bottom: 8px;
    margin-bottom: 16px;
  }

  .col-head.sub {
    margin-top: 36px;
  }

  .more {
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-decoration: none;
  }

  .more:hover {
    background: var(--ink);
    color: var(--paper);
  }

  .bar-row {
    display: grid;
    grid-template-columns: 110px 1fr 28px;
    align-items: center;
    gap: 14px;
    padding: 7px 0;
  }

  .bar-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .bar-track {
    height: 14px;
    background: var(--grey-1);
    position: relative;
  }

  .bar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--ink);
    animation: grow 0.8s cubic-bezier(0.22, 1, 0.36, 1) both;
    transform-origin: left;
  }

  @keyframes grow {
    from { transform: scaleX(0); }
  }

  .bar-n {
    text-align: right;
    font-size: 12px;
  }

  .kv {
    display: flex;
    flex-direction: column;
  }

  .kv > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid var(--grey-2);
  }

  .kv dd {
    font-size: 13px;
  }

  .small {
    font-size: 11px;
  }

  .feed {
    list-style: none;
  }

  .feed-item {
    padding: 14px 0;
    border-bottom: 1px solid var(--grey-2);
  }

  .feed-meta {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 6px;
  }

  .feed-summary {
    font-size: 12.5px;
    line-height: 1.55;
  }

  @media (max-width: 1100px) {
    .stats {
      grid-template-columns: repeat(2, 1fr);
    }
    .stat + .stat {
      border-left: 0;
      padding-left: 0;
    }
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
