<script>
  let { data } = $props();

  let typeFilter = $state('all');

  const types = ['all', ...new Set(data.events.map((e) => e.eventType))];

  const filtered = $derived(
    typeFilter === 'all' ? data.events : data.events.filter((e) => e.eventType === typeFilter)
  );

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString('en-AU', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
</script>

<svelte:head><title>ADG — Audit Log</title></svelte:head>

<header class="rise">
  <p class="label">02 / append-only</p>
  <h1 class="page-title">Audit <em>log</em></h1>
</header>

<div class="filters rise">
  {#each types as t}
    <button class="filter" class:on={typeFilter === t} onclick={() => (typeFilter = t)}>
      {t}
      <span class="count">{t === 'all' ? data.events.length : data.events.filter((e) => e.eventType === t).length}</span>
    </button>
  {/each}
</div>

<ol class="timeline rise">
  {#each filtered as ev (ev.id)}
    <li class="event">
      <div class="event-rail">
        <span class="tick"></span>
      </div>
      <div class="event-body">
        <div class="event-meta">
          <span class="pill" class:solid={ev.eventType === 'decision'}>{ev.eventType}</span>
          {#if ev.featureId}<span class="feat">{ev.featureId}</span>{/if}
          {#if ev.status}<span class="dim">{ev.status}</span>{/if}
          <span class="dim num when">{fmtDate(ev.occurredAt)}</span>
        </div>
        <p class="event-summary">{ev.summary}</p>
        {#if ev.details}<p class="event-details dim">{ev.details}</p>{/if}
        {#if ev.evidence?.length}
          <p class="evidence">
            {#each ev.evidence as e}<code>{e}</code>{/each}
          </p>
        {/if}
        <p class="event-id dim">{ev.id} &middot; {ev.actor}</p>
      </div>
    </li>
  {/each}
</ol>

<style>
  header {
    padding-bottom: 32px;
  }

  .page-title {
    margin-top: 10px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    border: var(--hairline);
    margin-bottom: 40px;
    width: fit-content;
  }

  .filter {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    background: var(--paper);
    color: var(--ink);
    border: 0;
    border-right: var(--hairline);
    padding: 9px 16px;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .filter:last-child {
    border-right: 0;
  }

  .filter:hover {
    background: var(--grey-1);
  }

  .filter.on {
    background: var(--ink);
    color: var(--paper);
  }

  .count {
    margin-left: 6px;
    opacity: 0.5;
  }

  .timeline {
    list-style: none;
    max-width: 780px;
  }

  .event {
    display: grid;
    grid-template-columns: 24px 1fr;
  }

  .event-rail {
    position: relative;
  }

  .event-rail::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--ink);
  }

  .tick {
    position: absolute;
    left: 0;
    top: 22px;
    width: 9px;
    height: 9px;
    background: var(--paper);
    border: var(--hairline);
  }

  .event:first-child .tick {
    background: var(--ink);
  }

  .event-body {
    padding: 16px 0 22px;
    border-bottom: 1px solid var(--grey-2);
  }

  .event-meta {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
  }

  .feat {
    font-size: 11px;
    font-weight: 600;
  }

  .when {
    margin-left: auto;
    font-size: 11px;
  }

  .event-summary {
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.55;
  }

  .event-details {
    margin-top: 4px;
    font-size: 11.5px;
  }

  .evidence {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .evidence code {
    font-size: 10.5px;
    border: 1px solid var(--grey-2);
    padding: 1px 7px;
  }

  .event-id {
    margin-top: 10px;
    font-size: 10px;
    letter-spacing: 0.08em;
  }
</style>
