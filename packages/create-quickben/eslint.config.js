import { quickben } from "@quickben/eslint-config";

export default [
  // Templates are Next.js app files, checked by the scaffold test with `next build`.
  { ignores: ["templates/**"] },
  ...quickben({ tsconfigRootDir: import.meta.dirname }),
];
