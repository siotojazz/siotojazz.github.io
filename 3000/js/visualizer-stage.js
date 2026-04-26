import { createSilentFeatureSet, sampleTrackAudioFeatures } from './visualizer-audio-features.js';

export const FORMATS = {
    youtube: {
        id: 'youtube',
        label: 'YouTube 16:9',
        width: 1920,
        height: 1080,
        aspectRatio: '16 / 9'
    },
    instagram: {
        id: 'instagram',
        label: 'Instagram 9:16',
        width: 1080,
        height: 1920,
        aspectRatio: '9 / 16'
    }
};

const BACKDROP_COLORS = {
    base: '#05070a',
    shadow: '#020406',
    sand: '#d7c6a1',
    slate: '#7f95a7'
};

const MOSAIC_GRID = {
    columns: 5,
    rows: 4
};

const MOSAIC_BLUEPRINT = [
    { column: 0, row: 0, columnSpan: 1, rowSpan: 4, weight: 0.96 },
    { column: 1, row: 0, columnSpan: 2, rowSpan: 1, weight: 0.78 },
    { column: 3, row: 0, columnSpan: 2, rowSpan: 2, weight: 0.9 },
    { column: 1, row: 1, columnSpan: 2, rowSpan: 2, weight: 0.74 },
    { column: 3, row: 2, columnSpan: 1, rowSpan: 2, weight: 0.84 },
    { column: 4, row: 2, columnSpan: 1, rowSpan: 1, weight: 0.72 },
    { column: 1, row: 3, columnSpan: 2, rowSpan: 1, weight: 0.8 },
    { column: 4, row: 3, columnSpan: 1, rowSpan: 1, weight: 0.68 }
];

const VIDEO_LOOP_TRANSITION = {
    minSeconds: 0.35,
    maxSeconds: 0.85,
    ratio: 0.12
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function createElement(tagName, className) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    return element;
}

function parseHexColor(color, fallback = { r: 215, g: 198, b: 161 }) {
    const safeColor = String(color || '').replace('#', '').trim();
    const normalized = safeColor.length === 3
        ? safeColor.split('').map((part) => `${part}${part}`).join('')
        : safeColor.padEnd(6, '0').slice(0, 6);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);

    return {
        r: Number.isFinite(red) ? red : fallback.r,
        g: Number.isFinite(green) ? green : fallback.g,
        b: Number.isFinite(blue) ? blue : fallback.b
    };
}

function rgba(color, alpha = 1) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function fitFontSize(context, text, preferredSize, minSize, maxWidth, family) {
    let size = preferredSize;

    while (size > minSize) {
        context.font = `${size}px ${family}`;
        if (context.measureText(text).width <= maxWidth) {
            return size;
        }
        size -= 2;
    }

    return minSize;
}

function buildNoiseTile(seed = 1) {
    const tile = document.createElement('canvas');
    const size = 160;
    tile.width = size;
    tile.height = size;
    const context = tile.getContext('2d');
    const imageData = context.createImageData(size, size);
    let state = seed || 1;

    for (let index = 0; index < imageData.data.length; index += 4) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const value = state & 0xff;
        imageData.data[index] = value;
        imageData.data[index + 1] = value;
        imageData.data[index + 2] = value;
        imageData.data[index + 3] = 16;
    }

    context.putImageData(imageData, 0, 0);
    return tile;
}

function waitForEvent(target, eventName, rejectName) {
    return new Promise((resolve, reject) => {
        const handleResolve = () => {
            cleanup();
            resolve();
        };
        const handleReject = () => {
            cleanup();
            reject(new Error(`Media event failed: ${rejectName || eventName}`));
        };
        const cleanup = () => {
            target.removeEventListener(eventName, handleResolve);
            if (rejectName) {
                target.removeEventListener(rejectName, handleReject);
            }
        };

        target.addEventListener(eventName, handleResolve, { once: true });
        if (rejectName) {
            target.addEventListener(rejectName, handleReject, { once: true });
        }
    });
}

function findSectionForTime(sections, currentTime) {
    for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        if (currentTime >= section.startTime && currentTime < section.endTime) {
            return section;
        }
    }

    return sections[sections.length - 1] || null;
}

function getLyricState(track, time) {
    if (!track) {
        return { mode: 'empty', current: null, previous: null, next: null };
    }

    if (track.lyricsMode !== 'synced') {
        return {
            mode: track.lyricsMode,
            current: null,
            previous: null,
            next: null
        };
    }

    const lines = track.lyrics || [];
    if (!lines.length) {
        return { mode: 'empty', current: null, previous: null, next: null };
    }

    const index = lines.findIndex((line) => time >= line.startTime && time <= line.endTime);
    const nextIndex = lines.findIndex((line) => time < line.startTime);
    const previousIndex = nextIndex === -1
        ? lines.length - 1
        : Math.max(-1, nextIndex - 1);

    return {
        mode: 'synced',
        current: index >= 0 ? lines[index] : null,
        previous: previousIndex >= 0 ? lines[previousIndex] : null,
        next: nextIndex >= 0 ? lines[nextIndex] : null
    };
}

function getLyricTransitionState(line, time, track) {
    if (!line) {
        return {
            alpha: 0,
            blur: 0,
            translateY: 0,
            scale: 1
        };
    }

    const beatDuration = track?.timing?.beatDuration || 0.45;
    const lineDuration = Math.max(line.endTime - line.startTime, beatDuration);
    const enterDuration = Math.min(Math.max(beatDuration * 0.7, 0.14), 0.26);
    const exitDuration = Math.min(Math.max(beatDuration * 0.85, 0.18), 0.32);
    const enterProgress = clamp((time - line.startTime) / enterDuration, 0, 1);
    const exitProgress = clamp((line.endTime - time) / exitDuration, 0, 1);
    const visibility = Math.min(enterProgress, exitProgress);
    const holdProgress = clamp((time - line.startTime) / lineDuration, 0, 1);

    return {
        alpha: 0.18 + (visibility * 0.78),
        blur: (1 - visibility),
        translateY: 1 - visibility,
        scale: 0.992 + (holdProgress * 0.03)
    };
}

function drawLyricGapNote(context, centerX, centerY, size) {
    const headRadiusX = size * 0.17;
    const headRadiusY = size * 0.13;
    const stemHeight = size * 0.68;
    const stemOffsetX = size * 0.12;
    const stemTopY = centerY - (stemHeight * 0.62);
    const noteHeadX = centerX - (size * 0.1);
    const noteHeadY = centerY + (size * 0.08);

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, size * 0.065);
    context.strokeStyle = 'rgba(28, 28, 28, 0.62)';
    context.fillStyle = 'rgba(28, 28, 28, 0.62)';

    context.beginPath();
    context.ellipse(noteHeadX, noteHeadY, headRadiusX, headRadiusY, -0.45, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.moveTo(noteHeadX + stemOffsetX, noteHeadY - (headRadiusY * 0.65));
    context.lineTo(noteHeadX + stemOffsetX, stemTopY);
    context.stroke();

    context.beginPath();
    context.moveTo(noteHeadX + stemOffsetX, stemTopY);
    context.quadraticCurveTo(
        noteHeadX + (size * 0.36),
        stemTopY + (size * 0.05),
        noteHeadX + (size * 0.22),
        stemTopY + (size * 0.24)
    );
    context.stroke();
    context.restore();
}

function drawVideoCover(context, video, destination, options = {}) {
    if (!video || !video.videoWidth || !video.videoHeight) {
        return;
    }

    const { panX = 0, panY = 0, scale = 1 } = options;
    const sourceAspect = video.videoWidth / video.videoHeight;
    const destinationAspect = destination.width / destination.height;

    let sourceWidth = video.videoWidth;
    let sourceHeight = video.videoHeight;

    if (sourceAspect > destinationAspect) {
        sourceHeight = video.videoHeight;
        sourceWidth = sourceHeight * destinationAspect;
    } else {
        sourceWidth = video.videoWidth;
        sourceHeight = sourceWidth / destinationAspect;
    }

    sourceWidth /= scale;
    sourceHeight /= scale;

    const maxSourceX = Math.max(0, video.videoWidth - sourceWidth);
    const maxSourceY = Math.max(0, video.videoHeight - sourceHeight);
    const sourceX = clamp((maxSourceX * 0.5) + (panX * maxSourceX * 0.4), 0, maxSourceX);
    const sourceY = clamp((maxSourceY * 0.5) + (panY * maxSourceY * 0.4), 0, maxSourceY);

    context.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destination.x,
        destination.y,
        destination.width,
        destination.height
    );
}

function getLoopTransitionDuration(duration) {
    if (!Number.isFinite(duration) || duration <= 0) {
        return 0;
    }

    return Math.min(
        Math.max(duration * VIDEO_LOOP_TRANSITION.ratio, VIDEO_LOOP_TRANSITION.minSeconds),
        VIDEO_LOOP_TRANSITION.maxSeconds,
        duration * 0.45
    );
}

function buildMosaicTiles(bounds) {
    const gap = Math.max(27, Math.round(Math.min(bounds.width / MOSAIC_GRID.columns, bounds.height / MOSAIC_GRID.rows) * 0.24));
    const cellWidth = (bounds.width - (gap * (MOSAIC_GRID.columns - 1))) / MOSAIC_GRID.columns;
    const cellHeight = (bounds.height - (gap * (MOSAIC_GRID.rows - 1))) / MOSAIC_GRID.rows;

    return MOSAIC_BLUEPRINT.map((tile, index) => {
        const x = bounds.x + (tile.column * (cellWidth + gap));
        const y = bounds.y + (tile.row * (cellHeight + gap));
        const width = Math.max(18, (tile.columnSpan * cellWidth) + ((tile.columnSpan - 1) * gap));
        const height = Math.max(18, (tile.rowSpan * cellHeight) + ((tile.rowSpan - 1) * gap));

        return {
            index,
            x,
            y,
            width,
            height,
            weight: tile.weight
        };
    });
}

function buildMaskPath(tiles) {
    const path = new Path2D();
    tiles.forEach((tile) => {
        path.rect(tile.x, tile.y, tile.width, tile.height);
    });
    return path;
}

function buildWrappedLines(context, text, maxWidth, maxLines = 2) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
        return [];
    }

    const lines = [];
    let currentLine = words[0];

    for (let index = 1; index < words.length; index += 1) {
        const candidate = `${currentLine} ${words[index]}`;
        if (context.measureText(candidate).width <= maxWidth) {
            currentLine = candidate;
            continue;
        }

        lines.push(currentLine);
        currentLine = words[index];

        if (lines.length === maxLines - 1) {
            const remainder = [currentLine, ...words.slice(index + 1)].join(' ');
            let clipped = remainder;
            while (clipped.length > 1 && context.measureText(`${clipped}…`).width > maxWidth) {
                clipped = clipped.slice(0, -1).trimEnd();
            }
            lines.push(clipped !== remainder ? `${clipped}…` : clipped);
            return lines;
        }
    }

    lines.push(currentLine);
    return lines.slice(0, maxLines);
}

function drawHeaderSeparator(context, centerX, centerY, size) {
    context.save();
    context.translate(centerX, centerY);
    context.lineCap = 'round';
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(74, 74, 74, 0.26)';

    context.beginPath();
    context.moveTo(-size, 0);
    context.lineTo(size, 0);
    context.moveTo(0, -size);
    context.lineTo(0, size);
    context.stroke();

    context.rotate(Math.PI / 4);
    context.fillStyle = 'rgba(126, 126, 126, 0.12)';
    context.fillRect(-(size * 0.34), -(size * 0.34), size * 0.68, size * 0.68);
    context.restore();
}

export function getFormatById(formatId) {
    return FORMATS[formatId] || FORMATS.youtube;
}

export function createVisualizerStage(container, { format = 'youtube', mode = 'render' } = {}) {
    const host = container;
    const stage = createElement('div', 'visualizer-canvas-stage');
    const canvas = createElement('canvas', 'visualizer-canvas-stage__canvas');
    const video = createElement('video', 'visualizer-canvas-stage__video');
    const loopVideo = createElement('video', 'visualizer-canvas-stage__video');
    const context = canvas.getContext('2d', { alpha: false });

    stage.style.position = 'relative';
    stage.style.width = '100%';
    stage.style.height = '100%';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';

    video.preload = 'auto';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.style.display = 'none';

    loopVideo.preload = 'auto';
    loopVideo.muted = true;
    loopVideo.loop = false;
    loopVideo.playsInline = true;
    loopVideo.crossOrigin = 'anonymous';
    loopVideo.style.display = 'none';

    stage.append(canvas, video, loopVideo);
    host.replaceChildren(stage);

    let currentFormat = getFormatById(format);
    let currentTrack = null;
    let currentDuration = 0;
    let currentAudioFeatures = createSilentFeatureSet();
    let lastRenderedTime = 0;
    let lastRenderedDuration = 0;
    let mediaLoadToken = 0;
    let videoReady = false;
    let loopVideoReady = false;
    let mediaReadyResolver = null;
    let mediaReadyPromise = Promise.resolve();
    let noiseTile = buildNoiseTile(1);
    let noisePattern = null;
    let videoPlayPromise = null;
    let loopVideoPlayPromise = null;

    function updateCanvasSize() {
        if (mode === 'render') {
            if (canvas.width !== currentFormat.width || canvas.height !== currentFormat.height) {
                canvas.width = currentFormat.width;
                canvas.height = currentFormat.height;
                rebuildNoisePattern();
            }
            return;
        }

        const bounds = host.getBoundingClientRect();
        const deviceScale = Math.min(window.devicePixelRatio || 1, 1.25);
        const targetWidth = Math.max(640, Math.min(currentFormat.width, Math.round((bounds.width || currentFormat.width) * deviceScale)));
        const targetHeight = Math.max(360, Math.round(targetWidth * (currentFormat.height / currentFormat.width)));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            rebuildNoisePattern();
        }
    }

    function rebuildNoisePattern() {
        noisePattern = context.createPattern(noiseTile, 'repeat');
    }

    function resetMediaReady() {
        mediaReadyPromise = new Promise((resolve) => {
            mediaReadyResolver = resolve;
        });
    }

    function resolveMediaReady() {
        if (mediaReadyResolver) {
            mediaReadyResolver();
            mediaReadyResolver = null;
        }
    }

    function applyFormat(nextFormatId) {
        currentFormat = getFormatById(nextFormatId);
        host.style.aspectRatio = currentFormat.aspectRatio;
        host.dataset.format = currentFormat.id;
        stage.dataset.format = currentFormat.id;
        updateCanvasSize();
        drawFrame(lastRenderedTime, { duration: lastRenderedDuration || currentDuration });
        return currentFormat;
    }

    function requestVideoPlayback() {
        if (!videoReady || !video.paused || videoPlayPromise) {
            return;
        }

        const playPromise = video.play();
        if (!playPromise?.then) {
            return;
        }

        videoPlayPromise = playPromise.catch(() => {
            return null;
        }).finally(() => {
            videoPlayPromise = null;
        });
    }

    function requestLoopVideoPlayback() {
        if (!loopVideoReady || !loopVideo.paused || loopVideoPlayPromise) {
            return;
        }

        const playPromise = loopVideo.play();
        if (!playPromise?.then) {
            return;
        }

        loopVideoPlayPromise = playPromise.catch(() => {
            return null;
        }).finally(() => {
            loopVideoPlayPromise = null;
        });
    }

    function pauseVideoPlayback() {
        if (!video.paused) {
            video.pause();
        }
    }

    function pauseLoopVideoPlayback() {
        if (!loopVideo.paused) {
            loopVideo.pause();
        }
    }

    function setMediaTime(media, time) {
        try {
            media.currentTime = time;
            return true;
        } catch {
            return false;
        }
    }

    async function loadTrackMedia(track) {
        const token = ++mediaLoadToken;
        videoReady = false;
        loopVideoReady = false;
        resetMediaReady();
        noiseTile = buildNoiseTile((track?.video?.seed || track?.id || 1) >>> 0);
        rebuildNoisePattern();

        if (!track?.video?.path) {
            resolveMediaReady();
            drawFrame(lastRenderedTime, { duration: currentDuration });
            return;
        }

        pauseVideoPlayback();
        pauseLoopVideoPlayback();
        video.removeAttribute('src');
        video.load();
        loopVideo.removeAttribute('src');
        loopVideo.load();
        video.src = track.video.path;
        loopVideo.src = track.video.path;

        try {
            await Promise.all([
                waitForEvent(video, 'loadeddata', 'error'),
                waitForEvent(loopVideo, 'loadeddata', 'error'),
                document.fonts?.ready || Promise.resolve()
            ]);

            if (token !== mediaLoadToken) {
                return;
            }

            setMediaTime(video, 0);
            setMediaTime(loopVideo, 0);
            videoReady = true;
            loopVideoReady = true;
            resolveMediaReady();
            drawFrame(lastRenderedTime, { duration: currentDuration });
        } catch {
            if (token !== mediaLoadToken) {
                return;
            }

            videoReady = false;
            loopVideoReady = false;
            resolveMediaReady();
            drawFrame(lastRenderedTime, { duration: currentDuration });
        }
    }

    function getTimelineDuration() {
        if (!currentTrack) {
            return 0;
        }

        return Math.max(currentTrack.duration || 0, currentDuration || 0);
    }

    function getLoopedVideoTime(time) {
        if (!videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
            return 0;
        }

        return ((time % video.duration) + video.duration) % video.duration;
    }

    function getLoopTransitionState(time) {
        if (!videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
            return null;
        }

        const loopedTime = getLoopedVideoTime(time);
        const transitionDuration = getLoopTransitionDuration(video.duration);
        if (transitionDuration <= 0) {
            return null;
        }

        const transitionStart = video.duration - transitionDuration;
        if (loopedTime < transitionStart) {
            return null;
        }

        return {
            blend: clamp((loopedTime - transitionStart) / transitionDuration, 0, 1),
            seamTime: clamp(loopedTime - transitionStart, 0, transitionDuration)
        };
    }

    function syncPreviewVideo(time, isPlaying) {
        if (!videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
            return;
        }

        const targetTime = getLoopedVideoTime(time);
        const drift = Math.abs((video.currentTime || 0) - targetTime);
        const loopTransitionState = getLoopTransitionState(time);

        if (isPlaying) {
            if (drift > 0.45) {
                if (!setMediaTime(video, targetTime)) {
                    return;
                }
            }
            requestVideoPlayback();

            if (loopTransitionState && loopVideoReady) {
                const loopDrift = Math.abs((loopVideo.currentTime || 0) - loopTransitionState.seamTime);
                if (loopDrift > 0.18) {
                    setMediaTime(loopVideo, loopTransitionState.seamTime);
                }
                requestLoopVideoPlayback();
            } else {
                pauseLoopVideoPlayback();
                if (loopVideoReady && Math.abs(loopVideo.currentTime || 0) > (1 / 60)) {
                    setMediaTime(loopVideo, 0);
                }
            }
            return;
        }

        pauseVideoPlayback();
        if (drift > (1 / 60)) {
            if (!setMediaTime(video, targetTime)) {
                return;
            }
        }

        pauseLoopVideoPlayback();
        if (!loopVideoReady) {
            return;
        }

        const loopTargetTime = loopTransitionState ? loopTransitionState.seamTime : 0;
        const loopDrift = Math.abs((loopVideo.currentTime || 0) - loopTargetTime);
        if (loopDrift > (1 / 60)) {
            setMediaTime(loopVideo, loopTargetTime);
        }
    }

    async function seekMediaToTime(media, targetTime, tolerance = (1 / 120)) {
        const drift = Math.abs((media.currentTime || 0) - targetTime);
        if (drift <= tolerance) {
            return;
        }

        await new Promise((resolve) => {
            const handleSeeked = () => {
                cleanup();
                resolve();
            };
            const handleError = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                media.removeEventListener('seeked', handleSeeked);
                media.removeEventListener('error', handleError);
            };

            media.addEventListener('seeked', handleSeeked, { once: true });
            media.addEventListener('error', handleError, { once: true });

            if (!setMediaTime(media, targetTime)) {
                cleanup();
                resolve();
            }
        });
    }

    async function syncVideoToTime(time, strict = false, isPlaying = false) {
        if (!videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
            return;
        }

        if (!strict) {
            syncPreviewVideo(time, isPlaying);
            return;
        }

        pauseVideoPlayback();
        pauseLoopVideoPlayback();
        const targetTime = getLoopedVideoTime(time);
        const loopTransitionState = getLoopTransitionState(time);

        await seekMediaToTime(video, targetTime);

        if (loopVideoReady) {
            await seekMediaToTime(loopVideo, loopTransitionState ? loopTransitionState.seamTime : 0, loopTransitionState ? (1 / 120) : (1 / 60));
        }
    }

    function drawBackdrop(sectionColor, energy, time) {
        const width = canvas.width;
        const height = canvas.height;
        const accent = parseHexColor(sectionColor, parseHexColor(BACKDROP_COLORS.sand));
        context.fillStyle = 'rgb(248, 246, 241)';
        context.fillRect(0, 0, width, height);

        const glowX = width * (0.22 + (Math.sin((time * 0.06) + 0.4) * 0.05));
        const glowY = height * (0.18 + (Math.cos((time * 0.08) + 0.7) * 0.04));
        const glow = context.createRadialGradient(glowX, glowY, width * 0.04, glowX, glowY, width * 0.42);
        glow.addColorStop(0, rgba(accent, 0.055 + (energy * 0.02)));
        glow.addColorStop(0.55, 'rgba(44, 67, 88, 0.02)');
        glow.addColorStop(1, 'rgba(248, 246, 241, 0)');
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
    }

    function drawMaskedComposition(track, section, featureSample, time) {
        const width = canvas.width;
        const height = canvas.height;
        const accent = parseHexColor(section?.color, parseHexColor(BACKDROP_COLORS.sand));
        const cool = parseHexColor(BACKDROP_COLORS.slate);
        const mosaicWidth = width * 0.69;
        const mosaicHeight = height * 0.47;
        const bounds = {
            x: (width - mosaicWidth) * 0.5,
            y: (height - mosaicHeight) * 0.5,
            width: mosaicWidth,
            height: mosaicHeight
        };
        const tiles = buildMosaicTiles(bounds);
        const maskPath = buildMaskPath(tiles);
        const videoMotion = {
            panX: Math.sin((time * 0.04) + (track.id * 0.5)) * 0.14,
            panY: Math.cos((time * 0.03) + (track.id * 0.35)) * 0.12,
            scale: 1.025 + (featureSample.smoothed * 0.025)
        };
        const loopTransitionState = getLoopTransitionState(time);

        context.save();
        context.clip(maskPath);

        if (videoReady && video.videoWidth && video.videoHeight) {
            if (loopTransitionState && loopVideoReady && loopVideo.videoWidth && loopVideo.videoHeight) {
                context.save();
                context.globalAlpha = 1 - loopTransitionState.blend;
                drawVideoCover(context, video, bounds, videoMotion);
                context.restore();

                context.save();
                context.globalAlpha = loopTransitionState.blend;
                drawVideoCover(context, loopVideo, bounds, videoMotion);
                context.restore();
            } else {
                drawVideoCover(context, video, bounds, videoMotion);
            }
        } else {
            const fallbackFill = context.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
            fallbackFill.addColorStop(0, rgba(accent, 0.34));
            fallbackFill.addColorStop(1, rgba(cool, 0.2));
            context.fillStyle = fallbackFill;
            context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        }
        context.restore();

        return bounds;
    }

    function drawText(track, bounds, section) {
        const height = canvas.height;
        const band = String(track.bandName || 'Sioto Jazz').toUpperCase();
        const title = String(track.title || '');
        const bandReferenceText = 'SIOTO';
        const titleReferenceText = 'Ag';
        let bandSize = Math.round(height * 0.108);
        let titleSize = Math.round(height * 0.081);
        const minBandSize = 48;
        const minTitleSize = 33;
        const separatorSize = Math.max(7, Math.round(height * 0.009));
        const separatorPadding = Math.round(height * 0.018);
        const gap = (separatorPadding * 2) + (separatorSize * 2.2);

        while (bandSize > minBandSize || titleSize > minTitleSize) {
            context.font = `${bandSize}px "Astrella", "Garet", sans-serif`;
            const bandWidth = context.measureText(band).width;
            context.font = `600 ${titleSize}px "Garet", sans-serif`;
            const titleWidth = context.measureText(title).width;
            if ((bandWidth + gap + titleWidth) <= (bounds.width * 0.9)) {
                break;
            }
            if (bandSize > minBandSize) {
                bandSize -= 1;
            }
            if (titleSize > minTitleSize) {
                titleSize -= 1;
            }
        }

        context.font = `${bandSize}px "Astrella", "Garet", sans-serif`;
        const bandWidth = context.measureText(band).width;
        const bandReferenceMetrics = context.measureText(bandReferenceText);

        context.font = `600 ${titleSize}px "Garet", sans-serif`;
        const titleWidth = context.measureText(title).width;
        const titleReferenceMetrics = context.measureText(titleReferenceText);
        const totalWidth = bandWidth + gap + titleWidth;
        const startX = (canvas.width - totalWidth) * 0.5;
        const rowCenterY = bounds.y * 0.5;
        const bandAscent = bandReferenceMetrics.actualBoundingBoxAscent || (bandSize * 0.72);
        const bandDescent = bandReferenceMetrics.actualBoundingBoxDescent || (bandSize * 0.28);
        const titleAscent = titleReferenceMetrics.actualBoundingBoxAscent || (titleSize * 0.72);
        const titleDescent = titleReferenceMetrics.actualBoundingBoxDescent || (titleSize * 0.28);
        const titleOpticalOffset = Math.round(titleSize * 0.04) + Math.max(2, Math.round(height * 0.0037));
        const bandBaselineY = rowCenterY + ((bandAscent - bandDescent) * 0.5);
        const titleBaselineY = rowCenterY + ((titleAscent - titleDescent) * 0.5) + titleOpticalOffset;
        const separatorCenterX = startX + bandWidth + separatorPadding + separatorSize;

        context.save();
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        context.fillStyle = 'rgba(20, 20, 20, 0.96)';
        context.font = `${bandSize}px "Astrella", "Garet", sans-serif`;
        context.fillText(band, startX, bandBaselineY, bandWidth + 4);
        drawHeaderSeparator(context, separatorCenterX, rowCenterY, separatorSize);
        context.font = `600 ${titleSize}px "Garet", sans-serif`;
        context.fillStyle = 'rgba(28, 28, 28, 0.9)';
        context.fillText(title, startX + bandWidth + gap, titleBaselineY, titleWidth + 4);
        context.restore();
    }

    function drawTextBlock(lines, x, startY, lineHeight, maxWidth) {
        lines.forEach((line, index) => {
            context.fillText(line, x, startY + (index * lineHeight), maxWidth);
        });
    }

    function drawLyrics(track, time, bounds, section) {
        const height = canvas.height;
        const lyricState = getLyricState(track, time);
        const lyricCenterX = canvas.width * 0.5;
        const lyricWidth = bounds.width * 0.72;
        const lyricZoneTop = bounds.y + bounds.height;
        const lyricZoneHeight = Math.max(0, height - lyricZoneTop);

        context.save();
        context.textAlign = 'center';

        if (lyricState.mode !== 'synced') {
            const fallbackLabel = lyricState.mode === 'fallback'
                ? 'Lyrics timing unavailable for this track'
                : 'No lyric data for this track';
            const fallbackSize = Math.round(height * 0.022);
            const fallbackLineHeight = Math.round(fallbackSize * 1.2);
            const fallbackTop = lyricZoneTop + Math.max(0, (lyricZoneHeight - fallbackLineHeight) * 0.5);
            context.font = `${fallbackSize}px "Garet", sans-serif`;
            context.textBaseline = 'top';
            context.fillStyle = 'rgba(28, 28, 28, 0.72)';
            context.fillText(fallbackLabel, lyricCenterX, fallbackTop, lyricWidth);
            context.restore();
            return;
        }

        const currentText = lyricState.current?.line || '';
        if (!currentText) {
            if (lyricState.next) {
                const noteSize = Math.max(18, Math.round(height * 0.032));
                const noteCenterY = lyricZoneTop + (lyricZoneHeight * 0.5);
                drawLyricGapNote(context, lyricCenterX, noteCenterY, noteSize);
            } else {
                const noteSize = Math.round(height * 0.022);
                const noteLineHeight = Math.round(noteSize * 1.2);
                const noteTop = lyricZoneTop + Math.max(0, (lyricZoneHeight - noteLineHeight) * 0.5);
                context.font = `${noteSize}px "Garet", sans-serif`;
                context.textBaseline = 'top';
                context.fillStyle = 'rgba(28, 28, 28, 0.62)';
                context.fillText('Instrumental passage', lyricCenterX, noteTop, lyricWidth);
            }
            context.restore();
            return;
        }

        const currentFontSize = fitFontSize(context, currentText, Math.round(height * 0.036), 18, lyricWidth, '"Garet", sans-serif');
        const currentLineHeight = Math.round(currentFontSize * 1.12);
        const transition = getLyricTransitionState(lyricState.current, time, track);
        const maxBlur = Math.max(3, Math.round(height * 0.0055));
        const maxLift = Math.max(5, Math.round(height * 0.008));

        context.font = `600 ${currentFontSize}px "Garet", sans-serif`;
        context.fillStyle = 'rgba(18, 18, 18, 0.96)';
        const currentLines = buildWrappedLines(context, currentText, lyricWidth, 2);
        const lyricMetrics = context.measureText(currentLines[0] || currentText);
        const lyricAscent = lyricMetrics.actualBoundingBoxAscent || (currentFontSize * 0.72);
        const lyricDescent = lyricMetrics.actualBoundingBoxDescent || (currentFontSize * 0.28);
        const lyricVisibleHeight = lyricAscent + lyricDescent + ((currentLines.length - 1) * currentLineHeight);
        const firstBaselineY = lyricZoneTop + ((lyricZoneHeight - lyricVisibleHeight) * 0.5) + lyricAscent + (transition.translateY * maxLift);
        const blockTopY = firstBaselineY - lyricAscent;
        const blockCenterY = blockTopY + (lyricVisibleHeight * 0.5);
        context.textBaseline = 'alphabetic';
        context.globalAlpha = transition.alpha;
        if (transition.blur > 0.001) {
            context.filter = `blur(${(transition.blur * maxBlur).toFixed(2)}px)`;
        }
        context.translate(lyricCenterX, blockCenterY);
        context.scale(transition.scale, transition.scale);
        drawTextBlock(currentLines, 0, firstBaselineY - blockCenterY, currentLineHeight, lyricWidth);

        context.restore();
    }

    function drawGrain() {
        if (!noisePattern) {
            return;
        }

        context.save();
        context.globalAlpha = 0.025;
        context.fillStyle = noisePattern;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
    }

    function drawFrame(currentTime, { duration } = {}) {
        if (!currentTrack) {
            context.fillStyle = BACKDROP_COLORS.base;
            context.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }

        if (Number.isFinite(duration)) {
            currentDuration = Math.max(currentTrack.duration || 0, duration);
        }

        const timelineDuration = Math.max(getTimelineDuration(), 0.001);
        const safeTime = clamp(currentTime, 0, timelineDuration);
        const section = findSectionForTime(currentTrack.sections, safeTime);
        const featureSample = sampleTrackAudioFeatures(currentAudioFeatures, safeTime);

        lastRenderedTime = safeTime;
        lastRenderedDuration = timelineDuration;

        drawBackdrop(section?.color, featureSample.smoothed, safeTime);
        const bounds = drawMaskedComposition(currentTrack, section, featureSample, safeTime);
        drawText(currentTrack, bounds, section);
        drawLyrics(currentTrack, safeTime, bounds, section);
        drawGrain();
    }

    function setTrack(track) {
        currentTrack = track;
        currentDuration = track?.duration || 0;
        currentAudioFeatures = createSilentFeatureSet(currentDuration);
        void loadTrackMedia(track);
        drawFrame(0, { duration: currentDuration });
    }

    function setDuration(duration) {
        currentDuration = Math.max(currentTrack?.duration || 0, Number(duration) || 0);
        drawFrame(lastRenderedTime, { duration: currentDuration });
    }

    function setAudioFeatures(featureSet) {
        currentAudioFeatures = featureSet || createSilentFeatureSet(currentTrack?.duration || 0);
        drawFrame(lastRenderedTime, { duration: currentDuration });
    }

    async function renderTime(time, { duration, waitForVideo = false, isPlaying = false } = {}) {
        if (Number.isFinite(duration)) {
            currentDuration = Math.max(currentTrack?.duration || 0, duration);
        }

        if (waitForVideo) {
            await mediaReadyPromise;
            await syncVideoToTime(time, true, false);
        } else if (videoReady) {
            syncPreviewVideo(time, isPlaying);
        }

        drawFrame(time, { duration: currentDuration });
    }

    if (mode === 'preview' && window.ResizeObserver) {
        const resizeObserver = new window.ResizeObserver(() => {
            updateCanvasSize();
            drawFrame(lastRenderedTime, { duration: lastRenderedDuration || currentDuration });
        });
        resizeObserver.observe(host);
    }

    applyFormat(currentFormat.id);

    return {
        getDuration() {
            return getTimelineDuration();
        },
        getFormat() {
            return currentFormat;
        },
        isReady() {
            return videoReady || !currentTrack?.video?.path;
        },
        setAudioFeatures,
        setDuration,
        setFormat(formatId) {
            return applyFormat(formatId);
        },
        setTime(time, options = {}) {
            return renderTime(time, options);
        },
        setTrack,
        whenReady() {
            return mediaReadyPromise;
        }
    };
}