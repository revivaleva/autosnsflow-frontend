const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');

// Resolve aliases like '@/lib/...' to repository src/lib
const aliasPlugin = {
  name: 'alias-plugin',
  setup(build) {
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
        try { if (fs.existsSync(c)) return { path: c }; } catch (_) {}
      }
      return { path: base + '.ts' };
    });
  }
};

build({
  entryPoints: ["src/handler.ts"],
  outfile: "dist/handler.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  plugins: [aliasPlugin],
}).catch(e => { console.error(e); process.exit(1); });


