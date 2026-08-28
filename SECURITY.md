# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/2wenty2wo/mushroom-meshcore-card/security/advisories/new)
rather than opening a public issue, so a fix can ship before the details are
public.

Please include the card and version, a node/channel/mention payload or dashboard
config that reproduces the problem, and what you observed. A failing test against
`test/xss.test.ts` is the fastest possible report, but is not required.

This is a hobby project maintained by one person, so response times are
best-effort. Expect an acknowledgement within about a week.

## Supported versions

Fixes land on the latest release. Older releases are not patched — if you are
behind, update via HACS rather than waiting for a backport.

## Threat model

**Everything these cards display is attacker-controlled input.** MeshCore is an
open radio mesh: anyone within LoRa range can advertise a node under any
`adv_name` and send any channel or direct message, and the mesh will relay it
onward. The firmware does not validate those strings, and neither the
`meshcore_py` SDK nor the `meshcore-ha` integration escape them, so hostile text
reaches Home Assistant verbatim through ordinary entity states and attributes.

Impact is what makes this worth taking seriously. Lovelace cards render inside
the Home Assistant frontend origin, against the viewer's authenticated session.
Script execution there is not a defaced card — it is full control of the
viewer's Home Assistant, including anything that session can reach.

These cards build markup as template strings assigned to `innerHTML`, so
escaping is the only barrier: `escapeHtml` in `src/helpers.ts` must wrap every
externally sourced value at every interpolation. Two sinks need more than HTML
escaping and have their own validators — `computeCssColor` for values reaching
an inline `style` attribute, where a `;` would otherwise break out into an
arbitrary CSS declaration, and `mapLinkUrl` for the external map `href`.

`test/xss.test.ts` pins these guarantees, driving break-out payloads through
every attacker-controlled field and asserting at the DOM level that nothing is
constructed from them. Changes touching rendering should extend it.

### In scope

- Injection through any mesh-sourced value: node and neighbour `adv_name`,
  hardware and firmware strings, MQTT labels, channel messages, mention text.
- Injection through Home Assistant entity states, attributes, or friendly names.
- Anything that escalates a rendered card into action against the viewer's
  Home Assistant session.

### Out of scope

- Vulnerabilities in Home Assistant, HACS, the MeshCore firmware, or the
  [`meshcore-ha`](https://github.com/meshcore-dev/meshcore-ha) integration.
  Please report those to their own maintainers.
- Dashboard YAML written by the person who owns the dashboard. Card config is
  trusted input: someone who can edit your Lovelace config already controls what
  your dashboard renders. Only cross this line if mesh data can reach a config
  field on its own.
- Anything requiring physical access to the Home Assistant host.
