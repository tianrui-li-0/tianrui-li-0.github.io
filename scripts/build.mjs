import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
await mkdir(output, {recursive: true});
for (const item of ['index.html', 'site.html', 'navigation.js', 'intro-audio.js', 'signal.js', 'admin', 'works', 'blog', 'robots.txt', '.nojekyll']) {
  await cp(resolve(root, item), resolve(output, item), {recursive: true});
}
await writeFile(resolve(output, '_worker.js'), await readFile(resolve(root, 'backend/worker.mjs')));
await writeFile(resolve(output, '_routes.json'), JSON.stringify({version: 1, include: ['/api/*', '/admin', '/admin/*'], exclude: []}, null, 2));
console.log('Built portfolio, inbox, and private API in dist.');
