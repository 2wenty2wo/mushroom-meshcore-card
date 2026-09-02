import { MeshcoreCard } from "./card.js";
import { MeshcoreCardEditor } from "./editor.js";
import { MeshcoreChannelCard, MeshcoreChannelCardEditor } from "./channel-card.js";
import { MeshcoreMentionsCard, MeshcoreMentionsCardEditor } from "./mentions-card.js";
import { MeshcoreReleasesCard, MeshcoreReleasesCardEditor } from "./releases-card.js";
import { MeshcoreStatusCard } from "./status-card.js";
import {
  MeshcoreStatusBadgeEditor,
  MeshcoreStatusCardEditor,
} from "./status-editor.js";
import { MeshcoreStatusBadge } from "./status-badge.js";

// ── Registration ──────────────────────────────────────────────────────────────

if (!customElements.get("mushroom-meshcore-card")) {
  customElements.define("mushroom-meshcore-card", MeshcoreCard);
}
if (!customElements.get("mushroom-meshcore-card-editor")) {
  customElements.define("mushroom-meshcore-card-editor", MeshcoreCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === "mushroom-meshcore-card")) {
  window.customCards.push({
    type: "mushroom-meshcore-card",
    name: "Mushroom MeshCore Device Card",
    description: "Displays one selected MeshCore hub or remote node in a Tile-style layout",
    preview: true,
    documentationURL: "https://github.com/2wenty2wo/mushroom-meshcore-card",
  });
}

if (!customElements.get("mushroom-meshcore-channel-card")) {
  customElements.define("mushroom-meshcore-channel-card", MeshcoreChannelCard);
}
if (!customElements.get("mushroom-meshcore-channel-card-editor")) {
  customElements.define("mushroom-meshcore-channel-card-editor", MeshcoreChannelCardEditor);
}
if (!window.customCards.find((c) => c.type === "mushroom-meshcore-channel-card")) {
  window.customCards.push({
    type: "mushroom-meshcore-channel-card",
    name: "Mushroom MeshCore Channel Card",
    description: "Displays one selected MeshCore channel with live chat history",
    preview: true,
    documentationURL: "https://github.com/2wenty2wo/mushroom-meshcore-card",
  });
}

if (!customElements.get("mushroom-meshcore-mentions-card")) {
  customElements.define("mushroom-meshcore-mentions-card", MeshcoreMentionsCard);
}
if (!customElements.get("mushroom-meshcore-mentions-card-editor")) {
  customElements.define("mushroom-meshcore-mentions-card-editor", MeshcoreMentionsCardEditor);
}
if (!window.customCards.find((c) => c.type === "mushroom-meshcore-mentions-card")) {
  window.customCards.push({
    type: "mushroom-meshcore-mentions-card",
    name: "Mushroom MeshCore Mentions Card",
    description: "Displays persistent MeshCore mentions from a selected Home Assistant to-do list",
    preview: true,
    documentationURL: "https://github.com/2wenty2wo/mushroom-meshcore-card",
  });
}

if (!customElements.get("mushroom-meshcore-releases-card")) {
  customElements.define("mushroom-meshcore-releases-card", MeshcoreReleasesCard);
}
if (!customElements.get("mushroom-meshcore-releases-card-editor")) {
  customElements.define(
    "mushroom-meshcore-releases-card-editor",
    MeshcoreReleasesCardEditor
  );
}
if (!window.customCards.find((c) => c.type === "mushroom-meshcore-releases-card")) {
  window.customCards.push({
    type: "mushroom-meshcore-releases-card",
    name: "Mushroom MeshCore Releases Card",
    description: "Displays explicitly configured MeshCore software release sensors",
    preview: true,
    documentationURL:
      "https://2wenty2wo.github.io/mushroom-meshcore-card/cards/releases.html",
  });
}

if (!customElements.get("mushroom-meshcore-status-card")) {
  customElements.define("mushroom-meshcore-status-card", MeshcoreStatusCard);
}
if (!customElements.get("mushroom-meshcore-status-card-editor")) {
  customElements.define(
    "mushroom-meshcore-status-card-editor",
    MeshcoreStatusCardEditor
  );
}
if (!window.customCards.find((c) => c.type === "mushroom-meshcore-status-card")) {
  window.customCards.push({
    type: "mushroom-meshcore-status-card",
    name: "Mushroom MeshCore Status Card",
    description:
      "Summarizes the health of one selected MeshCore hub and its managed nodes",
    preview: true,
    documentationURL:
      "https://2wenty2wo.github.io/mushroom-meshcore-card/cards/status.html",
  });
}

if (!customElements.get("mushroom-meshcore-status-badge")) {
  customElements.define("mushroom-meshcore-status-badge", MeshcoreStatusBadge);
}
if (!customElements.get("mushroom-meshcore-status-badge-editor")) {
  customElements.define(
    "mushroom-meshcore-status-badge-editor",
    MeshcoreStatusBadgeEditor
  );
}

window.customBadges = window.customBadges || [];
if (!window.customBadges.find((badge) => badge.type === "mushroom-meshcore-status-badge")) {
  window.customBadges.push({
    type: "mushroom-meshcore-status-badge",
    name: "Mushroom MeshCore Status Badge",
    description:
      "Shows at-a-glance health for one selected MeshCore hub and its managed nodes",
    preview: true,
    documentationURL:
      "https://2wenty2wo.github.io/mushroom-meshcore-card/cards/status.html",
  });
}
