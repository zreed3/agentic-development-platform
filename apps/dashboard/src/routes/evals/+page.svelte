<script>
  let { data } = $props();

  const r = data.report;

  const fmtDate = (iso) =>
    iso
      ? new Date(iso).toLocaleString('en-AU', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';
</script>

<svelte:head><title>ADG — Evals</title></svelte:head>

<header class="rise">
  <p class="label">04 / AI-security scenarios</p>
  <h1 class="page-title">Agent <em>evals</em></h1>
</header>

{#if !r}
  <p class="dim rise">No eval report found. Run <code>npm run agent:evals</code> at the repo root.</p>
{:else}
  <section class="scoreline rise">
    <div class="score">
      <span class="stat-figure">{r.passed}<span class="of">/{r.scenarioCount}</span></span>
      <span class="label">Scenarios passing</span>
    </div>
    <div class="score-meta">
      <dl class="kv">
        <div><dt class="label">Policy</dt><dd class="small">{r.policyVersion}</dd></div>
        <div><dt class="label">Generated</dt><dd class="small num">{fmtDate(r.generatedAt)}</dd></div>
        <div><dt class="label">Failed</dt><dd class="num">{r.failed}</dd></div>
      </dl>
    </div>
  </section>

  <div class="scenarios">
    {#each r.results as s}
      <article class="scenario rise" class:failed={s.status !== 'passed'}>
        <div class="scenario-head">
          <span class="sid num">{s.id}</span>
          <span class="pill" class:solid={s.status === 'passed'}>{s.status}</span>
        </div>
        <h2 class="scenario-title">{s.title}</h2>
        <p class="risk dim">{s.risk}</p>
        <dl class="verdict">
          <div>
            <dt class="label">Expected</dt>
            <dd>{s.expectedDecision}</dd>
          </div>
          <div>
            <dt class="label">Actual</dt>
            <dd>{s.actualDecision}</dd>
          </div>
          <div>
            <dt class="label">Outcome</dt>
            <dd>{s.expectedSecurityOutcome}</dd>
          </div>
        </dl>
        {#if s.assertions?.length}
          <ul class="assertions">
            {#each s.assertions as a}
              <li>{a}</li>
            {/each}
          </ul>
        {/if}
      </article>
    {/each}
  </div>
{/if}

<style>
  header {
    padding-bottom: 36px;
  }

  .page-title {
    margin-top: 10px;
  }

  .scoreline {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 56px;
    align-items: end;
    border-top: var(--hairline);
    border-bottom: var(--hairline);
    padding: 28px 0 24px;
    margin-bottom: 44px;
  }

  .score {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .of {
    font-size: 0.4em;
    color: var(--grey-3);
  }

  .score-meta {
    max-width: 420px;
    width: 100%;
  }

  .kv > div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--grey-2);
  }

  .small {
    font-size: 11px;
  }

  .scenarios {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    border-top: var(--hairline);
    border-left: var(--hairline);
  }

  .scenario {
    border-right: var(--hairline);
    border-bottom: var(--hairline);
    padding: 22px 24px 26px;
    display: flex;
    flex-direction: column;
  }

  .scenario.failed {
    background: var(--ink);
    color: var(--paper);
  }

  .scenario-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .sid {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .scenario-title {
    font-family: var(--serif);
    font-size: 22px;
    font-weight: 400;
    line-height: 1.15;
    margin-top: 12px;
  }

  .risk {
    margin-top: 6px;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .verdict {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 16px;
    border-top: 1px solid var(--grey-2);
    padding-top: 12px;
  }

  .verdict dd {
    font-size: 12px;
    font-weight: 600;
    margin-top: 3px;
  }

  .assertions {
    margin-top: 14px;
    padding-left: 16px;
    font-size: 11px;
    line-height: 1.7;
    color: var(--grey-4);
  }

  .scenario.failed .assertions {
    color: var(--grey-2);
  }
</style>
