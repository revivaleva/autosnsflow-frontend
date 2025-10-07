import { build } from "esbuild";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple alias plugin to resolve imports like '@/lib/config' -> ./src/lib/config.ts
const aliasPlugin = {
  name: 'alias-plugin',
  setup(build) {
    build.onResolve({ filter: /^@\/lib\/.*/ }, args => {
      const rel = args.path.replace(/^@\/lib\//, '');
      // Resolve to repository-level src/lib (two levels up from lambda folder)
      const resolved = path.resolve(__dirname, '..', '..', 'src', 'lib', rel + '.ts');
      return { path: resolved };
    });
  }
};

await build({
  entryPoints: ["src/handler.ts"],
  outfile: "dist/handler.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  plugins: [aliasPlugin],
});
