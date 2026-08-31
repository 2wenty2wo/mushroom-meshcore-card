# Releases card

The Releases card presents explicitly configured Home Assistant sensors as a
compact catalogue of current MeshCore software releases. Home Assistant polls
the release services; the card only reads entity state and attributes.

![Mushroom MeshCore Releases Card](../../screenshots/releases-card.png)

## Requirements

- Mushroom MeshCore Card installed through HACS or manually
- One or more `sensor.*` entities whose state is the release tag
- A valid `html_url` attribute for rows that should open a release page
- A valid `published_at` attribute for newest-first sorting and relative age

The optional `prerelease` boolean attribute adds a visible Pre-release badge.
The card does not compare installed firmware and never infers that an update is
available.

## Complete card example

```yaml
type: custom:mushroom-meshcore-releases-card
name: Software releases
icon: mdi:download
icon_color: primary
sources:
  - entity: sensor.meshcore_latest_release
    name: MeshCore
  - entity: sensor.mishmesh_latest_release
    name: mishmesh
  - entity: sensor.zephcore_latest_release
    name: ZephCore
  - entity: sensor.inkcore_latest_release
    name: InkCore
  - entity: sensor.otafix_latest_release
    name: OTAFIX
  - entity: sensor.remoteterm_latest_release
    name: RemoteTerm
  - entity: sensor.ota_dfu_flasher_latest_release
    name: ESP32 DFU
sort: newest
hide_age: false
grid_options:
  columns: full
  rows: auto
```

The visual editor adds, removes, renames, and reorders sources. Configured
order is used as the fallback when publication dates match or are missing.
Missing and unavailable entities remain visible as muted rows.

Selecting a healthy row opens its HTTPS `html_url` in a new tab. Missing,
malformed, non-HTTPS, `javascript:`, and `data:` URLs are rendered as plain,
non-interactive rows.

## REST sensor contract

Each release sensor uses this shape:

| Value | Purpose |
| --- | --- |
| Entity state | Release tag, for example `v1.17.1` |
| `html_url` | HTTPS release page opened from the row |
| `published_at` | ISO timestamp used for sorting and relative age |
| `prerelease` | Optional boolean shown as a Pre-release badge |

Entity IDs are user-controlled in Home Assistant. Configure the actual entity
IDs shown by your instance rather than relying on the example names.

## Full MeshCore ecosystem REST example

The following example is intended for `rest: !include rest.yaml`. If REST is
defined directly in `configuration.yaml`, place the list under its `rest:` key
instead.

```yaml
# MeshCore — latest stable GitHub release
- resource: "https://api.github.com/repos/meshcore-dev/MeshCore/releases/latest"
  scan_interval: 3600
  headers:
    Authorization: !secret github_api_auth
    Accept: "application/vnd.github+json"
    X-GitHub-Api-Version: "2022-11-28"
    User-Agent: "Home-Assistant"
  sensor:
    - name: "MeshCore Latest Release"
      unique_id: meshcore_latest_release
      value_template: "{{ value_json.tag_name }}"
      json_attributes: [name, html_url, published_at, prerelease]

# mishmesh — latest stable GitHub release
- resource: "https://api.github.com/repos/burakcan/MeshCore-mishmesh/releases/latest"
  scan_interval: 3600
  headers:
    Authorization: !secret github_api_auth
    Accept: "application/vnd.github+json"
    X-GitHub-Api-Version: "2022-11-28"
    User-Agent: "Home-Assistant"
  sensor:
    - name: "mishmesh Latest Release"
      unique_id: mishmesh_latest_release
      value_template: "{{ value_json.tag_name }}"
      json_attributes: [name, html_url, published_at, prerelease]

# ZephCore — latest stable GitHub release
- resource: "https://api.github.com/repos/liquidraver/ZephCore/releases/latest"
  scan_interval: 3600
  headers:
    Authorization: !secret github_api_auth
    Accept: "application/vnd.github+json"
    X-GitHub-Api-Version: "2022-11-28"
    User-Agent: "Home-Assistant"
  sensor:
    - name: "ZephCore Latest Release"
      unique_id: zephcore_latest_release
      value_template: "{{ value_json.tag_name }}"
      json_attributes: [name, html_url, published_at, prerelease]

# OTAFIX — latest stable GitHub release
- resource: "https://api.github.com/repos/oltaco/Adafruit_nRF52_Bootloader_OTAFIX/releases/latest"
  scan_interval: 3600
  headers:
    Authorization: !secret github_api_auth
    Accept: "application/vnd.github+json"
    X-GitHub-Api-Version: "2022-11-28"
    User-Agent: "Home-Assistant"
  sensor:
    - name: "OTAFIX Latest Release"
      unique_id: otafix_latest_release
      value_template: "{{ value_json.tag_name }}"
      json_attributes: [name, html_url, published_at, prerelease]

# RemoteTerm — latest stable GitHub release
- resource: "https://api.github.com/repos/jkingsman/Remote-Terminal-for-MeshCore/releases/latest"
  scan_interval: 3600
  headers:
    Authorization: !secret github_api_auth
    Accept: "application/vnd.github+json"
    X-GitHub-Api-Version: "2022-11-28"
    User-Agent: "Home-Assistant"
  sensor:
    - name: "RemoteTerm Latest Release"
      unique_id: remoteterm_latest_release
      value_template: "{{ value_json.tag_name }}"
      json_attributes: [name, html_url, published_at, prerelease]

# ESP32 Nordic OTA DFU — newest published release, including pre-releases.
# This public request intentionally omits Authorization so privileged drafts
# cannot appear in the response.
- resource: "https://api.github.com/repos/cra0/esp32-nordic-ota-dfu/releases?per_page=1"
  scan_interval: 3600
  headers:
    Accept: "application/vnd.github+json"
    X-GitHub-Api-Version: "2022-11-28"
    User-Agent: "Home-Assistant"
  sensor:
    - name: "OTA DFU Flasher Latest Release"
      unique_id: ota_dfu_flasher_latest_release
      value_template: >-
        {{ value_json[0].tag_name if value_json | count > 0 else 'unknown' }}
      json_attributes_path: "$.[0]"
      json_attributes: [name, html_url, published_at, prerelease]

# InkCore — latest stable Codeberg release
- resource: "https://codeberg.org/api/v1/repos/todd-herbert/InkCore/releases/latest"
  scan_interval: 3600
  headers:
    User-Agent: "Home-Assistant"
  sensor:
    - name: "InkCore Latest Release"
      unique_id: inkcore_latest_release
      value_template: "{{ value_json.tag_name }}"
      json_attributes: [name, html_url, published_at, prerelease]
```

Store the complete authorization header in `secrets.yaml`:

```yaml
github_api_auth: "Bearer github_pat_REPLACE_ME"
```

Use a least-privilege token. These repositories are public, so the
`Authorization` lines can be removed if the unauthenticated GitHub API limit is
sufficient for the Home Assistant instance. Never put a token in dashboard
YAML: Lovelace configuration is sent to browsers.

HACS installs only the frontend resource. It cannot create or update these
REST sensors. After changing REST configuration, validate and restart Home
Assistant, then select the resulting entities in the card editor.

## Sorting and availability

- `newest` sorts valid `published_at` values newest-first and is the default.
- `configured` always uses the source order from YAML or the editor.
- `name` sorts by the displayed software name using Home Assistant's language.
- `hide_age: true` removes row ages and the newest-age header summary.

An invalid or missing timestamp displays Unknown age and sorts after valid
dates. A failing source does not hide healthy releases or blank the card.

See the [configuration reference](/configuration) for every field and grid
behavior.
