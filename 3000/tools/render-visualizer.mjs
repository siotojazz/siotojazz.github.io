import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const albumPath = resolve(__dirname, '..', 'album.json');
const albumRoot = resolve(__dirname, '..');
const repoRoot = resolve(__dirname, '..', '..');

const FRAME_SIZE = { width: 1920, height: 1080 };

const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function parseArgs(argv) {
    return argv.reduce((result, argument) => {
        if (!argument.startsWith('--')) {
            return result;
        }

        const [key, rawValue] = argument.slice(2).split('=');
        result[key] = rawValue === undefined ? true : rawValue;
        return result;
    }, {});
}

function ensureCommand(command) {
    const result = spawnSync(command, ['-version'], { stdio: 'ignore' });
    if (result.status !== 0) {
        throw new Error(`${command} is required on PATH before rendering.`);
    }
}

function ensureWithinRoot(root, requestedPath) {
    const resolved = resolve(root, `.${requestedPath}`);
    if (!resolved.startsWith(root)) {
        return null;
    }
    return resolved;
}

async function createStaticServer(root) {
    const server = createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
            let filePath = ensureWithinRoot(root, decodeURIComponent(requestUrl.pathname));

            if (!filePath) {
                response.writeHead(403);
                response.end('Forbidden');
                return;
            }

            if (extname(filePath) === '') {
                filePath = resolve(filePath, 'index.html');
            }

            await access(filePath, fsConstants.R_OK);
            response.writeHead(200, {
                'Content-Type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream'
            });
            createReadStream(filePath).pipe(response);
        } catch {
            response.writeHead(404);
            response.end('Not found');
        }
    });

    await new Promise((resolvePromise) => {
        server.listen(0, '127.0.0.1', resolvePromise);
    });

    const address = server.address();
    return {
        close() {
            return new Promise((resolvePromise, rejectPromise) => {
                server.close((error) => {
                    if (error) {
                        rejectPromise(error);
                        return;
                    }
                    resolvePromise();
                });
            });
        },
        port: address.port
    };
}

function getTrackFromAlbum(albumData, trackId) {
    const tracks = Array.isArray(albumData.tracks) ? albumData.tracks : [];
    return tracks.find((track) => Number(track.id) === trackId) || tracks[0] || null;
}

function slugifyTrackTitle(track) {
    const ascii = String(track?.title || '')
        .normalize('NFKD')
        .replace(/[^\x00-\x7F]+/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return ascii || `track-${track?.id || 'unknown'}`;
}

function runFfmpeg(args) {
    return new Promise((resolvePromise, rejectPromise) => {
        const process = spawn('ffmpeg', args, { stdio: 'inherit' });
        process.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(new Error(`ffmpeg exited with code ${code}`));
        });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const trackId = Number.parseInt(args.track, 10) || 1;
    const fps = Math.max(1, Number.parseInt(args.fps, 10) || 30);
    const albumData = JSON.parse(await readFile(albumPath, 'utf8'));
    const track = getTrackFromAlbum(albumData, trackId);

    if (!track) {
        throw new Error(`Track ${trackId} was not found in album.json.`);
    }

    ensureCommand('ffmpeg');

    const outputPath = resolve(
        albumRoot,
        args.output || `renders/${track.id}-${slugifyTrackTitle(track)}.mp4`
    );
    const tempDir = await mkdtemp(resolve(tmpdir(), '3000-visualizer-'));
    const framesDir = resolve(tempDir, 'frames');
    const audioPath = resolve(albumRoot, track.mp3);
    const server = await createStaticServer(repoRoot);
    const browser = await chromium.launch({ headless: true });

    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(framesDir, { recursive: true });

    try {
        const page = await browser.newPage({
            deviceScaleFactor: 1,
            viewport: {
                width: FRAME_SIZE.width,
                height: FRAME_SIZE.height
            }
        });

        const renderUrl = `http://127.0.0.1:${server.port}/3000/visualizer-render.html?track=${track.id}`;
        console.log(`Opening ${renderUrl}`);
        await page.goto(renderUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction((expectedTrackId) => {
            return window.__visualizerRender?.getTrack?.()?.id === expectedTrackId;
        }, track.id);
        await page.waitForFunction(() => {
            return window.__visualizerRender?.isReady?.() === true;
        });
        await page.evaluate(async () => {
            await window.__visualizerRender.whenReady?.();
            await document.fonts.ready;
        });

        const duration = Number.isFinite(Number.parseFloat(args.duration))
            ? Number.parseFloat(args.duration)
            : await page.evaluate(() => window.__visualizerRender.getDuration());
        const totalFrames = Math.max(1, Math.ceil(duration * fps));
        const captureTarget = page.locator('#visualizer-render-root');

        console.log(`Capturing ${totalFrames} frames at ${fps} fps.`);

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
            const frameTime = Math.min(duration, frameIndex / fps);
            await page.evaluate(async (time) => {
                await window.__visualizerRender.setTime(time);
                await new Promise((resolvePromise) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolvePromise));
                });
            }, frameTime);

            const framePath = resolve(framesDir, `frame-${String(frameIndex).padStart(6, '0')}.png`);
            await captureTarget.screenshot({ path: framePath });

            if ((frameIndex + 1) % Math.max(1, Math.floor(totalFrames / 10)) === 0 || frameIndex === totalFrames - 1) {
                console.log(`Captured ${frameIndex + 1}/${totalFrames}`);
            }
        }

        const ffmpegArgs = [
            '-y',
            '-framerate', String(fps),
            '-i', resolve(framesDir, 'frame-%06d.png'),
            '-i', audioPath,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '320k',
            '-shortest',
            outputPath
        ];

        console.log(`Encoding ${outputPath}`);
        await runFfmpeg(ffmpegArgs);
        console.log(`Done: ${outputPath}`);
    } finally {
        await browser.close();
        await server.close();
        await rm(tempDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});