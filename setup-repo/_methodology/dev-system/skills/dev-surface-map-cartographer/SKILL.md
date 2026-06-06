---
name: dev-surface-map-cartographer
description: Map bord.room V4.1 surfaces. Use when routes, entities, navigation, command search, page titles, hidden/future modules, live states, mobile/desktop states, or entity lifecycle surfaces must be made truthful and queryable.
---

# bord.room Surface Map Cartographer

Use this to make visible and hidden surfaces explicit.

## Map

For each surface, capture:

- feature ID and route registry entry;
- entity or workflow;
- list, detail, create, edit, import, export, destructive, and recovery actions;
- persona state for anonymous, owner, admin, manager, staff, viewer, support, ops, and super_admin where relevant;
- live, hidden, future, partial, admin-only, or deprecated status;
- empty, error, forbidden, locked, and read-only states;
- test or route-matrix evidence.

## Rules

- Registry status and navigation must match.
- Do not expose unfinished modules as live.
- Direct URL behavior must be as truthful as navigation behavior.
