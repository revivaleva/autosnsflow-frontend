import { build } from "esbuild";

await build({
  entryPoints: ["src/handler.ts"],
  outfile: "dist/handler.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false
});
