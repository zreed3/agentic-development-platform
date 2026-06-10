---
name: dev-design-system-keeper
description: Maintain bord.room V4.1 design-system consistency. Use when changing tokens, primitives, page layouts, accessibility, responsive behavior, visual hierarchy, icons, density, tables, cards, forms, or dashboard surfaces.
---

# bord.room Design System Keeper

Use this for UI consistency and visual QA.

## Check

- Existing tokens in `apps/web/src/styles/globals.css`.
- Existing primitives in `packages/ui/src/primitives`.
- Existing domain layouts before adding new composition.
- Responsive constraints for fixed-format UI.
- Accessibility labels, focus rings, contrast, keyboard order, and reduced-motion behavior.

## Rules

- Use the smallest existing primitive that fits.
- Avoid nested cards and marketing-style shells for operational tools.
- Keep text fitted at mobile and desktop widths.
- Use icons for familiar tool actions where available.
- Add screenshots or browser checks for risky visual changes.
