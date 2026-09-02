<h1 align="center">
  <img src="https://raw.githubusercontent.com/2wenty2wo/mushroom-meshcore-card/main/assets/logo.png" alt="Mushroom MeshCore Card" width="140"><br>
  Mushroom MeshCore Card
</h1>

<div align="center">

Mushroom and Tile styled [Home Assistant](https://www.home-assistant.io/) Lovelace cards and a network-status badge for the [MeshCore](https://meshcore.io) integration.

This project is a fork of [jpettitt/meshcore-card](https://github.com/jpettitt/meshcore-card).

[![CI](https://github.com/2wenty2wo/mushroom-meshcore-card/actions/workflows/ci.yml/badge.svg)](https://github.com/2wenty2wo/mushroom-meshcore-card/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/2wenty2wo/mushroom-meshcore-card/branch/main/graph/badge.svg)](https://codecov.io/gh/2wenty2wo/mushroom-meshcore-card)
[![GitHub Release](https://img.shields.io/github/v/release/2wenty2wo/mushroom-meshcore-card?style=flat&label=release)](https://github.com/2wenty2wo/mushroom-meshcore-card/releases)
[![License](https://img.shields.io/github/license/2wenty2wo/mushroom-meshcore-card?style=flat&label=license)](LICENSE)
[![HACS](https://img.shields.io/badge/HACS-Custom-orange?style=flat)](https://hacs.xyz)

### [Read the full documentation](https://2wenty2wo.github.io/mushroom-meshcore-card/)

</div>

## Requirements

- Home Assistant 2023.x or later
- [MeshCore Integration](https://github.com/meshcore-dev/meshcore-ha), installed and configured

Mushroom and Card Mod are optional. The cards work independently with Home Assistant theme fallbacks.

## Installation

### HACS

1. Open **HACS → Frontend**.
2. Open the ⋮ menu and choose **Custom repositories**.
3. Add `https://github.com/2wenty2wo/mushroom-meshcore-card` as a **Dashboard** repository.
4. Install **Mushroom MeshCore Card**.
5. Reload the browser.

[![Add Repository](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=2wenty2wo&repository=mushroom-meshcore-card&category=plugin)

### Manual

1. Download `mushroom-meshcore-card.js` from the latest [release](https://github.com/2wenty2wo/mushroom-meshcore-card/releases).
2. Copy it to `config/www/mushroom-meshcore-card.js`.
3. Add `/local/mushroom-meshcore-card.js` under **Settings → Dashboards → Resources** as a JavaScript module.
4. Reload the browser.

## Documentation and support

- [Documentation](https://2wenty2wo.github.io/mushroom-meshcore-card/)
- [Releases](https://github.com/2wenty2wo/mushroom-meshcore-card/releases)
- [Issues](https://github.com/2wenty2wo/mushroom-meshcore-card/issues)

## Localisation

The cards follow Home Assistant's active language and include English, French, Dutch, German, and Polish translations. The documentation is currently available in English.

## License

[MIT](LICENSE)
