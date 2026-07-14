import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const albumRoot = resolve(__dirname, '..');
const repoRoot = resolve(albumRoot, '..');
const albumPath = resolve(albumRoot, 'album.json');
const OUTPUT_FPS = 24;

const QUALITY_PRESETS = {
    low: {
        label: 'Low / fast draft',
        width: 960,
        height: 540,
        captureFps: 4,
        jpegQuality: 72,
        encoderPreset: 'ultrafast',
        crf: 28,
        audioBitrate: '128k',
        sequentialVideo: false
    },
    med: {
        label: 'Medium',
        width: 1280,
        height: 720,
        captureFps: 12,
        jpegQuality: 86,
        encoderPreset: 'veryfast',
        crf: 21,
        audioBitrate: '192k',
        sequentialVideo: false
    },
    max: {
        label: 'Maximum / YouTube master',
        width: 1920,
        height: 1080,
        captureFps: 24,
        jpegQuality: 94,
        encoderPreset: 'medium',
        crf: 17,
        audioBitrate: '320k',
        sequentialVideo: true
    }
};

const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.webm': 'video/webm'
};

function printHelp() {
    console.log(`Sioto Jazz full-album YouTube renderer

Usage:
  npm run album:frame -- [--time=MM:SS] [--output=path.png]
  npm run album:video:low
  npm run album:video:med
  npm run album:video:max

Options:
  --frame[=path]       Render one 1920x1080 PNG instead of a video.
  --time=HH:MM:SS      Album timestamp for the frame (default: first synced lyric).
  --start=HH:MM:SS     Album timestamp where video rendering begins.
  --end=HH:MM:SS       Album timestamp where video rendering ends.
  --output=path        Output file. Defaults to renders/album-frame.png or
                       renders/sioto-jazz-full-album.mp4.
  --quality=LEVEL      low, med, or max (video default: med; frame default: max).
  --capture-fps=N      Override the preset capture rate. Output remains 24 fps.
  --duration=seconds   Render this many seconds from --start; cannot combine with --end.
  --dry-run            Analyze the gapless timeline and print it without encoding.
  --help               Show this help.

Set FFMPEG_PATH to ffmpeg.exe if ffmpeg is not on PATH or installed through winget.`);
}

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument.startsWith('--')) continue;
        const equalsIndex = argument.indexOf('=');
        if (equalsIndex >= 0) {
            result[argument.slice(2, equalsIndex)] = argument.slice(equalsIndex + 1);
            continue;
        }

        const key = argument.slice(2);
        const next = argv[index + 1];
        if (next && !next.startsWith('--')) {
            result[key] = next;
            index += 1;
        } else {
            result[key] = true;
        }
    }
    return result;
}

function parseTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    const parts = String(value).trim().split(':');
    if (parts.some((part) => part === '' || !Number.isFinite(Number(part)))) {
        throw new Error(`Invalid timestamp: ${value}`);
    }

    let seconds = 0;
    for (const part of parts) seconds = (seconds * 60) + Number(part);
    if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error(`Invalid timestamp: ${value}`);
    }
    return seconds;
}

function ensureExtension(outputPath, extension) {
    if (outputPath.toLowerCase().endsWith(extension)) return outputPath;
    return outputPath.replace(/\.[^.]+$/, '') + extension;
}

function ensureWithinRoot(root, requestedPath) {
    const decodedPath = decodeURIComponent(requestedPath).replace(/^[/\\]+/, '');
    const resolvedPath = resolve(root, decodedPath || 'index.html');
    const rootRelativePath = relative(root, resolvedPath);
    if (rootRelativePath.startsWith('..') || isAbsolute(rootRelativePath)) return null;
    return resolvedPath;
}

function sendFile(request, response, filePath) {
    const fileSize = statSync(filePath).size;
    const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const rangeHeader = request.headers.range;

    if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (match) {
            const start = match[1] ? Number.parseInt(match[1], 10) : 0;
            const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
            const safeStart = Math.max(0, Math.min(fileSize - 1, start));
            const safeEnd = Math.max(safeStart, Math.min(fileSize - 1, end));
            response.writeHead(206, {
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes ${safeStart}-${safeEnd}/${fileSize}`,
                'Content-Length': safeEnd - safeStart + 1,
                'Content-Type': contentType
            });
            createReadStream(filePath, { start: safeStart, end: safeEnd }).pipe(response);
            return;
        }
    }

    response.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': fileSize,
        'Content-Type': contentType
    });
    createReadStream(filePath).pipe(response);
}

async function createStaticServer(root) {
    const server = createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
            let filePath = ensureWithinRoot(root, requestUrl.pathname);
            if (!filePath) {
                response.writeHead(403);
                response.end('Forbidden');
                return;
            }
            if (extname(filePath) === '') filePath = resolve(filePath, 'index.html');
            await access(filePath, fsConstants.R_OK);
            sendFile(request, response, filePath);
        } catch (error) {
            response.writeHead(404);
            response.end(error?.message || 'Not found');
        }
    });

    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    return {
        port: server.address().port,
        close() {
            return new Promise((resolvePromise, rejectPromise) => {
                server.close((error) => error ? rejectPromise(error) : resolvePromise());
            });
        }
    };
}

function findFfmpegBinary() {
    if (process.env.FFMPEG_PATH) {
        return process.env.FFMPEG_PATH;
    }

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            const candidates = [
                'Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
                'Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe',
                'Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe'
            ];
            for (const relativePath of candidates) {
                const base = resolve(localAppData, relativePath);
                if (!existsSync(base)) continue;
                for (const entry of readdirSync(base)) {
                    const candidate = resolve(base, entry, 'bin', 'ffmpeg.exe');
                    if (existsSync(candidate)) return candidate;
                }
            }
        }
    }

    return 'ffmpeg';
}

async function verifyFfmpeg(ffmpegPath) {
    await new Promise((resolvePromise, rejectPromise) => {
        const rejectStartError = (error) => {
            if (error?.code === 'ENOENT' || error?.code === 'EPERM') {
                rejectPromise(new Error(
                    `FFmpeg could not be started (${error.code}). Install/allow FFmpeg or set FFMPEG_PATH to ffmpeg.exe.`
                ));
                return;
            }
            rejectPromise(error);
        };

        let child;
        try {
            child = spawn(ffmpegPath, ['-version'], { stdio: 'ignore' });
        } catch (error) {
            rejectStartError(error);
            return;
        }
        child.on('error', rejectStartError);
        child.on('close', (code) => {
            if (code === 0) resolvePromise();
            else rejectPromise(new Error(`FFmpeg preflight failed with exit code ${code}.`));
        });
    });
}

function buildAudioFilter(tracks, startTime, endTime) {
    const trackFilters = tracks.map((track, index) => {
        const inputIndex = index + 1;
        return `[${inputIndex}:a:0]`
            + `atrim=start=${track.sourceStart.toFixed(9)}:end=${track.sourceEnd.toFixed(9)},`
            + 'asetpts=PTS-STARTPTS,'
            + 'aresample=48000,'
            + 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
            + `[album_audio_${index}]`;
    });
    const concatInputs = tracks.map((track, index) => `[album_audio_${index}]`).join('');
    return `${trackFilters.join(';')};`
        + `${concatInputs}concat=n=${tracks.length}:v=0:a=1[album_full];`
        + `[album_full]atrim=start=${startTime.toFixed(9)}:end=${endTime.toFixed(9)},`
        + 'asetpts=PTS-STARTPTS[aout]';
}

function spawnFfmpeg({ ffmpegPath, tracks, captureFps, startTime, endTime, duration, outputPath, quality }) {
    const args = [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-framerate', String(captureFps),
        '-i', 'pipe:0'
    ];

    tracks.forEach((track) => args.push('-i', resolve(albumRoot, track.audioPath)));
    args.push(
        '-filter_complex', buildAudioFilter(tracks, startTime, endTime),
        '-map', '0:v:0',
        '-map', '[aout]',
        '-c:v', 'libx264',
        '-preset', quality.encoderPreset,
        '-crf', String(quality.crf),
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-r', String(OUTPUT_FPS),
        '-fps_mode', 'cfr',
        '-c:a', 'aac',
        '-b:a', quality.audioBitrate,
        '-ar', '48000',
        '-movflags', '+faststart',
        '-t', duration.toFixed(9),
        '-s', `${quality.width}x${quality.height}`,
        outputPath
    );

    return spawn(ffmpegPath, args, { stdio: ['pipe', 'inherit', 'inherit'] });
}

function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remainder = Math.floor(safeSeconds % 60);
    if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

let progressLineLength = 0;
function renderProgress({ completedFrames, totalFrames, renderedTime, albumTime, duration, startedAt, trackTitle }) {
    const progress = clamp(completedFrames / Math.max(1, totalFrames), 0, 1);
    const width = 30;
    const filled = Math.round(progress * width);
    const elapsedWallSeconds = (Date.now() - startedAt) / 1000;
    const estimatedTotalWallSeconds = progress > 0 ? elapsedWallSeconds / progress : 0;
    const eta = Math.max(0, estimatedTotalWallSeconds - elapsedWallSeconds);
    const percent = String(Math.round(progress * 100)).padStart(3, ' ');
    const line = `Rendering [${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${percent}%`
        + `  ${formatDuration(renderedTime)} / ${formatDuration(duration)}`
        + `  album ${formatDuration(albumTime)}`
        + `  ETA ${formatDuration(eta)}`
        + `  ${trackTitle}`;
    const padding = ' '.repeat(Math.max(0, progressLineLength - line.length));
    progressLineLength = line.length;
    process.stdout.write(`\r${line}${padding}`);
}

function finishProgress() {
    if (!progressLineLength) return;
    process.stdout.write('\n');
    progressLineLength = 0;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getTrackAtTime(timeline, albumTime) {
    for (let index = timeline.tracks.length - 1; index >= 0; index -= 1) {
        const track = timeline.tracks[index];
        if (albumTime >= track.albumStart || index === 0) return track;
    }
    return timeline.tracks[0];
}

function validateAudioFiles(timeline) {
    timeline.tracks.forEach((track) => {
        const audioPath = resolve(albumRoot, track.audioPath);
        if (!existsSync(audioPath)) throw new Error(`Audio file not found: ${audioPath}`);
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    // Fail early on malformed album data while keeping the browser as the source of
    // truth for decoded duration and the exact gapless silence trims.
    JSON.parse(await readFile(albumPath, 'utf8'));

    const isFrameRender = Boolean(args.frame);
    const qualityId = String(args.quality || (isFrameRender ? 'max' : 'med')).toLowerCase();
    const quality = QUALITY_PRESETS[qualityId];
    if (!quality) {
        throw new Error(`Invalid --quality=${args.quality}. Use low, med, or max.`);
    }
    const captureFpsValue = Number.parseInt(args['capture-fps'], 10);
    const captureFps = Number.isFinite(captureFpsValue)
        ? clamp(captureFpsValue, 1, OUTPUT_FPS)
        : quality.captureFps;
    const explicitDuration = args.duration === undefined ? null : Number.parseFloat(args.duration);
    if (explicitDuration !== null && (!Number.isFinite(explicitDuration) || explicitDuration <= 0)) {
        throw new Error(`Invalid --duration value: ${args.duration}`);
    }
    if (args.end !== undefined && explicitDuration !== null) {
        throw new Error('Use either --end or --duration, not both.');
    }

    const ffmpegPath = (!isFrameRender && !args['dry-run']) ? findFfmpegBinary() : null;
    if (ffmpegPath) await verifyFfmpeg(ffmpegPath);

    const server = await createStaticServer(repoRoot);
    let browser = null;
    let ffmpegChild = null;

    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
        });
        const page = await browser.newPage({
            viewport: { width: quality.width, height: quality.height },
            deviceScaleFactor: 1
        });
        page.setDefaultTimeout(120_000);
        page.on('pageerror', (error) => console.error(`\n[page error] ${error.message}`));
        page.on('console', (message) => {
            if (message.type() === 'error' || message.type() === 'warning') {
                console.error(`\n[page ${message.type()}] ${message.text()}`);
            }
        });
        await page.exposeFunction('__albumVideoPreparationProgress', ({ current, total, title }) => {
            console.log(`Analyzing album audio ${current}/${total}: ${title}`);
        });

        const renderUrl = `http://127.0.0.1:${server.port}/3000/album-video-render.html`;
        console.log(`Opening album renderer: ${renderUrl}`);
        await page.goto(renderUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
            return window.__albumVideoRender?.isReady?.() === true
                || Boolean(window.__albumVideoRender?.getError?.());
        }, null, { timeout: 600_000 });
        const renderRouteError = await page.evaluate(() => window.__albumVideoRender?.getError?.() || '');
        if (renderRouteError) throw new Error(renderRouteError);
        await page.evaluate(async () => {
            await window.__albumVideoRender.whenReady();
            await document.fonts.ready;
        });

        const timeline = await page.evaluate(() => window.__albumVideoRender.getTimeline());
        if (!timeline?.tracks?.length || !Number.isFinite(timeline.duration) || timeline.duration <= 0) {
            throw new Error('The album render route returned an empty timeline.');
        }
        validateAudioFiles(timeline);
        console.log(`Gapless album timeline ready: ${timeline.tracks.length} songs, ${formatDuration(timeline.duration)}.`);

        let sectionStart = null;
        let sectionEnd = null;
        let renderDuration = null;
        if (!isFrameRender) {
            sectionStart = parseTimestamp(args.start) ?? 0;
            if (sectionStart >= timeline.duration) {
                throw new Error(`--start=${args.start} is beyond the album duration ${formatDuration(timeline.duration)}.`);
            }
            const requestedEnd = args.end !== undefined
                ? parseTimestamp(args.end)
                : (explicitDuration === null ? timeline.duration : sectionStart + explicitDuration);
            if (requestedEnd <= sectionStart) {
                throw new Error('The render end must be later than the render start.');
            }
            if (requestedEnd > timeline.duration) {
                throw new Error(`Render end ${formatDuration(requestedEnd)} is beyond the album duration ${formatDuration(timeline.duration)}.`);
            }
            sectionEnd = requestedEnd;
            renderDuration = sectionEnd - sectionStart;
        }

        if (args['dry-run']) {
            console.table(timeline.tracks.map((track) => ({
                song: track.displayNumber,
                title: track.title,
                start: formatDuration(track.albumStart),
                duration: track.duration.toFixed(3),
                trimStart: track.sourceStart.toFixed(3),
                trimEnd: Math.max(0, track.rawDuration - track.sourceEnd).toFixed(3)
            })));
            console.log(
                `Selected section: ${formatDuration(sectionStart)} → ${formatDuration(sectionEnd)}`
                + ` (${formatDuration(renderDuration)})`
            );
            return;
        }

        const canvasLocator = page.locator('#album-video-canvas');
        await canvasLocator.waitFor({ state: 'visible' });

        if (isFrameRender) {
            const explicitTime = parseTimestamp(args.time);
            const frameTime = explicitTime ?? await page.evaluate(() => window.__albumVideoRender.getDefaultPreviewTime());
            if (frameTime > timeline.duration) {
                throw new Error(`Frame time ${formatDuration(frameTime)} is beyond the album duration ${formatDuration(timeline.duration)}.`);
            }
            await page.evaluate(async (time) => {
                await window.__albumVideoRender.setTime(time, { sequentialVideo: false });
            }, frameTime);

            const frameArgument = typeof args.frame === 'string' ? args.frame : '';
            const defaultFrameOutput = resolve(albumRoot, 'renders', 'album-frame.png');
            const outputPath = ensureExtension(resolve(albumRoot, args.output || frameArgument || defaultFrameOutput), '.png');
            await mkdir(dirname(outputPath), { recursive: true });
            await canvasLocator.screenshot({ path: outputPath, type: 'png', omitBackground: false });
            const state = await page.evaluate(() => window.__albumVideoRender.getState());
            console.log(`Wrote frame at ${formatDuration(frameTime)} (${state.trackTitle}) to ${outputPath}`);
            return;
        }

        const totalFrames = Math.max(1, Math.ceil(renderDuration * captureFps));
        const outputPath = ensureExtension(
            resolve(albumRoot, args.output || 'renders/sioto-jazz-full-album.mp4'),
            '.mp4'
        );
        await mkdir(dirname(outputPath), { recursive: true });
        await rm(outputPath, { force: true });

        console.log([
            `Quality: ${qualityId} — ${quality.label}`,
            `Encoding ${quality.width}x${quality.height} MP4 at ${OUTPUT_FPS} fps`,
            `Capture: ${captureFps} fps, JPEG quality ${quality.jpegQuality}`,
            `Section: ${formatDuration(sectionStart)} → ${formatDuration(sectionEnd)}`,
            `Duration: ${formatDuration(renderDuration)} (${totalFrames.toLocaleString()} captured frames)`,
            `Audio: site-matched silence trims, gapless concat, AAC ${quality.audioBitrate}`,
            `Output: ${outputPath}`,
            `FFmpeg: ${ffmpegPath}`
        ].join('\n'));

        ffmpegChild = spawnFfmpeg({
            ffmpegPath,
            tracks: timeline.tracks,
            captureFps,
            startTime: sectionStart,
            endTime: sectionEnd,
            duration: renderDuration,
            outputPath,
            quality
        });

        const ffmpegExit = new Promise((resolvePromise, rejectPromise) => {
            ffmpegChild.on('error', (error) => {
                if (error?.code === 'ENOENT') {
                    rejectPromise(new Error('FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH to ffmpeg.exe.'));
                    return;
                }
                rejectPromise(error);
            });
            ffmpegChild.on('close', (code, signal) => {
                if (code === 0) resolvePromise();
                else rejectPromise(new Error(`FFmpeg exited with code ${code}, signal ${signal || 'none'}.`));
            });
        });

        const startedAt = Date.now();
        let lastProgressUpdate = 0;
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
            const renderedTime = Math.min(frameIndex / captureFps, renderDuration);
            const albumTime = Math.min(sectionStart + renderedTime, sectionEnd);
            await page.evaluate(async (time) => {
                await window.__albumVideoRender.setTime(time.value, { sequentialVideo: time.sequentialVideo });
            }, { value: albumTime, sequentialVideo: quality.sequentialVideo });
            const frame = await canvasLocator.screenshot({
                type: 'jpeg',
                quality: quality.jpegQuality,
                omitBackground: false
            });

            if (!ffmpegChild.stdin.write(frame)) {
                await new Promise((resolveDrain, rejectDrain) => {
                    ffmpegChild.stdin.once('drain', resolveDrain);
                    ffmpegChild.stdin.once('error', rejectDrain);
                });
            }

            const now = Date.now();
            if (now - lastProgressUpdate >= 200 || frameIndex === totalFrames - 1) {
                lastProgressUpdate = now;
                renderProgress({
                    completedFrames: frameIndex + 1,
                    totalFrames,
                    renderedTime,
                    albumTime,
                    duration: renderDuration,
                    startedAt,
                    trackTitle: getTrackAtTime(timeline, albumTime).title
                });
            }
        }

        finishProgress();
        ffmpegChild.stdin.end();
        console.log('All frames captured. Finalizing MP4 and fast-start metadata…');
        await ffmpegExit;
        console.log(`Wrote ${outputPath}`);
    } catch (error) {
        finishProgress();
        if (ffmpegChild && !ffmpegChild.killed) {
            try {
                ffmpegChild.kill('SIGKILL');
            } catch {
                // The encoder may already have exited.
            }
        }
        throw error;
    } finally {
        if (browser) await browser.close();
        await server.close();
    }
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
});
