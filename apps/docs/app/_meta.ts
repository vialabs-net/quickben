import type { MetaRecord } from "nextra";

const meta: MetaRecord = {
  index: {
    title: "Home",
    type: "page",
    display: "hidden",
    theme: {
      layout: "full",
      toc: false,
      sidebar: false,
      breadcrumb: false,
      pagination: false,
      timestamp: false,
      copyPage: false,
    },
  },
  docs: { title: "Docs", type: "page" },
};

export default meta;
