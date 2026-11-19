import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The pipeline writes its outputs to <repo>/docs/. They are not copied into web/
 * so there is a single source of truth: the dev server serves them straight from
 * docs/, and the production build copies them next to index.html.
 */
const DATA_DIR = path.resolve(__dirname, '../docs');
export const DATA_FILES = [
  'sample_telemetry.json',
  'predictions.json',
  'station_summary.json',
] as const;

function pipelineData(): Plugin {
  return {
    name: 'aether-pipeline-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!(DATA_FILES as readonly string[]).includes(name)) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(path.join(DATA_DIR, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of DATA_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: name,
          source: fs.readFileSync(path.join(DATA_DIR, name)),
        });
      }
    },
  };
}

export default defineConfig({
  // Relative base so the build works both at a domain root and under a
  // GitHub Pages project path (https://<user>.github.io/<repo>/).
  base: './',
  plugins: [react(), tailwindcss(), pipelineData()],
});
