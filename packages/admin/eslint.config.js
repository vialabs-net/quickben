import { quickben } from "@quickben/eslint-config";

export default quickben({ tsconfigRootDir: import.meta.dirname, uiFiles: ["src/**/*.tsx"] });
