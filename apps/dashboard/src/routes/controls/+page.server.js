import { controlState, controlToggleHistory } from '$lib/server/data.js';

// Read-only load. The dashboard renders control state and the governed toggle history;
// it never exposes a mutation. Toggling a control is the governed CLI's job
// (npm run guardrails:toggle), which writes an append-only audit decision.
export function load() {
  const state = controlState();
  return {
    version: state.version,
    mandatoryAlwaysOn: state.mandatoryAlwaysOn,
    controls: state.controls,
    history: controlToggleHistory()
  };
}
