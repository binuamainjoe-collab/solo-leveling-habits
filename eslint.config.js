// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions is Deno, not React Native — it has its own globals and
    // is checked when it is deployed, not by the app's lint.
    ignores: ["dist/*", "supabase/functions/**", ".netlify/*"],
  }
]);
