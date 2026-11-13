import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";

import type { MDXComponents } from "nextra/mdx-components";

const themeComponents = getThemeComponents();

/** MDX components for docs pages: the Nextra docs theme defaults. */
export function useMDXComponents(components: MDXComponents = {}) {
  return { ...themeComponents, ...components };
}
