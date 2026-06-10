---
name: dev-interaction-grammar-governor
description: Govern bord.room V4.1 interaction grammar. Use when adding or reviewing controls, forms, modals, drawers, validation, dirty guards, destructive actions, toasts, keyboard behavior, focus handling, loading, retry, or mobile interaction states.
---

# bord.room Interaction Grammar Governor

Use this before changing user interaction patterns.

## Decide

- Which primitive owns the interaction.
- Submit, cancel, close, retry, reset, and destructive behavior.
- Dirty/unsaved behavior.
- Validation timing and field error copy.
- Loading, pending, disabled, read-only, and optimistic states.
- Keyboard, focus return, aria label, and escape behavior.
- Mobile layout and touch target behavior.

## Rules

- Prefer existing primitives before new patterns.
- Destructive actions need explicit confirmation and recovery copy.
- Disabled controls must not hide why an action is unavailable.
- Form validation must be server-authoritative and role safe.
