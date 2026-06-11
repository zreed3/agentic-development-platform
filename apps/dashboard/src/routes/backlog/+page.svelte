<script>
  let { data } = $props();

  const epics = [...new Set(data.features.map((f) => f.epic))];

  const fmtDate = (iso) =>
    iso
      ? new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
      : '';
</script>

<svelte:head><title>ADG — Backlog</title></svelte:head>

<header class="rise">
  <p class="label">01 / SQL-first backlog</p>
  <h1 class="page-title">Backlog <em>ledger</em></h1>
</header>

{#if data.violations.length > 0}
  <div class="violation rise">
    <span class="pill solid">release gate</span>
    {data.violations.length} item(s) signed off without live evidence — see <code>release_gate_violations</code>.
  </div>
{/if}

{#each epics as epic, i}
  <section class="epic rise">
    <div class="epic-head">
      <h2 class="epic-title">{epic}</h2>
      <span class="label">{data.features.filter((f) => f.epic === epic).length} features</span>
    </div>
    <table class="ledger">
      <thead>
        <tr>
          <th>ID</th>
          <th>Feature</th>
          <th>Key</th>
          <th>Band</th>
          <th class="r">Tasks</th>
          <th class="r">Tests</th>
          <th>Status</th>
          <th>Latest update</th>
        </tr>
      </thead>
      <tbody>
        {#each data.features.filter((f) => f.epic === epic) as f}
          <tr>
            <td class="num">{f.id}</td>
            <td class="title-cell">{f.title}</td>
            <td class="dim">{f.feature_key}</td>
            <td>{f.release_band}</td>
            <td class="num r">{f.task_count}</td>
            <td class="num r">{f.test_count}</td>
            <td>
              <span class="pill" class:solid={f.current_status === 'verified' || f.current_status === 'implemented'}>
                {f.current_status ?? f.status}
              </span>
            </td>
            <td class="update-cell">
              {#if f.latest_update}
                <span class="dim">{fmtDate(f.latest_update_at)}</span> {f.latest_update}
              {:else}
                <span class="dim">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/each}

{#if data.features.length === 0}
  <p class="dim rise">No backlog loaded. Run <code>npm run setup:demo</code> at the repo root.</p>
{/if}

<style>
  header {
    padding-bottom: 36px;
  }

  .page-title {
    margin-top: 10px;
  }

  .violation {
    border: var(--hairline);
    padding: 14px 18px;
    margin-bottom: 32px;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .epic {
    margin-bottom: 48px;
  }

  .epic-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .epic-title {
    font-family: var(--serif);
    font-size: 26px;
    font-weight: 400;
    font-style: italic;
  }

  .title-cell {
    font-weight: 500;
    min-width: 180px;
  }

  .update-cell {
    max-width: 360px;
    font-size: 11.5px;
  }

  th.r,
  td.r {
    text-align: right;
  }
</style>
