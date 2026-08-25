import { MeshcoreCard } from "./card.js";
import { MeshcoreCardEditor } from "./editor.js";
import { MeshcoreChannelCard, MeshcoreChannelCardEditor } from "./channel-card.js";
import { MeshcoreMentionsCard, MeshcoreMentionsCardEditor } from "./mentions-card.js";

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
