import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import "./custom.css";

const footerMessage =
  "Released under the MIT License. This project is not affiliated with Mushroom Cards, Home Assistant, or MeshCore.";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "doc-footer-before": () =>
        h("p", { class: "mmc-doc-footer-message" }, footerMessage),
    }),
};
