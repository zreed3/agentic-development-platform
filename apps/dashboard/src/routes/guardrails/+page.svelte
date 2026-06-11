<script>
  let { data } = $props();

  const classNames = Object.keys(data.riskClasses);
  const toolsFor = (cls) => data.tools.filter((t) => t.riskClass === cls);
</script>

<svelte:head><title>ADG — Guardrails</title></svelte:head>

<header class="rise">
  <p class="label">03 / {data.policyVersion}</p>
  <h1 class="page-title">Guardrail <em>policy</em></h1>
  <p class="default-line">
    Default decision
    <span class="pill solid">{data.defaultDecision}</span>
    — every tool must be explicitly mapped to a risk class.
  </p>
</header>

<div class="classes">
  {#each classNames as cls}
    {@const meta = data.riskClasses[cls]}
    {@const tools = toolsFor(cls)}
    <section class="risk-class rise" class:confirm={meta.requiresConfirmation}>
      <div class="class-head">
        <h2 class="class-name">{cls}</h2>
        <span class="pill" class:solid={meta.requiresConfirmation}>
          {meta.requiresConfirmation ? 'confirmation required' : 'runs freely'}
        </span>
      </div>
      <p class="class-desc">{meta.description}</p>
      {#if tools.length}
        <ul class="tools">
          {#each tools as t}
            <li class="tool">
              <span class="tool-name">{t.name}</span>
              <span class="dim tool-mode">{t.mode}</span>
              <span class="tool-evidence dim">
                {#each t.requiredEvidence ?? [] as e, i}{i > 0 ? ' · ' : ''}{e}{/each}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dim none">No tools mapped.</p>
      {/if}
    </section>
  {/each}
</div>

<style>
  header {
    padding-bottom: 40px;
  }

  .page-title {
    margin-top: 10px;
  }

  .default-line {
    margin-top: 18px;
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 12px;
  }

  .classes {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
    border-top: var(--hairline);
    border-left: var(--hairline);
  }

  .risk-class {
    border-right: var(--hairline);
    border-bottom: var(--hairline);
    padding: 24px 26px 28px;
  }

  .risk-class.confirm {
    background: var(--grey-1);
  }

  .class-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .class-name {
    font-family: var(--serif);
    font-size: 28px;
    font-weight: 400;
    font-style: italic;
  }

  .class-desc {
    margin-top: 10px;
    font-size: 12px;
    line-height: 1.6;
    max-width: 48ch;
  }

  .tools {
    list-style: none;
    margin-top: 18px;
    border-top: var(--hairline);
  }

  .tool {
    display: grid;
    grid-template-columns: minmax(140px, auto) 50px 1fr;
    gap: 14px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid var(--grey-2);
    font-size: 11.5px;
  }

  .tool-name {
    font-weight: 600;
  }

  .tool-mode,
  .tool-evidence {
    font-size: 10.5px;
  }

  .none {
    margin-top: 16px;
    font-size: 11px;
  }

  @media (max-width: 1100px) {
    .classes {
      grid-template-columns: 1fr;
    }
  }
</style>
