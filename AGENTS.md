# Repository Guidelines

## Scope and intent

These instructions apply to the entire repository.

This project is a Mushroom-styled Home Assistant frontend for MeshCore. Preserve the upstream card's strong discovery and data handling, and concentrate changes on presentation, usability, and safe coexistence with the original `meshcore-card`.

## Architecture

- `src/index.ts` registers the three cards and their card-picker metadata.
- `src/discovery.ts` contains registry-based MeshCore hub, node, contact, channel, and entity discovery. Treat this as stable backend logic; do not rewrite it for presentation work.
- `src/card.ts` owns the single-target hub/node card, configuration, throttled rendering, and more-info interactions.
- `src/styles.ts` contains shared card styling and Mushroom/HA theme-token mappings.
- `src/editor.ts` provides the target-first visual editor for the main card.
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

## Main-card configuration contract

- Each `custom:mushroom-meshcore-card` instance renders exactly one required `target`: `{ type: "hub", id: <pubkey> }` or `{ type: "node", id: <discovered name> }`.
- A missing or unresolved target must render a localised configuration/migration prompt. Never silently choose the first discovered device or restore the legacy grouped overview.
- Keep per-device entity overrides flat on the card config. The grouped `hubs`, `nodes`, and `nodes_order` fields are legacy and intentionally ignored.
- Preserve target selection, flat entity overrides, map settings, neighbours, and grid options through the visual editor and YAML.
- Preserve registry/device-scoped entity matching, localisation, visual editors, more-info actions, fixed-grid clipping, and the 10-second render throttle.
- Do not require users to manually configure every telemetry entity.
- Do not add Mushroom or Card Mod as a runtime dependency. Card Mod customisation may be supported through stable CSS variables, classes, or parts, but core styling must work independently.
- Keep contact and channel cards functional when changing shared code.

## Presentation rules

- Follow Mushroom's design language using published `--mush-*` variables with sensible Home Assistant fallbacks.
- Avoid theme-specific hard-coded colours. Use HA text, surface, border, and semantic status variables.
- Use restrained status colour, compact typography, rounded surfaces, circular icon shapes, and responsive metric layouts.
- Use Home Assistant's native Tile icon and information primitives for the single-device header, with a safe local fallback while those custom elements upgrade.
- The outer `ha-card` is the only device surface; do not reintroduce grouped section headings or nested per-device card borders.
- Offline nodes should collapse to a short status summary rather than show unavailable metrics.
- Treat `unknown`, `unavailable`, empty, and invalid numeric metric states as absent.
- Keep raw RSSI and SNR visible. Do not invent RF quality labels or undocumented thresholds.
- Use semantic buttons/disclosures, keyboard focus styles, ARIA labels where appropriate, and reduced-motion-safe transitions.

## Mushroom design contract (non-negotiable)

This project implements Mushroom styling; it is not a loose visual interpretation. For every presentation change:

1. Inspect the current [Mushroom source](https://github.com/piitaya/lovelace-mushroom), especially its [theme variables](https://github.com/piitaya/lovelace-mushroom/blob/main/src/utils/theme.ts) and the corresponding shared card, state-item, state-info, shape-icon, chip, badge, or control implementation.
2. Treat current upstream Mushroom source as the authority for geometry, typography, spacing, colour treatment, and interaction. Mirror its published `--mush-*` variables and exact fallbacks instead of inventing local values.
3. Preserve MeshCore's composite information hierarchy, but build each visible primitive from the closest Mushroom primitive. If a direct mapping is impossible, keep the deviation minimal and explicitly justify it before implementation.
4. Use the [community Card Mod guide](https://community.home-assistant.io/t/mushroom-cards-card-mod-styling-config-guide/600472) only as a customization reference. Its examples and shadow-DOM selectors are version-sensitive and are not a design authority.

The current Mushroom baseline is 10px layout spacing; 36px circular icon shapes with a `0.667em` symbol; 36px chips with a 19px radius and 8px spacing; 14px/500/20px/0.1px primary text; 12px/400/16px/0.4px secondary text; 42px controls with a 12px radius; and 16px circular badges. Recheck upstream before presentation work and update mirrored fallbacks when Mushroom changes.

Do not introduce glassmorphism, backdrop blur, gradients, glowing or pulsing status effects, hover lifts, bespoke shadows, arbitrary radii, or undocumented colour systems. State colour should remain a restrained semantic accent. Mushroom and Card Mod must remain optional, and light/dark themes must work through Mushroom and Home Assistant variables alone.

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
npm run test:render
git diff --check
```

The build must emit `dist/mushroom-meshcore-card.js`. Do not hand-edit generated bundle output.

Before handing off a change:

1. Check for TypeScript, translation, and build errors.
2. Audit registrations, editor tags, card-picker entries, metadata, workflows, and README examples for naming collisions.
3. Review the diff for accidental changes to discovery, target/override handling, throttling, sanitisation, map handling, neighbours, or contact/channel behaviour.
4. Test both missing/unavailable metrics and representative online/offline node states when rendering changes are involved.

## Working-tree discipline

The repository may contain user changes. Inspect the worktree before editing, keep patches focused, and do not discard or reformat unrelated work. Avoid new dependencies unless the feature clearly requires one.
