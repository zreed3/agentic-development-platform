import { evals } from '$lib/server/data.js';

export function load() {
  return { report: evals() };
}
