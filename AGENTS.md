# Repository Guidelines

## Scope and intent

These instructions apply to the entire repository.

This project is a Mushroom-styled Home Assistant frontend for MeshCore. Preserve the upstream card's strong discovery and data handling, and concentrate changes on presentation, usability, and safe coexistence with the original `meshcore-card`.

## Repository and pull-request target (non-negotiable)

- **NEVER** create, open, submit, or retarget a pull request to [`jpettitt/meshcore-card`](https://github.com/jpettitt/meshcore-card).
- Create pull requests **only** against [`2wenty2wo/mushroom-meshcore-card`](https://github.com/2wenty2wo/mushroom-meshcore-card).
- Treat `jpettitt/meshcore-card` and any remote named `upstream` as read-only references. Never push branches or commits to them.
- Before creating or updating a pull request, verify that the destination repository is exactly `2wenty2wo/mushroom-meshcore-card`.

## Architecture

- `src/index.ts` registers the five cards, the status badge, and their picker metadata.
- `src/discovery.ts` contains registry-based MeshCore hub, node, contact, channel, and entity discovery. Treat this as stable backend logic; do not rewrite it for presentation work.
- `src/card.ts` owns the single-target hub/node card, configuration, throttled rendering, and more-info interactions.
- `src/styles.ts` contains shared card styling and Mushroom/HA theme-token mappings.
- `src/editor.ts` provides the target-first visual editor for the main card.
- `src/channel-card.ts` provides the channel card.
- `src/mentions-card.ts` provides the automation-backed mentions card.
- `src/releases-card.ts` provides the sensor-backed software releases card.
- `src/status-card.ts`, `src/status-badge.ts`, and the shared status model provide the hub-scoped network-health surfaces.
- `src/helpers.ts`, `src/types.ts`, `src/localize.ts`, and `src/translations/` provide shared helpers, types, and localisation.
- `docs/` contains the public VitePress documentation. `docs/releasing.md` is maintainer-only and excluded from the generated site.

Keep data/entity resolution separate from rendering. Prefer small presentation helpers over duplicating discovery or configuration logic.

## Public naming and coexistence

The fork must be installable alongside upstream. Register only these public card and badge elements:

- `mushroom-meshcore-card`
- `mushroom-meshcore-channel-card`
- `mushroom-meshcore-mentions-card`
- `mushroom-meshcore-releases-card`
- `mushroom-meshcore-status-card`
- `mushroom-meshcore-status-badge`
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
- Keep the channel card functional when changing shared code.

## Reusable Mushroom conversion contract

Treat the main device card as the reference implementation when converting or refactoring another card, including future single-target cards. Reuse this configuration and editor structure rather than delivering presentation-only Mushroom styling.

- A card that represents one device, channel, or similar item must require an explicit target, render exactly that target, and show a localised prompt when the target is missing or unresolved. Never silently select the first discovered item.
- Give the selected item a native Tile-style header with optional `name`, `icon`, and `icon_color` overrides. Discovered identity remains the fallback, and offline or unavailable styling must retain its semantic muted treatment.
- Support `tap_action`, `hold_action`, and `double_tap_action` on the primary header using standard Home Assistant action configuration. Default more-info must resolve to the selected item's primary entity; metric, chip, and other entity-specific controls continue to open their own entities.
- Provide flat, semantically named `hide_*` booleans for independently useful content regions and `*_default_open` booleans for disclosures. Content is visible and disclosures are collapsed by default. Expose only controls that make sense for that card; do not copy unrelated fields merely for uniformity.
- Use the main card's `hide_battery`, node-only `hide_metrics`, `hide_quick_stats`, `hide_details`, and `details_default_open` fields as the concrete visibility/disclosure reference. New cards should define equally specific controls for their own visible elements.
- Keep entity overrides optional and flat. Registry/device-scoped automatic discovery remains the default, so a user must not need to configure every supporting entity manually.
- Keep YAML, visual-editor data, rendering, and config-change events in parity. Preserve Tile-compatible appearance, actions, visibility/disclosure settings, entity overrides, card-specific behaviour, and `grid_options` without dropping unrelated values during an editor change or target switch.
- Build target-first visual editors with expandable Appearance, Interactions, Entity overrides, and card-specific Behavior or Map sections. Use native Home Assistant selectors, show only fields applicable to the selected target, localise every label, and preserve focus and expanded panels when Home Assistant echoes `config-changed` back through `setConfig`.
- Recheck the current [Home Assistant Tile editor source](https://github.com/home-assistant/frontend/blob/dev/src/panels/lovelace/editor/config-elements/hui-tile-card-editor.ts) for configuration grouping and interaction conventions. Use it as a structural reference rather than mechanically adding Tile fields that do not fit the MeshCore card.

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

## Pull requests, labels, and releases

Before preparing, opening, or updating a pull request or GitHub release, read and follow [`docs/releasing.md`](docs/releasing.md).

- Every pull request must use the single best matching release label: `breaking-change`, `enhancement`, `bug`, `documentation`, `translation`, `maintenance`, or `dependencies`. Use `skip-changelog` instead for internal-only changes that should not appear in HACS update notes.
- An agent that creates or updates a pull request must apply the label when its tools allow it. If it cannot apply labels, it must identify the required label in its handoff.
- Pull-request titles and summaries should describe the user-visible outcome. Include the verification performed and call out migration or compatibility requirements.
- Do not bump versions, create or push tags, create releases, or publish drafts unless the user explicitly requests a release operation.
- When a release is requested, use the curated-draft or direct-tag flow in `docs/releasing.md`. Preserve existing release titles and bodies, use full SemVer matching `package.json` and `package-lock.json`, and publish only to `2wenty2wo/mushroom-meshcore-card`.

## Documentation

- Keep the root `README.md` as a deliberately minimal HACS-facing landing and installation page. Detailed setup, card configuration, examples, compatibility notes, and troubleshooting belong in the VitePress site under `docs/`.
- Preserve `docs/mentions-blueprint.md` at its stable source path. Keep `docs/releasing.md` excluded from VitePress routes, navigation, and search.
- Use absolute `https://2wenty2wo.github.io/mushroom-meshcore-card/` links from README and HACS-facing content. Use site-relative links within VitePress source.
- Do not commit `docs/.vitepress/cache/` or `docs/.vitepress/dist/`. Build the site with `npm run docs:build` and visually verify material layout changes with `npm run docs:preview`.

## Development and verification

Install and verify with:

```sh
npm ci
npm run typecheck
npm run check-translations
npm test
npm run build
npm run docs:build
npm run test:render
git diff --check
```

The build must emit `dist/mushroom-meshcore-card.js`. Do not hand-edit generated bundle output.

Before handing off a change:

1. Check for TypeScript, translation, and build errors.
2. Audit registrations, editor tags, card-picker entries, metadata, workflows, and README examples for naming collisions.
3. Review the diff for accidental changes to discovery, target/override handling, throttling, sanitisation, map handling, neighbours, or channel behaviour.
4. Test both missing/unavailable metrics and representative online/offline node states when rendering changes are involved.

## Working-tree discipline

The repository may contain user changes. Inspect the worktree before editing, keep patches focused, and do not discard or reformat unrelated work. Avoid new dependencies unless the feature clearly requires one.
