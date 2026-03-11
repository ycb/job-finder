import { fileURLToPath } from "node:url";

const tailwindConfigPath = fileURLToPath(new URL("./tailwind.config.js", import.meta.url));

export default {
  plugins: {
    tailwindcss: {
      config: tailwindConfigPath,
    },
    autoprefixer: {},
  },
};
