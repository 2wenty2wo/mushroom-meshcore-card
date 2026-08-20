# Repository Guidelines

## Scope and intent

These instructions apply to the entire repository.

This project is a Mushroom-styled Home Assistant frontend for MeshCore. Preserve the upstream card's strong discovery and data handling, and concentrate changes on presentation, usability, and safe coexistence with the original `meshcore-card`.

## Architecture

- `src/index.ts` registers the three cards and their card-picker metadata.
- `src/discovery.ts` contains registry-based MeshCore hub, node, contact, channel, and entity discovery. Treat this as stable backend logic; do not rewrite it for presentation work.
- `src/card.ts` owns the main hub/node card, configuration, throttled rendering, and more-info interactions.
- `src/styles.ts` contains shared card styling and Mushroom/HA theme-token mappings.
- `src/editor.ts` provides the visual editor used by the cards.
- `src/contact-card.ts` and `src/channel-card.ts` provide the related cards.
- `src/helpers.ts`, `src/types.ts`, `src/localize.ts`, and `src/translations/` provide shared helpers, types, and localisation.

Keep data/entity resolution separate from rendering. Prefer small presentation helpers over duplicating discovery or configuration logic.

## Public naming and coexistence

The fork must be installable alongside upstream. Register only these public card elements:

- `mushroom-meshcore-card`
- `mushroom-meshcore-contact-card`
- `mushroom-meshcore-channel-card`
- Their matching `*-editor` elements

Use `mushroom-meshcore-card` consistently for package, HACS, resource, bundle, workflow, and documentation naming. The distributable filename is `mushroom-meshcore-card.js`.

Do not register legacy `meshcore-*` aliases: they collide with upstream. Legacy names may appear only in explicit upstream attribution or migration documentation. Bundle-local TypeScript class and config names do not need mechanical renaming.

## Compatibility requirements

- Minimal configuration must remain `type: custom:mushroom-meshcore-card` with automatic discovery.
- Preserve the existing YAML schema and configuration precedence, including hubs, nodes, entity overrides, ordering, map settings, neighbours, and grid options.
- Preserve registry/device-scoped entity matching, localisation, visual editors, more-info actions, fixed-grid clipping, and the 10-second render throttle.
- Do not require users to manually configure every telemetry entity.
- Do not add Mushroom or Card Mod as a runtime dependency. Card Mod customisation may be supported through stable CSS variables, classes, or parts, but core styling must work independently.
- Keep contact and channel cards functional when changing shared code.

## Presentation rules

- Follow Mushroom's design language using published `--mush-*` variables with sensible Home Assistant fallbacks.
- Avoid theme-specific hard-coded colours. Use HA text, surface, border, and semantic status variables.
- Use restrained status colour, compact typography, rounded surfaces, circular icon shapes, and responsive metric layouts.
- Offline nodes should collapse to a short status summary rather than show unavailable metrics.
- Treat `unknown`, `unavailable`, empty, and invalid numeric metric states as absent.
- Keep raw RSSI and SNR visible. Do not invent RF quality labels or undocumented thresholds.
- Use semantic buttons/disclosures, keyboard focus styles, ARIA labels where appropriate, and reduced-motion-safe transitions.

## Security and rendering

Rendering uses `innerHTML` in places. Escape all Home Assistant, MeshCore, configuration, and translated values before interpolating them into markup. Continue to use `escapeHtml` and validate URLs, icons, or image sources as appropriate. Never introduce unsanitised registry, entity-state, attribute, or user-config values into HTML.

Preserve disclosure state and other user interaction state across throttled rerenders using stable identifiers.

## Localisation

User-visible strings belong in the localisation system rather than inline rendering code. Add every new key to all existing locale files:

- `src/translations/en.json`
- `src/translations/de.json`
- `src/translations/fr.json`
- `src/translations/nl.json`
- `src/translations/pl.json`

Use the existing localisation helpers and run the translation check after changes.

## Development and verification

Install and verify with:

```sh
npm ci
npm run typecheck
npm run check-translations
npm run build
git diff --check
```

The build must emit `dist/mushroom-meshcore-card.js`. Do not hand-edit generated bundle output.

Before handing off a change:

1. Check for TypeScript, translation, and build errors.
2. Audit registrations, editor tags, card-picker entries, metadata, workflows, and README examples for naming collisions.
3. Review the diff for accidental changes to discovery, configuration precedence, throttling, sanitisation, map handling, neighbours, or contact/channel behaviour.
4. Test both missing/unavailable metrics and representative online/offline node states when rendering changes are involved.

## Working-tree discipline

The repository may contain user changes. Inspect the worktree before editing, keep patches focused, and do not discard or reformat unrelated work. Avoid new dependencies unless the feature clearly requires one.
