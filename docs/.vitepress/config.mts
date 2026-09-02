import { defineConfig } from "vitepress";

const repository = "https://github.com/2wenty2wo/mushroom-meshcore-card";

export default defineConfig({
  lang: "en",
  title: "Mushroom MeshCore Card",
  description:
    "Mushroom and Tile styled Home Assistant Lovelace cards for MeshCore.",
  base: "/mushroom-meshcore-card/",
  cleanUrls: false,
  lastUpdated: true,
  srcExclude: ["releasing.md"],
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/mushroom-meshcore-card/logo.svg" }],
    ["meta", { name: "theme-color", content: "#2F9E57" }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Mushroom MeshCore Card",
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Cards", link: "/cards/main" },
      { text: "Configuration", link: "/configuration" },
      { text: "Troubleshooting", link: "/troubleshooting" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
      {
        text: "Cards",
        items: [
          { text: "Main card", link: "/cards/main" },
          { text: "Channel card", link: "/cards/channel" },
          { text: "Mentions card", link: "/cards/mentions" },
          { text: "Releases card", link: "/cards/releases" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Configuration", link: "/configuration" },
          { text: "Chips and compatibility", link: "/chips" },
          { text: "Theming and Card Mod", link: "/theming" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Mentions blueprint", link: "/mentions-blueprint" },
        ],
      },
    ],
    search: {
      provider: "local",
    },
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    lastUpdated: {
      text: "Last updated",
      formatOptions: {
        dateStyle: "medium",
      },
    },
    outline: {
      level: [2, 3],
      label: "On this page",
    },
    docFooter: {
      prev: "Previous page",
      next: "Next page",
    },
    socialLinks: [{ icon: "github", link: repository }],
    footer: {
      message:
        "Released under the MIT License. This project is not affiliated with Mushroom Cards, Home Assistant, or MeshCore.",
      copyright: "Mushroom MeshCore Card contributors",
    },
  },
});
