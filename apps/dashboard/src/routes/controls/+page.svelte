<script>
  let { data } = $props();

  // Read-only view. No forms, no actions, no mutation surface: toggling a control is the
  // governed CLI's job (npm run guardrails:toggle), which writes an append-only audit
  // decision with reason, risk, and rollback.
  const alwaysOn = data.controls.filter((c) => c.alwaysOn);
  const toggleable = data.controls.filter((c) => !c.alwaysOn);
</script>

<svelte:head><title>ADG Controls</title></svelte:head>

<header class="rise">
  <p class="label">05 / {data.version}</p>
  <h1 class="page-title">Toggleable <em>controls</em></h1>
  <p class="default-line">
    Always-on controls
    <span class="pill solid">cannot be disabled</span>
    by any toggle. Every other control is a governed, audited action.
  </p>
</header>

<section class="group rise">
  <h2 class="group-name">Always-on <span class="dim">(pinned in code, not toggleable)</span></h2>
  <ul class="controls">
    {#each alwaysOn as c}
      <li class="control on">
        <span class="ctrl-name">{c.name}</span>
        <span class="pill solid">{c.effect}</span>
        <span class="pill">always-on</span>
        <span class="ctrl-desc dim">{c.description}</span>
      </li>
    {/each}
  </ul>
</section>

<section class="group rise">
  <h2 class="group-name">Toggleable <span class="dim">(governed via npm run guardrails:toggle)</span></h2>
  <ul class="controls">
    {#each toggleable as c}
      <li class="control" class:off={!c.enabled}>
        <span class="ctrl-name">{c.name}</span>
        <span class="pill" class:solid={c.enabled}>{c.enabled ? 'enabled' : 'disabled'}</span>
        <span class="pill">{c.effect}</span>
        <span class="ctrl-desc dim">{c.description}</span>
      </li>
    {/each}
  </ul>
</section>

<section class="group rise">
  <h2 class="group-name">Toggle history <span class="dim">(append-only audit decisions)</span></h2>
  {#if data.history.length}
    <ul class="history">
      {#each data.history as h}
        <li class="event">
          <span class="when dim">{h.occurredAt}</span>
          <span class="what">{h.summary}</span>
          <span class="why dim">{h.details}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="dim none">No control toggles recorded. All controls are at their deny-by-default state.</p>
  {/if}
</section>

<style>
  header { padding-bottom: 36px; }
  .page-title { margin-top: 10px; }
  .default-line { margin-top: 18px; display: flex; align-items: baseline; gap: 10px; font-size: 12px; flex-wrap: wrap; }
  .group { padding: 22px 0 8px; border-top: var(--hairline); }
  .group-name { font-family: var(--serif); font-size: 22px; font-weight: 400; font-style: italic; margin-bottom: 14px; }
  .controls, .history { list-style: none; border-top: var(--hairline); }
  .control { display: grid; grid-template-columns: minmax(150px, auto) 70px 80px 1fr; gap: 12px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--grey-2); font-size: 11.5px; }
  .control.off { opacity: 0.6; }
  .ctrl-name { font-weight: 600; }
  .ctrl-desc { font-size: 10.5px; line-height: 1.5; }
  .event { display: grid; grid-template-columns: 200px 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--grey-2); font-size: 11px; }
  .event .why { grid-column: 2; font-size: 10px; }
  .none { margin-top: 12px; font-size: 11px; }
  @media (max-width: 1100px) {
    .control { grid-template-columns: 1fr; gap: 4px; }
    .event { grid-template-columns: 1fr; }
  }
</style>
