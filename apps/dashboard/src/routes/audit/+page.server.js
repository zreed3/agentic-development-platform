import { auditEvents } from '$lib/server/data.js';

export function load() {
  return { events: auditEvents() };
}
