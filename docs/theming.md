# Theming and Card Mod

Mushroom and Card Mod are optional. The cards use Home Assistant's native Tile header primitives, mirror Mushroom's published geometry and typography variables when present, and fall back to standard Home Assistant theme variables.

The [Main card](/cards/main), [Channel card](/cards/channel), [Mentions card](/cards/mentions), [Releases card](/cards/releases), and [Status card and badge](/cards/status) therefore work in light and dark themes without either dependency.

## Theme inheritance

The cards consume these Mushroom variables first:

| Area | Mushroom variables | Built-in fallback |
| --- | --- | --- |
| Layout | `--mush-spacing` | 10px |
| Primary text | `--mush-card-primary-font-size`, `-font-weight`, `-line-height`, `-letter-spacing` | 14px / 500 / 20px / 0.1px |
| Secondary text | `--mush-card-secondary-font-size`, `-font-weight`, `-line-height`, `-letter-spacing` | 12px / 400 / 16px / 0.4px |
| Chips | `--mush-chip-height`, `-border-radius`, `-spacing`, `-background`, `-border-width`, `-border-color` | 36px / 19px / 8px plus HA surface and border colors |
| Icons | `--mush-icon-size`, `-symbol-size`, `-border-radius` | 36px / 0.667em / 50% |
| Controls | `--mush-control-height`, `-border-radius` | 42px / 12px |
| Badges | `--mush-badge-size`, `-border-radius` | 16px / 50% |
| Semantic colors | `--mush-rgb-success`, `--mush-rgb-warning`, `--mush-rgb-danger`, `--mush-rgb-info` | matching Home Assistant semantic colors |

Home Assistant provides the remaining surface and text fallbacks, including `--ha-card-background`, `--card-background-color`, `--ha-card-border-color`, `--divider-color`, `--primary-text-color`, `--secondary-text-color`, and the semantic `--success-color`, `--warning-color`, `--error-color`, and `--info-color` values.

The easiest theme-wide customization is to set the upstream Mushroom or Home Assistant variables. This keeps Mushroom MeshCore Card visually aligned with the rest of the dashboard.

## Scoped variables

Internally, the shared styles expose scoped values for targeted customization:

| Variable | Purpose |
| --- | --- |
| `--mushroom-meshcore-card-padding` | Outer card inset; defaults to `--mush-spacing`. |
| `--mushroom-meshcore-card-background` | Card and sticky-header background. |
| `--mushroom-meshcore-surface` | Metric tiles, neighbour rows, and secondary controls. |
| `--mushroom-meshcore-border-color` | Details separators and secondary borders. |
| `--mushroom-meshcore-success-color` | Online and success accent. |
| `--mushroom-meshcore-warning-color` | Warning and mid-battery accent. |
| `--mushroom-meshcore-danger-color` | Error and low-battery accent. |
| `--mushroom-meshcore-info-color` | Informational links and accents. |
| `--mushroom-meshcore-muted-color` | Offline, unavailable, and secondary state color. |
| `--mushroom-meshcore-sparkline-color` | Signal-history line color; defaults to the muted secondary text color. |
| `--mushroom-meshcore-sparkline-opacity` | Signal-history line opacity; defaults to `0.14`. |
| `--mushroom-meshcore-primary-*` | Primary font size, weight, line height, and letter spacing. |
| `--mushroom-meshcore-secondary-*` | Secondary font size, weight, line height, and letter spacing. |
| `--mushroom-meshcore-chip-*` | Chip height, radius, spacing, background, border width, and border color. |
| `--mushroom-meshcore-icon-*` | Icon shape size, symbol size, and radius. |
| `--mushroom-meshcore-control-*` | Control height and radius. |
| `--mushroom-meshcore-badge-*` | Badge size and radius. |

For theme files, prefer the inherited `--mush-*` and Home Assistant variables above. Scoped variables are most useful when a Card Mod rule targets one card or a small dashboard area.

The Status badge uses Home Assistant's native badge surface rather than an
`ha-card`. Theme-wide Mushroom and Home Assistant semantic variables still
apply, but Card Mod rules written specifically for `ha-card` do not target the
badge. Status color remains semantic even when `icon_color` is configured:
custom color applies only while the result is healthy.

## Card Mod example

Card Mod is not a runtime dependency. If it is installed, set variables rather than relying on internal shadow-DOM class names:

```yaml
type: custom:mushroom-meshcore-card
target:
  type: node
  id: Spring Farm
card_mod:
  style: |
    ha-card {
      --mushroom-meshcore-card-padding: 12px;
      --mushroom-meshcore-surface: var(--secondary-background-color);
      --mushroom-meshcore-info-color: var(--primary-color);
      --mushroom-meshcore-sparkline-opacity: 0.2;
    }
```

The community [Mushroom Card Mod styling guide](https://community.home-assistant.io/t/mushroom-cards-card-mod-styling-config-guide/600472) is a useful customization reference. Its shadow-DOM selectors are version-sensitive, so CSS variables are the more stable interface.

## Per-card icon color

Use the normal card configuration when only the active Tile icon needs a different accent:

```yaml
icon_color: deep-purple
```

Accepted values include Home Assistant/Mushroom color names, `primary`, `accent`, strict hex values, CSS named colors, and `rgb()`/`rgba()`/`hsl()`/`hsla()` forms. The override is ignored while the target is offline or unavailable so state remains apparent. See [Icon colors](/configuration#icon-colors) for details.

## Design constraints

Keep semantic state color restrained and preserve legibility in both light and dark themes. The project deliberately avoids gradients, glass effects, backdrop blur, glow, pulsing status, hover lift, and bespoke shadows. Do not depend on Mushroom or Card Mod for core layout or status meaning.

If a customization does not apply, check [Troubleshooting](/troubleshooting#theme-or-card-mod-changes-do-not-apply).
