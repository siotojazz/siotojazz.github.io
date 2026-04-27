import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const albumPath = resolve(__dirname, '..', 'album.json');
const albumRoot = resolve(__dirname, '..');
const repoRoot = resolve(__dirname, '..', '..');

const FORMAT_DIMENSIONS = {
    youtube: { width: 1920, height: 1080 },
    instagram: { width: 1080, height: 1920 }
};

const OUTPUT_FPS = 60;

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
    '.webm': 'video/webm',
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
        } catch (error) {
            response.writeHead(404);
            response.end(error?.message || 'Not found');
        }
    });

    await new Promise((resolvePromise) => {
        server.listen(0, '127.0.0.1', resolvePromise);
    });

    const address = server.address();
    return {
        close() {
            return new Promise((resolvePromise, rejectPromise) => {
                server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
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

function ensureMp4Extension(outputPath) {
    if (/\.mp4$/i.test(outputPath)) {
        return outputPath;
    }
    return outputPath.replace(/\.[^.]+$/, '') + '.mp4';
}

function formatDuration(seconds) {
    const numericSeconds = Number(seconds);
    const safeSeconds = Number.isFinite(numericSeconds) && numericSeconds >= 0 ? numericSeconds : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

let progressBarLength = 0;

function renderProgressBar({ progress = 0, currentTime = 0, duration = 0, label = 'Rendering' } = {}) {
    const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    const width = 32;
    const filled = Math.round(safeProgress * width);
    const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
    const percent = `${Math.round(safeProgress * 100)}`.padStart(3, ' ');
    const line = `${label} [${bar}] ${percent}% ${formatDuration(currentTime)} / ${formatDuration(duration)}`;
    const padding = ' '.repeat(Math.max(0, progressBarLength - line.length));
    progressBarLength = line.length;
    process.stdout.write(`\r${line}${padding}`);
}

function finishProgressBar() {
    if (!progressBarLength) {
        return;
    }
    process.stdout.write('\n');
    progressBarLength = 0;
}

function findFfmpegBinary() {
    if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
        return process.env.FFMPEG_PATH;
    }

    // Try PATH lookup via spawn-on-demand later; first probe known winget locations on Windows.
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            const candidates = [
                'Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
                'Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe',
                'Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe'
            ];

            for (const relative of candidates) {
                const base = resolve(localAppData, relative);
                if (!existsSync(base)) {
                    continue;
                }

                // Look for ffmpeg-*\bin\ffmpeg.exe one level deep.
                try {
                    for (const entry of readdirSync(base)) {
                        const candidate = resolve(base, entry, 'bin', 'ffmpeg.exe');
                        if (existsSync(candidate)) {
                            return candidate;
                        }
                    }
                } catch {
                    // Ignore and continue.
                }
            }
        }
    }

    return 'ffmpeg';
}

function buildAtempoFilter(speed) {
    // ffmpeg's atempo filter accepts 0.5..2.0 per stage; chain stages for values outside that range.
    const safeSpeed = Math.max(0.1, Math.min(4, Number(speed) || 1));
    if (Math.abs(safeSpeed - 1) < 1e-6) {
        return null;
    }

    const stages = [];
    let remaining = safeSpeed;
    while (remaining < 0.5 - 1e-6 || remaining > 2 + 1e-6) {
        if (remaining < 0.5) {
            stages.push(0.5);
            remaining /= 0.5;
        } else {
            stages.push(2);
            remaining /= 2;
        }
    }
    stages.push(remaining);
    return stages.map((value) => `atempo=${value.toFixed(6)}`).join(',');
}

function spawnFfmpeg({ ffmpegPath, audioPath, audioOffsetSeconds, speed, durationSeconds, outputPath, dimensions }) {
    const args = ['-y', '-hide_banner', '-loglevel', 'warning'];

    // Video input: PNG frames piped on stdin at the chosen output FPS.
    args.push('-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(OUTPUT_FPS), '-i', 'pipe:0');

    // Audio input: read from the original mp3 file (no resampling/clock drift introduced by
    // capturing audio.captureStream in the page).
    if (audioOffsetSeconds && audioOffsetSeconds > 0) {
        args.push('-ss', audioOffsetSeconds.toFixed(6));
    }
    args.push('-i', audioPath);

    // Audio filter: optional atempo chain for non-1x speed renders.
    const atempoFilter = buildAtempoFilter(speed);
    if (atempoFilter) {
        args.push('-filter:a', atempoFilter);
    }

    args.push(
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '17',
        '-pix_fmt', 'yuv420p',
        '-r', String(OUTPUT_FPS),
        '-vsync', 'cfr',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-shortest',
        '-t', durationSeconds.toFixed(6),
        '-s', `${dimensions.width}x${dimensions.height}`,
        outputPath
    );

    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'inherit', 'inherit'] });
    return child;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const trackId = Number.parseInt(args.track, 10) || 1;
    const explicitDuration = Number.isFinite(Number.parseFloat(args.duration))
        ? Math.max(0.001, Number.parseFloat(args.duration))
        : null;
    const speed = (() => {
        const value = Number.parseFloat(args.speed);
        if (!Number.isFinite(value)) {
            return 1;
        }
        return Math.max(0.1, Math.min(2, value));
    })();
    const format = args.format === 'instagram' ? 'instagram' : 'youtube';
    const dimensions = FORMAT_DIMENSIONS[format];

    if (args.fps && Number.parseInt(args.fps, 10) !== OUTPUT_FPS) {
        console.warn(`[render] Ignoring --fps=${args.fps}; output is locked to ${OUTPUT_FPS} fps.`);
    }

    const albumData = JSON.parse(await readFile(albumPath, 'utf8'));
    const track = getTrackFromAlbum(albumData, trackId);

    if (!track) {
        throw new Error(`Track ${trackId} was not found in album.json.`);
    }

    if (!track.mp3) {
        throw new Error(`Track ${track.id} has no mp3 path in album.json.`);
    }

    const audioPath = resolve(albumRoot, track.mp3);
    if (!existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    const slug = slugifyTrackTitle(track);
    const speedSuffix = Math.abs(speed - 1) < 0.001 ? '' : `-${String(speed).replace('.', 'p')}x`;
    const formatSuffix = format === 'instagram' ? '-9x16' : '';
    const defaultOutput = `renders/${track.id}-${slug}${formatSuffix}${speedSuffix}.mp4`;
    const outputPath = ensureMp4Extension(resolve(albumRoot, args.output || defaultOutput));

    await mkdir(dirname(outputPath), { recursive: true });
    await rm(outputPath, { force: true });

    const ffmpegPath = findFfmpegBinary();
    const server = await createStaticServer(repoRoot);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    let ffmpegChild = null;

    try {
        const page = await browser.newPage({
            deviceScaleFactor: 1,
            viewport: dimensions
        });

        page.on('pageerror', (error) => console.error('[page error]', error.message));
        page.on('console', (message) => {
            const type = message.type();
            if (type === 'error' || type === 'warning') {
                console.log(`[page ${type}]`, message.text());
            }
        });

        // We render at speed=1 inside the page (the page only seeks to song-time; we never play
        // audio in the page during deterministic capture). Audio speed is applied later by ffmpeg.
        const renderUrl = `http://127.0.0.1:${server.port}/3000/visualizer-render.html`
            + `?track=${track.id}`
            + `&format=${format}`
            + `&speed=1`;
        console.log(`Opening ${renderUrl}`);
        await page.goto(renderUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction((expectedTrackId) => {
            return window.__visualizerRender?.getTrack?.()?.id === expectedTrackId;
        }, track.id);
        await page.waitForFunction(() => window.__visualizerRender?.isReady?.() === true);
        await page.evaluate(async () => {
            await window.__visualizerRender.whenReady?.();
            await document.fonts.ready;
        });

        const routeDuration = await page.evaluate(() => window.__visualizerRender.getDuration());
        const songDuration = explicitDuration ?? routeDuration;

        if (!Number.isFinite(songDuration) || songDuration <= 0) {
            throw new Error('Track duration could not be determined.');
        }

        const outputDurationSeconds = songDuration / speed;
        const totalFrames = Math.max(1, Math.round(outputDurationSeconds * OUTPUT_FPS));

        console.log(
            `Rendering track ${track.id} (${track.title}) → ${outputPath}`
            + `\n  format: ${format} (${dimensions.width}x${dimensions.height}) @ ${OUTPUT_FPS}fps`
            + `\n  song duration: ${songDuration.toFixed(3)}s, speed: ${speed}× → output ${outputDurationSeconds.toFixed(3)}s (${totalFrames} frames)`
            + `\n  ffmpeg: ${ffmpegPath}`
        );

        ffmpegChild = spawnFfmpeg({
            ffmpegPath,
            audioPath,
            audioOffsetSeconds: 0,
            speed,
            durationSeconds: outputDurationSeconds,
            outputPath,
            dimensions
        });

        const ffmpegExit = new Promise((resolvePromise, rejectPromise) => {
            ffmpegChild.on('error', rejectPromise);
            ffmpegChild.on('close', (code, signal) => {
                if (code === 0) {
                    resolvePromise();
                } else {
                    rejectPromise(new Error(`ffmpeg exited with code ${code}, signal ${signal}`));
                }
            });
        });

        const stdin = ffmpegChild.stdin;
        const canvasLocator = page.locator('#visualizer-render-root canvas').first();
        await canvasLocator.waitFor({ state: 'attached' });

        let lastProgressLog = 0;
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
            const outputTime = frameIndex / OUTPUT_FPS;
            const songTime = Math.min(outputTime * speed, songDuration);

            await page.evaluate(async (t) => {
                await window.__visualizerRender.setTime(t);
            }, songTime);

            const buffer = await canvasLocator.screenshot({ type: 'png', omitBackground: false });

            if (!stdin.write(buffer)) {
                await new Promise((resolveDrain) => stdin.once('drain', resolveDrain));
            }

            const now = Date.now();
            if (now - lastProgressLog > 200 || frameIndex === totalFrames - 1) {
                lastProgressLog = now;
                renderProgressBar({
                    progress: (frameIndex + 1) / totalFrames,
                    currentTime: outputTime,
                    duration: outputDurationSeconds,
                    label: 'Capturing'
                });
            }
        }

        finishProgressBar();
        stdin.end();
        console.log('Frames captured. Finalizing with ffmpeg...');
        await ffmpegExit;

        console.log(`Wrote ${outputPath}`);
    } catch (error) {
        if (ffmpegChild && !ffmpegChild.killed) {
            try {
                ffmpegChild.kill('SIGKILL');
            } catch {
                // ignore
            }
        }
        throw error;
    } finally {
        finishProgressBar();
        await browser.close();
        await server.close();
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
