import { MeshcoreCard } from "./card.js";
import { MeshcoreCardEditor } from "./editor.js";
import { MeshcoreContactCard, MeshcoreContactCardEditor } from "./contact-card.js";
import { MeshcoreChannelCard, MeshcoreChannelCardEditor } from "./channel-card.js";

// ── Registration ──────────────────────────────────────────────────────────────

if (!customElements.get("mushroom-meshcore-card")) {
  customElements.define("mushroom-meshcore-card", MeshcoreCard);
}
if (!customElements.get("mushroom-meshcore-card-editor")) {
  customElements.define("mushroom-meshcore-card-editor", MeshcoreCardEditor);
}
if (!customElements.get("mushroom-meshcore-contact-card")) {
  customElements.define("mushroom-meshcore-contact-card", MeshcoreContactCard);
}
if (!customElements.get("mushroom-meshcore-contact-card-editor")) {
  customElements.define("mushroom-meshcore-contact-card-editor", MeshcoreContactCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === "mushroom-meshcore-card")) {
  window.customCards.push({
    type: "mushroom-meshcore-card",
    name: "Mushroom MeshCore Card",
    description: "Displays MeshCore hubs and nodes in a Mushroom-inspired layout",
    preview: true,
    documentationURL: "https://github.com/2wenty2wo/mushroom-meshcore-card",
  });
}
if (!window.customCards.find((c) => c.type === "mushroom-meshcore-contact-card")) {
  window.customCards.push({
    type: "mushroom-meshcore-contact-card",
    name: "Mushroom MeshCore Contact Card",
    description: "Lists all MeshCore contact nodes sorted by most recently heard",
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
    description: "Shows active MeshCore channels by hub",
    preview: true,
    documentationURL: "https://github.com/2wenty2wo/mushroom-meshcore-card",
  });
}
