import { copyFile, link, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const stockVideosDirectory = resolve(currentDirectory, '..', 'stock-videos');
const manifestPath = resolve(stockVideosDirectory, 'manifest.json');
const albumPath = resolve(currentDirectory, '..', 'album.json');

function hashString(input) {
    let hash = 2166136261;
    const safeInput = String(input || '');

    for (let index = 0; index < safeInput.length; index += 1) {
        hash ^= safeInput.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function slugifyValue(value) {
    const ascii = String(value || '')
        .normalize('NFKD')
        .replace(/[^\x00-\x7F]+/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    return ascii;
}

function getTrackVideoBaseName(track) {
    const audioBaseName = basename(String(track?.mp3 || '').trim(), extname(String(track?.mp3 || '').trim()));
    const safeAudioBaseName = slugifyValue(audioBaseName);
    if (safeAudioBaseName) {
        return safeAudioBaseName;
    }

    const safeTitle = slugifyValue(track?.title);
    if (safeTitle) {
        return safeTitle;
    }

    return `track_${track?.id || 'unknown'}`;
}

function getUniqueTrackVideoNames(tracks) {
    const usedNames = new Set();

    return tracks.map((track) => {
        const baseName = getTrackVideoBaseName(track);
        let candidate = baseName;
        let suffix = 2;

        while (usedNames.has(candidate)) {
            candidate = `${baseName}_${suffix}`;
            suffix += 1;
        }

        usedNames.add(candidate);
        return {
            track,
            fileName: `${candidate}.mp4`
        };
    });
}

async function ensureAliasFile(sourcePath, aliasPath) {
    if (resolve(sourcePath) === resolve(aliasPath)) {
        return;
    }

    await rm(aliasPath, { force: true });

    try {
        await link(sourcePath, aliasPath);
    } catch {
        await copyFile(sourcePath, aliasPath);
    }
}

async function readExistingManifest(manifestFilePath) {
    try {
        return JSON.parse(await readFile(manifestFilePath, 'utf8'));
    } catch {
        return null;
    }
}

const albumData = JSON.parse(await readFile(albumPath, 'utf8'));
const tracks = (Array.isArray(albumData?.tracks) ? albumData.tracks.slice() : [])
    .sort((left, right) => (Number(left?.id) || 0) - (Number(right?.id) || 0));
const trackVideoNames = getUniqueTrackVideoNames(tracks);
const existingManifest = await readExistingManifest(manifestPath);
const currentAliasNames = new Set(trackVideoNames.map((entry) => entry.fileName));
const previousAliasNames = new Set(Object.values(existingManifest?.trackVideos || {})
    .map((entry) => basename(String(entry || '')))
    .filter(Boolean));
const generatedAliasNames = new Set([...currentAliasNames, ...previousAliasNames]);
const reservedAliasNames = new Set([...generatedAliasNames].map((entry) => entry.toLowerCase()));

const videoEntries = (await readdir(stockVideosDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.mp4$/i.test(entry.name) && !reservedAliasNames.has(entry.name.toLowerCase()))
    .map((entry) => `stock-videos/${entry.name}`)
    .sort();

await Promise.all([...generatedAliasNames].map((fileName) => {
    return rm(resolve(stockVideosDirectory, fileName), { force: true });
}));

const trackVideos = {};

trackVideoNames.forEach(({ track, fileName }) => {
    if (!videoEntries.length) {
        return;
    }

    const seed = hashString(`${track?.id || 0}|${track?.title || ''}|${track?.mp3 || ''}`);
    const index = seed % videoEntries.length;
    const sourceRelativePath = videoEntries[index];
    const sourcePath = resolve(currentDirectory, '..', sourceRelativePath);
    const aliasRelativePath = `stock-videos/${fileName}`;
    trackVideos[String(track.id)] = aliasRelativePath;
});

await Promise.all(trackVideoNames.map(async ({ track, fileName }) => {
    if (!videoEntries.length) {
        return;
    }

    const seed = hashString(`${track?.id || 0}|${track?.title || ''}|${track?.mp3 || ''}`);
    const index = seed % videoEntries.length;
    const sourceRelativePath = videoEntries[index];
    const sourcePath = resolve(currentDirectory, '..', sourceRelativePath);
    const aliasPath = resolve(stockVideosDirectory, fileName);
    await ensureAliasFile(sourcePath, aliasPath);
}));

const manifest = JSON.stringify({ videos: videoEntries, trackVideos }, null, 4);
await writeFile(manifestPath, `${manifest}\n`, 'utf8');

console.log(`Synced ${videoEntries.length} source stock videos and ${trackVideoNames.length} track aliases to ${manifestPath}`);