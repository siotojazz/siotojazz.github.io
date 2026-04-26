import { readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const stockVideosDirectory = resolve(currentDirectory, '..', 'stock-videos');
const manifestPath = resolve(stockVideosDirectory, 'manifest.json');

const videoEntries = (await readdir(stockVideosDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.mp4$/i.test(entry.name))
    .map((entry) => `stock-videos/${entry.name}`)
    .sort();

const manifest = JSON.stringify({ videos: videoEntries }, null, 4);
await writeFile(manifestPath, `${manifest}\n`, 'utf8');

console.log(`Synced ${videoEntries.length} stock videos to ${manifestPath}`);