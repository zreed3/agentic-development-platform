// ADG loop-context builders — pure string assembly for the context-discipline hooks.
//
// P4 (context as a finite attention budget) and P5 (durable state lives on the filesystem,
// not only in the window). These build the small, high-signal headers the hooks inject:
//   - UserPromptSubmit -> steering header (what item am I on, what scope, what gates).
//   - PreCompact       -> pin the durable state that MUST survive a context reset.
//   - SessionStart     -> rehydrate from disk (the Ralph restart pattern).
// Each returns "" when there is nothing to say, so the hook injects nothing.

function itemLabel(item) {
  if (!item) return "";
  return item.title ? `${item.id} — ${item.title}` : String(item.id || "");
}

/** UserPromptSubmit: a one-line steering header keeping the agent on its slice. */
export function buildSteeringHeader({ activeItem, lane } = {}) {
  if (!activeItem) return "";
  const parts = [`ADG · active item: ${itemLabel(activeItem)}`];
  if (activeItem.status) parts.push(`status: ${activeItem.status}`);
  if (lane) parts.push(`lane: ${lane}`);
  if (activeItem.writeScope) parts.push(`write scope: ${activeItem.writeScope}`);
  parts.push(
    "Stay within the item's scope; record evidence before signoff (release-class items require a 'live' event).",
  );
  return parts.join(" · ");
}

/** PreCompact: the durable state to carry across a compaction. */
export function buildPinContext({ auditHead, activeItem, criterion } = {}) {
  const lines = [];
  if (activeItem) lines.push(`active item: ${itemLabel(activeItem)}${activeItem.status ? ` (status ${activeItem.status})` : ""}`);
  if (criterion) lines.push(`acceptance criterion: ${criterion}`);
  if (auditHead) lines.push(`audit-chain tip hash: ${auditHead}`);
  if (!lines.length) return "";
  return `ADG durable state to preserve across compaction —\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/** SessionStart: resume from filesystem/git state (the fresh-context restart pattern). */
export function buildRehydrateContext({ activeItem, lastAudit, fixPlan } = {}) {
  const lines = [];
  if (activeItem) lines.push(`resume: ${itemLabel(activeItem)}${activeItem.status ? ` (status ${activeItem.status})` : ""}`);
  if (lastAudit) lines.push(`last audit event: ${lastAudit}`);
  if (fixPlan) lines.push(`fix plan present: ${fixPlan}`);
  if (!lines.length) return "";
  return `ADG session rehydrate (state recovered from disk) —\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
