import { defineConfig } from "vitepress";

export default defineConfig({
  title: "dv",
  description:
    "A language-agnostic, git-native changelog CLI for monorepos.",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/walkthrough" },
      { text: "Reference", link: "/cli" },
    ],
    socialLinks: [],
  },
});
