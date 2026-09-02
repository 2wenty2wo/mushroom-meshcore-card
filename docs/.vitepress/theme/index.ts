import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import { footerMessage } from "../footer";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "doc-footer-before": () =>
        h("p", { class: "mmc-doc-footer-message" }, footerMessage),
    }),
};
