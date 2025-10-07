import { build } from "esbuild";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple alias plugin to resolve imports like '@/lib/config' -> ./src/lib/config.ts
const aliasPlugin = {
  name: 'alias-plugin',
  setup(build) {
    const fs = await import('fs');
    build.onResolve({ filter: /^@\/lib\/.*/ }, args => {
      const rel = args.path.replace(/^@\/lib\//, '');
      const base = path.resolve(__dirname, '..', '..', 'src', 'lib', rel);
      const candidates = [
        base + '.ts',
        base + '.js',
        base + '.mjs',
        base + '.cjs',
        path.join(base, 'index.ts'),
        path.join(base, 'index.js')
      ];
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) return { path: c };
        } catch (_) {}
      }
      // fallback to base+'.ts' even if not found so esbuild can attempt resolution
      return { path: base + '.ts' };
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
