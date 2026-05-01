import { createSilentFeatureSet, sampleTrackAudioFeatures } from './visualizer-audio-features.js';

export const FORMATS = {
    youtube: {
        id: 'youtube',
        label: 'YouTube 16:9',
        width: 1920,
        height: 1080,
        aspectRatio: '16 / 9',
        mosaic: { widthRatio: 0.69, heightRatio: 0.47 },
        // Title row centered above mosaic, lyrics centered below.
        titleZone: { topRatio: 0, heightRatio: null },
        lyricZone: { topRatio: null, heightRatio: null },
        safeMargin: { top: 0, bottom: 0, left: 0, right: 0 }
    },
    instagram: {
        id: 'instagram',
        label: 'Instagram 9:16',
        width: 1080,
        height: 1920,
        aspectRatio: '9 / 16',
        mosaic: { widthRatio: 0.58, heightRatio: 0.58 },
        mosaicGapRatio: 0.13,
        mosaicMinGap: 14,
        contentGapRatio: 0.028,
        flipMosaic: true,
        plainBackdrop: true,
        titleZone: { topRatio: 0, heightRatio: null },
        lyricZone: { topRatio: null, heightRatio: null },
        safeMargin: { top: 220, bottom: 260, left: 64, right: 64 }
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

function getMosaicDefinition(format) {
    if (!format?.flipMosaic) {
        return {
            grid: MOSAIC_GRID,
            blueprint: MOSAIC_BLUEPRINT
        };
    }

    return {
        grid: {
            columns: MOSAIC_GRID.rows,
            rows: MOSAIC_GRID.columns
        },
        blueprint: MOSAIC_BLUEPRINT.map((tile) => ({
            column: tile.row,
            row: tile.column,
            columnSpan: tile.rowSpan,
            rowSpan: tile.columnSpan,
            weight: tile.weight
        }))
    };
}

const VIDEO_LOOP_TRANSITION = {
    minSeconds: 0.65,
    maxSeconds: 1.35,
    ratio: 0.16
};

const MOSAIC_OVERLAY_BLEED = 1.5;
const MOSAIC_CLIP_BLEED = 0.9;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toFiniteNonNegative(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
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
        scale: 0.968 + (holdProgress * 0.12)
    };
}

function getVisualCrossfade(progress) {
    const clampedProgress = clamp(progress, 0, 1);
    const easedProgress = clampedProgress * clampedProgress * (3 - (2 * clampedProgress));
    return {
        outgoingOpacity: 1 - easedProgress,
        incomingOpacity: easedProgress
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

function applyVideoTransform(videoElement, options = {}) {
    const { panX = 0, panY = 0, scale = 1, opacity = 1 } = options;
    // panX/panY in [-1,1]; map to object-position percentage (50% +/- 40% of overflow).
    const xPercent = clamp(50 + (panX * 40), 0, 100);
    const yPercent = clamp(50 + (panY * 40), 0, 100);
    videoElement.style.objectPosition = `${xPercent.toFixed(3)}% ${yPercent.toFixed(3)}%`;
    videoElement.style.transform = `scale(${scale.toFixed(4)})`;
    if (videoElement.style.opacity !== String(opacity)) {
        videoElement.style.opacity = String(opacity);
    }
}

// Replicates the CSS `object-fit: cover` + `object-position` + `transform: scale()`
// behaviour that the on-screen video element uses, drawing the current frame
// into `context` covering `bounds`. This keeps the captured render visually
// identical to the live preview.
function drawCoveringVideoFrame(context, videoElement, bounds, options = {}, opacity = 1) {
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;
    if (!videoWidth || !videoHeight) {
        return;
    }
    const { panX = 0, panY = 0, scale = 1 } = options;
    const xPercent = clamp(50 + (panX * 40), 0, 100) / 100;
    const yPercent = clamp(50 + (panY * 40), 0, 100) / 100;
    const boxAspect = bounds.width / bounds.height;
    const videoAspect = videoWidth / videoHeight;

    // First fit cover into the box, then apply scale around the box centre.
    let drawWidth;
    let drawHeight;
    if (videoAspect > boxAspect) {
        drawHeight = bounds.height;
        drawWidth = drawHeight * videoAspect;
    } else {
        drawWidth = bounds.width;
        drawHeight = drawWidth / videoAspect;
    }
    drawWidth *= scale;
    drawHeight *= scale;
    const overflowX = drawWidth - bounds.width;
    const overflowY = drawHeight - bounds.height;
    const drawX = bounds.x - (overflowX * xPercent);
    const drawY = bounds.y - (overflowY * yPercent);

    context.save();
    context.globalAlpha = clamp(opacity, 0, 1);
    context.drawImage(videoElement, drawX, drawY, drawWidth, drawHeight);
    context.restore();
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

function buildMosaicTiles(bounds, definition = getMosaicDefinition(), options = {}) {
    const { grid, blueprint } = definition;
    const gapRatio = Number.isFinite(options.gapRatio) ? options.gapRatio : 0.24;
    const minGap = Number.isFinite(options.minGap) ? options.minGap : 27;
    const gap = Math.max(minGap, Math.round(Math.min(bounds.width / grid.columns, bounds.height / grid.rows) * gapRatio));
    const cellWidth = (bounds.width - (gap * (grid.columns - 1))) / grid.columns;
    const cellHeight = (bounds.height - (gap * (grid.rows - 1))) / grid.rows;

    return blueprint.map((tile, index) => {
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

function buildMaskPath(tiles, bleed = 0) {
    const path = new Path2D();
    tiles.forEach((tile) => {
        path.rect(
            tile.x - bleed,
            tile.y - bleed,
            tile.width + (bleed * 2),
            tile.height + (bleed * 2)
        );
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
    const videoLayer = createElement('div', 'visualizer-canvas-stage__video-layer');
    const video = createElement('video', 'visualizer-canvas-stage__video');
    const loopVideo = createElement('video', 'visualizer-canvas-stage__video visualizer-canvas-stage__video--loop');
    const canvas = createElement('canvas', 'visualizer-canvas-stage__canvas');
    // Overlay canvas is alpha-composited above the video layer; backdrop is drawn here
    // first, then the mosaic tiles are punched out so the GPU-composited video shows
    // through, then text/lyrics/grain land on top.
    const context = canvas.getContext('2d', { alpha: true, desynchronized: mode !== 'render' });

    stage.style.position = 'relative';
    stage.style.width = '100%';
    stage.style.height = '100%';
    stage.style.overflow = 'hidden';
    stage.style.background = 'rgb(248, 246, 241)';

    videoLayer.style.position = 'absolute';
    videoLayer.style.inset = '0';
    videoLayer.style.width = '100%';
    videoLayer.style.height = '100%';
    videoLayer.style.pointerEvents = 'none';
    videoLayer.style.willChange = 'clip-path';

    for (const element of [video, loopVideo]) {
        element.preload = 'auto';
        element.muted = true;
        element.playsInline = true;
        element.crossOrigin = 'anonymous';
        element.disablePictureInPicture = true;
        // Size each video to the mosaic outer bounds so cover-fitting matches the
        // original canvas drawImage semantics (which used those bounds as the
        // destination rect). The videoLayer's clip-path then masks per-tile.
        // Position is updated dynamically by applyVideoBoxToFormat(); these are
        // safe defaults that match the YouTube layout.
        element.style.position = 'absolute';
        element.style.left = '15.5%';
        element.style.top = '26.5%';
        element.style.width = '69%';
        element.style.height = '47%';
        element.style.objectFit = 'cover';
        element.style.objectPosition = '50% 50%';
        element.style.transformOrigin = '50% 50%';
        element.style.willChange = 'transform, opacity, object-position';
        element.style.backfaceVisibility = 'hidden';
        element.style.pointerEvents = 'none';
    }
    video.loop = false;
    loopVideo.loop = false;
    loopVideo.style.opacity = '0';

    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';

    videoLayer.append(video, loopVideo);
    stage.append(videoLayer, canvas);
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
    let cachedClipKey = '';
    let currentGlobalSpeed = 1;
    let cachedHostWidth = 0;
    let cachedHostHeight = 0;
    let cachedCanvasLayoutKey = '';
    let cachedCanvasLayout = null;
    let currentVideoObjectUrl = null;

    function getSafeAreaForSize(width, height) {
        const margin = currentFormat.safeMargin || {};
        const scaleX = width / currentFormat.width;
        const scaleY = height / currentFormat.height;
        const left = (margin.left || 0) * scaleX;
        const right = (margin.right || 0) * scaleX;
        const top = (margin.top || 0) * scaleY;
        const bottom = (margin.bottom || 0) * scaleY;

        return {
            x: left,
            y: top,
            width: Math.max(0, width - left - right),
            height: Math.max(0, height - top - bottom)
        };
    }

    function getContentGapForSize(width, height) {
        const sizeBase = Math.min(width, height);
        const ratio = Number.isFinite(currentFormat.contentGapRatio) ? currentFormat.contentGapRatio : 0.026;
        return Math.max(14, Math.round(sizeBase * ratio));
    }

    function getMosaicLayoutForSize(width, height) {
        const mosaicConfig = currentFormat.mosaic || { widthRatio: 0.69, heightRatio: 0.47 };
        const safeArea = getSafeAreaForSize(width, height);
        const shouldUseSafeArea = currentFormat.id === 'instagram';
        const layoutArea = shouldUseSafeArea
            ? safeArea
            : { x: 0, y: 0, width, height };
        const mosaicWidth = Math.min(width * mosaicConfig.widthRatio, layoutArea.width);
        const mosaicHeight = Math.min(height * mosaicConfig.heightRatio, layoutArea.height);
        const bounds = {
            x: layoutArea.x + ((layoutArea.width - mosaicWidth) * 0.5),
            y: layoutArea.y + ((layoutArea.height - mosaicHeight) * 0.5),
            width: mosaicWidth,
            height: mosaicHeight
        };
        const tiles = buildMosaicTiles(bounds, getMosaicDefinition(currentFormat), {
            gapRatio: currentFormat.mosaicGapRatio,
            minGap: currentFormat.mosaicMinGap
        });
        return { bounds, tiles };
    }

    function applyVideoBoxToFormat() {
        const mosaicConfig = currentFormat.mosaic || { widthRatio: 0.69, heightRatio: 0.47 };
        const leftPercent = ((1 - mosaicConfig.widthRatio) * 0.5) * 100;
        const topPercent = ((1 - mosaicConfig.heightRatio) * 0.5) * 100;
        const widthPercent = mosaicConfig.widthRatio * 100;
        const heightPercent = mosaicConfig.heightRatio * 100;
        for (const element of [video, loopVideo]) {
            element.style.left = `${leftPercent.toFixed(3)}%`;
            element.style.top = `${topPercent.toFixed(3)}%`;
            element.style.width = `${widthPercent.toFixed(3)}%`;
            element.style.height = `${heightPercent.toFixed(3)}%`;
        }
    }

    function buildClipPathString(tiles, bleed = 0) {
        return tiles
            .map((t) => {
                const x = t.x - bleed;
                const y = t.y - bleed;
                const width = t.width + (bleed * 2);
                const height = t.height + (bleed * 2);
                return `M${x.toFixed(2)} ${y.toFixed(2)}h${width.toFixed(2)}v${height.toFixed(2)}h${(-width).toFixed(2)}Z`;
            })
            .join(' ');
    }

    function updateClipPathForHost() {
        const width = host.clientWidth || currentFormat.width;
        const height = host.clientHeight || currentFormat.height;
        if (width <= 0 || height <= 0) {
            return;
        }
        if (width === cachedHostWidth && height === cachedHostHeight) {
            return;
        }
        cachedHostWidth = width;
        cachedHostHeight = height;
        const { tiles } = getMosaicLayoutForSize(width, height);
        const path = buildClipPathString(tiles, MOSAIC_CLIP_BLEED);
        const key = `${width}x${height}|${path.length}`;
        if (key === cachedClipKey) {
            return;
        }
        cachedClipKey = key;
        const value = `path("${path}")`;
        videoLayer.style.clipPath = value;
        videoLayer.style.webkitClipPath = value;
    }

    function updateCanvasSize() {
        if (mode === 'render') {
            if (canvas.width !== currentFormat.width || canvas.height !== currentFormat.height) {
                canvas.width = currentFormat.width;
                canvas.height = currentFormat.height;
                rebuildNoisePattern();
            }
            updateClipPathForHost();
            return;
        }

        const bounds = host.getBoundingClientRect();
        // Preview only needs to look crisp on screen; cap at 1x DPR since the overlay
        // is mostly text and grain. Lower canvas resolution = much cheaper redraws.
        const deviceScale = Math.min(window.devicePixelRatio || 1, 1);
        const targetWidth = Math.max(640, Math.min(currentFormat.width, Math.round((bounds.width || currentFormat.width) * deviceScale)));
        const targetHeight = Math.max(360, Math.round(targetWidth * (currentFormat.height / currentFormat.width)));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            rebuildNoisePattern();
        }
        updateClipPathForHost();
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

    function revokeCurrentVideoObjectUrl() {
        if (!currentVideoObjectUrl) {
            return;
        }
        URL.revokeObjectURL(currentVideoObjectUrl);
        currentVideoObjectUrl = null;
    }

    async function resolveVideoSource(path) {
        if (mode !== 'render') {
            return { source: path, objectUrl: null };
        }

        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Video fetch failed: ${response.status}`);
        }

        const objectUrl = URL.createObjectURL(await response.blob());
        return { source: objectUrl, objectUrl };
    }

    function applyFormat(nextFormatId) {
        currentFormat = getFormatById(nextFormatId);
        host.style.aspectRatio = currentFormat.aspectRatio;
        host.dataset.format = currentFormat.id;
        stage.dataset.format = currentFormat.id;
        stage.style.background = currentFormat.plainBackdrop ? '#fff' : 'rgb(248, 246, 241)';
        applyVideoBoxToFormat();
        // Invalidate cached layouts that depended on the previous mosaic ratios.
        cachedHostWidth = 0;
        cachedHostHeight = 0;
        cachedClipKey = '';
        cachedCanvasLayoutKey = '';
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
            pauseVideoPlayback();
            pauseLoopVideoPlayback();
            video.removeAttribute('src');
            video.load();
            loopVideo.removeAttribute('src');
            loopVideo.load();
            revokeCurrentVideoObjectUrl();
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
        revokeCurrentVideoObjectUrl();

        let nextObjectUrl = null;

        try {
            const { source, objectUrl } = await resolveVideoSource(track.video.path);
            nextObjectUrl = objectUrl;

            if (token !== mediaLoadToken) {
                if (nextObjectUrl) {
                    URL.revokeObjectURL(nextObjectUrl);
                }
                return;
            }

            video.src = source;
            loopVideo.src = source;
            currentVideoObjectUrl = nextObjectUrl;

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
            try {
                video.playbackRate = currentGlobalSpeed;
                loopVideo.playbackRate = currentGlobalSpeed;
            } catch { /* noop */ }
            resolveMediaReady();
            drawFrame(lastRenderedTime, { duration: currentDuration });
        } catch {
            if (token !== mediaLoadToken) {
                if (nextObjectUrl) {
                    URL.revokeObjectURL(nextObjectUrl);
                }
                return;
            }

            videoReady = false;
            loopVideoReady = false;
            revokeCurrentVideoObjectUrl();
            resolveMediaReady();
            drawFrame(lastRenderedTime, { duration: currentDuration });
        }
    }

    function getTimelineDuration() {
        if (!currentTrack) {
            return 0;
        }

        return Math.max(
            toFiniteNonNegative(currentTrack?.duration, 0),
            toFiniteNonNegative(currentDuration, 0)
        );
    }

    function getVideoLoopState(time) {
        if (!videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
            return {
                primaryTime: 0,
                transition: null
            };
        }

        const videoDuration = video.duration;
        const transitionDuration = getLoopTransitionDuration(videoDuration);
        const safeTime = toFiniteNonNegative(time, 0);
        const cycleDuration = Math.max(videoDuration - transitionDuration, 0.001);
        const primaryTime = safeTime < videoDuration
            ? safeTime
            : transitionDuration + (((safeTime - videoDuration) % cycleDuration) + cycleDuration) % cycleDuration;

        if (transitionDuration <= 0) {
            return {
                primaryTime: ((safeTime % videoDuration) + videoDuration) % videoDuration,
                transition: null
            };
        }

        const transitionStart = videoDuration - transitionDuration;
        if (primaryTime < transitionStart) {
            return {
                primaryTime,
                transition: null
            };
        }

        const blend = clamp((primaryTime - transitionStart) / transitionDuration, 0, 1);

        return {
            primaryTime,
            transition: {
                blend,
                incomingTime: clamp(primaryTime - transitionStart, 0, transitionDuration),
                ...getVisualCrossfade(blend)
            }
        };
    }

    function getLoopedVideoTime(time) {
        return getVideoLoopState(time).primaryTime;
    }

    function getLoopTransitionState(time) {
        return getVideoLoopState(time).transition;
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
                const loopDrift = Math.abs((loopVideo.currentTime || 0) - loopTransitionState.incomingTime);
                if (loopDrift > 0.18) {
                    setMediaTime(loopVideo, loopTransitionState.incomingTime);
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

        const loopTargetTime = loopTransitionState ? loopTransitionState.incomingTime : 0;
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

        // Wait for the seeked frame to actually be presented to the compositor so the
        // headless screenshot captures the correct video frame in render mode.
        if (typeof media.requestVideoFrameCallback === 'function') {
            await new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolve();
                };
                media.requestVideoFrameCallback(() => finish());
                // Safety net so we never hang on a video that has no new frame to present.
                setTimeout(finish, 80);
            });
        }
    }

    async function advanceMediaToTime(media, targetTime, tolerance = (1 / 120)) {
        const currentTime = media.currentTime || 0;
        const delta = targetTime - currentTime;

        if (Math.abs(delta) <= tolerance) {
            if (!media.paused) {
                media.pause();
            }
            return;
        }

        if (delta < -tolerance || delta > 0.35) {
            if (!media.paused) {
                media.pause();
            }
            await seekMediaToTime(media, targetTime, tolerance);
            if (!media.paused) {
                media.pause();
            }
            return;
        }

        let playbackStarted = true;
        try {
            const playPromise = media.play();
            if (playPromise?.catch) {
                await playPromise.catch(() => {
                    playbackStarted = false;
                });
            }
        } catch {
            playbackStarted = false;
        }

        if (!playbackStarted || media.paused) {
            await seekMediaToTime(media, targetTime, tolerance);
            if (!media.paused) {
                media.pause();
            }
            return;
        }

        await new Promise((resolve) => {
            const startedAt = performance.now();
            const maxWaitMs = Math.max(160, ((delta / Math.max(media.playbackRate || 1, 0.1)) + 0.25) * 1000);
            let timeoutId = 0;

            const finish = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = 0;
                }
                resolve();
            };

            const check = () => {
                if (
                    media.currentTime >= targetTime - tolerance
                    || media.paused
                    || media.ended
                    || media.error
                    || performance.now() - startedAt > maxWaitMs
                ) {
                    finish();
                    return;
                }
                timeoutId = setTimeout(check, 4);
            };

            check();
        });

        if (!media.paused) {
            media.pause();
        }
    }

    async function syncVideoToTime(time, strict = false, isPlaying = false, sequential = false) {
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

        if (sequential) {
            await Promise.all([
                advanceMediaToTime(video, targetTime),
                loopVideoReady
                    ? advanceMediaToTime(loopVideo, loopTransitionState ? loopTransitionState.incomingTime : 0, loopTransitionState ? (1 / 120) : (1 / 60))
                    : Promise.resolve()
            ]);
            pauseVideoPlayback();
            pauseLoopVideoPlayback();
            return;
        }

        await seekMediaToTime(video, targetTime);

        if (loopVideoReady) {
            await seekMediaToTime(loopVideo, loopTransitionState ? loopTransitionState.incomingTime : 0, loopTransitionState ? (1 / 120) : (1 / 60));
        }
    }

    function drawBackdrop(sectionColor, energy, time) {
        const width = canvas.width;
        const height = canvas.height;
        const safeTime = toFiniteNonNegative(time, 0);
        const safeEnergy = toFiniteNonNegative(energy, 0);
        const fill = currentFormat.plainBackdrop ? '#fff' : 'rgb(248, 246, 241)';

        context.fillStyle = fill;
        context.fillRect(0, 0, width, height);

        if (currentFormat.plainBackdrop) {
            return;
        }

        const accent = parseHexColor(sectionColor, parseHexColor(BACKDROP_COLORS.sand));
        const glowX = width * (0.22 + (Math.sin((safeTime * 0.06) + 0.4) * 0.05));
        const glowY = height * (0.18 + (Math.cos((safeTime * 0.08) + 0.7) * 0.04));
        const glow = context.createRadialGradient(glowX, glowY, width * 0.04, glowX, glowY, width * 0.42);
        glow.addColorStop(0, rgba(accent, 0.055 + (safeEnergy * 0.02)));
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
        const layoutKey = `${width}x${height}`;
        if (layoutKey !== cachedCanvasLayoutKey) {
            const { bounds, tiles } = getMosaicLayoutForSize(width, height);
            cachedCanvasLayout = {
                bounds,
                tiles,
                fallbackMaskPath: buildMaskPath(tiles),
                maskPath: buildMaskPath(tiles, MOSAIC_OVERLAY_BLEED)
            };
            cachedCanvasLayoutKey = layoutKey;
        }
        const { bounds, fallbackMaskPath, maskPath } = cachedCanvasLayout;
        const videoMotion = {
            panX: Math.sin((time * 0.04) + (track.id * 0.5)) * 0.14,
            panY: Math.cos((time * 0.03) + (track.id * 0.35)) * 0.12,
            scale: 1.025 + (featureSample.smoothed * 0.025)
        };
        const loopTransitionState = getLoopTransitionState(time);
        const hasVideo = videoReady && video.videoWidth && video.videoHeight;
        const hasLoop = loopTransitionState && loopVideoReady && loopVideo.videoWidth && loopVideo.videoHeight;

        if (mode === 'render') {
            // Render mode: composite video into the canvas itself so a single
            // canvas.captureStream() captures the full picture (CSS clip-path
            // layers can't be screen-grabbed by MediaRecorder).
            videoLayer.style.visibility = 'hidden';

            if (hasVideo) {
                context.save();
                context.clip(fallbackMaskPath);
                drawCoveringVideoFrame(context, video, bounds, videoMotion,
                    hasLoop ? loopTransitionState.outgoingOpacity : 1);
                if (hasLoop) {
                    drawCoveringVideoFrame(context, loopVideo, bounds, videoMotion,
                        loopTransitionState.incomingOpacity);
                }
                context.restore();
            } else {
                context.save();
                context.clip(fallbackMaskPath);
                if (currentFormat.plainBackdrop) {
                    context.fillStyle = 'rgba(20, 20, 20, 0.08)';
                } else {
                    const fallbackFill = context.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
                    fallbackFill.addColorStop(0, rgba(accent, 0.34));
                    fallbackFill.addColorStop(1, rgba(cool, 0.2));
                    context.fillStyle = fallbackFill;
                }
                context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
                context.restore();
            }

            return bounds;
        }

        // Update GPU-composited <video> elements; they live beneath the canvas and
        // are clipped by the videoLayer's CSS clip-path.
        if (hasVideo) {
            applyVideoTransform(video, {
                ...videoMotion,
                opacity: hasLoop ? loopTransitionState.outgoingOpacity : 1
            });
            videoLayer.style.visibility = 'visible';
        } else {
            video.style.opacity = '0';
            videoLayer.style.visibility = 'hidden';
        }

        if (hasLoop) {
            applyVideoTransform(loopVideo, {
                ...videoMotion,
                opacity: loopTransitionState.incomingOpacity
            });
        } else if (loopVideo.style.opacity !== '0') {
            loopVideo.style.opacity = '0';
        }

        if (hasVideo) {
            // Punch transparent tiles in the canvas so the video shows through.
            context.save();
            context.globalCompositeOperation = 'destination-out';
            context.fillStyle = '#000';
            context.fill(maskPath);
            context.restore();
        } else {
            // No video: paint a soft fallback gradient inside the tiles directly on the canvas.
            context.save();
            context.clip(fallbackMaskPath);
            if (currentFormat.plainBackdrop) {
                context.fillStyle = 'rgba(20, 20, 20, 0.08)';
            } else {
                const fallbackFill = context.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
                fallbackFill.addColorStop(0, rgba(accent, 0.34));
                fallbackFill.addColorStop(1, rgba(cool, 0.2));
                context.fillStyle = fallbackFill;
            }
            context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
            context.restore();
        }

        return bounds;
    }

    function drawText(track, bounds, section) {
        const height = canvas.height;
        const sizeBase = Math.min(canvas.width, canvas.height);
        const band = String(track.bandName || 'Sioto Jazz').toUpperCase();
        const title = String(track.title || '');

        if (currentFormat.id === 'instagram') {
            const safeArea = getSafeAreaForSize(canvas.width, canvas.height);
            const contentGap = getContentGapForSize(canvas.width, canvas.height);
            const maxWidth = safeArea.width * 0.88;
            const availableTitleHeight = Math.max(1, bounds.y - contentGap - safeArea.y);
            let bandSize = Math.round(sizeBase * 0.086);
            let titleSize = Math.round(sizeBase * 0.046);
            const minBandSize = 42;
            const minTitleSize = 24;
            let lineGap = Math.round(sizeBase * 0.008);
            let metrics = null;

            const measureStack = () => {
                context.font = `${bandSize}px "Astrella", "Garet", sans-serif`;
                const bandMetrics = context.measureText(band);
                context.font = `600 ${titleSize}px "Garet", sans-serif`;
                const titleMetrics = context.measureText(title);
                const bandAscent = bandMetrics.actualBoundingBoxAscent || (bandSize * 0.72);
                const bandDescent = bandMetrics.actualBoundingBoxDescent || (bandSize * 0.28);
                const titleAscent = titleMetrics.actualBoundingBoxAscent || (titleSize * 0.72);
                const titleDescent = titleMetrics.actualBoundingBoxDescent || (titleSize * 0.28);
                return {
                    bandWidth: bandMetrics.width,
                    titleWidth: titleMetrics.width,
                    bandAscent,
                    bandDescent,
                    titleAscent,
                    titleDescent,
                    bandHeight: bandAscent + bandDescent,
                    titleHeight: titleAscent + titleDescent,
                    blockHeight: bandAscent + bandDescent + lineGap + titleAscent + titleDescent
                };
            };

            metrics = measureStack();
            while (
                (metrics.bandWidth > maxWidth || metrics.titleWidth > maxWidth || metrics.blockHeight > availableTitleHeight)
                && (bandSize > minBandSize || titleSize > minTitleSize)
            ) {
                if (bandSize > minBandSize) {
                    bandSize -= 1;
                }
                if (titleSize > minTitleSize) {
                    titleSize -= 1;
                }
                lineGap = Math.max(4, Math.round(titleSize * 0.12));
                metrics = measureStack();
            }

            const centerX = safeArea.x + (safeArea.width * 0.5);
            const desiredBlockTop = bounds.y - contentGap - metrics.blockHeight;
            const blockTop = Math.max(safeArea.y, desiredBlockTop);
            const bandBaselineY = blockTop + metrics.bandAscent;
            const titleBaselineY = blockTop + metrics.bandHeight + lineGap + metrics.titleAscent;

            context.save();
            context.textAlign = 'center';
            context.textBaseline = 'alphabetic';
            context.fillStyle = 'rgba(20, 20, 20, 0.96)';
            context.font = `${bandSize}px "Astrella", "Garet", sans-serif`;
            context.fillText(band, centerX, bandBaselineY, maxWidth);
            context.font = `600 ${titleSize}px "Garet", sans-serif`;
            context.fillStyle = 'rgba(28, 28, 28, 0.9)';
            context.fillText(title, centerX, titleBaselineY, maxWidth);
            context.restore();
            return;
        }

        const bandReferenceText = 'SIOTO';
        const titleReferenceText = 'Ag';
        let bandSize = Math.round(sizeBase * 0.108);
        let titleSize = Math.round(sizeBase * 0.081);
        const minBandSize = 48;
        const minTitleSize = 33;
        const separatorSize = Math.max(7, Math.round(sizeBase * 0.009));
        const separatorPadding = Math.round(sizeBase * 0.018);
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
        const titleOpticalOffset = Math.round(titleSize * 0.04) + Math.max(2, Math.round(sizeBase * 0.0037));
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
        const sizeBase = Math.min(canvas.width, canvas.height);
        const lyricState = getLyricState(track, time);
        const safeArea = getSafeAreaForSize(canvas.width, canvas.height);
        const contentGap = currentFormat.id === 'instagram'
            ? getContentGapForSize(canvas.width, canvas.height)
            : 0;
        const lyricCenterX = canvas.width * 0.5;
        const lyricWidth = currentFormat.id === 'instagram'
            ? safeArea.width * 0.88
            : Math.min(canvas.width * 0.86, Math.max(bounds.width * 0.92, sizeBase * 0.6));
        const lyricZoneTop = bounds.y + bounds.height;
        const lyricZoneBottom = currentFormat.id === 'instagram'
            ? safeArea.y + safeArea.height
            : height;
        const lyricZoneHeight = Math.max(0, lyricZoneBottom - lyricZoneTop);

        context.save();
        context.textAlign = 'center';

        if (lyricState.mode !== 'synced') {
            const fallbackLabel = lyricState.mode === 'fallback'
                ? 'Lyrics timing unavailable for this track'
                : 'No lyric data for this track';
            const fallbackSize = Math.round(sizeBase * 0.022);
            const fallbackLineHeight = Math.round(fallbackSize * 1.2);
            const fallbackTop = currentFormat.id === 'instagram'
                ? Math.min(lyricZoneBottom - fallbackLineHeight, lyricZoneTop + contentGap)
                : lyricZoneTop + Math.max(0, (lyricZoneHeight - fallbackLineHeight) * 0.5);
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
                const noteSize = Math.max(18, Math.round(sizeBase * 0.032));
                const noteCenterY = currentFormat.id === 'instagram'
                    ? Math.min(lyricZoneBottom - (noteSize * 0.5), lyricZoneTop + contentGap + (noteSize * 0.5))
                    : lyricZoneTop + (lyricZoneHeight * 0.5);
                drawLyricGapNote(context, lyricCenterX, noteCenterY, noteSize);
            } else {
                const noteSize = Math.round(sizeBase * 0.022);
                const noteLineHeight = Math.round(noteSize * 1.2);
                const noteTop = currentFormat.id === 'instagram'
                    ? Math.min(lyricZoneBottom - noteLineHeight, lyricZoneTop + contentGap)
                    : lyricZoneTop + Math.max(0, (lyricZoneHeight - noteLineHeight) * 0.5);
                context.font = `${noteSize}px "Garet", sans-serif`;
                context.textBaseline = 'top';
                context.fillStyle = 'rgba(28, 28, 28, 0.62)';
                context.fillText('Instrumental passage', lyricCenterX, noteTop, lyricWidth);
            }
            context.restore();
            return;
        }

        const currentFontSize = fitFontSize(context, currentText, Math.round(sizeBase * 0.036), 18, lyricWidth, '"Garet", sans-serif');
        const currentLineHeight = Math.round(currentFontSize * 1.12);
        const transition = getLyricTransitionState(lyricState.current, time, track);
        const maxBlur = Math.max(3, Math.round(sizeBase * 0.0055));
        const maxLift = Math.max(5, Math.round(sizeBase * 0.008));

        context.font = `600 ${currentFontSize}px "Garet", sans-serif`;
        context.fillStyle = 'rgba(18, 18, 18, 0.96)';
        const currentLines = buildWrappedLines(context, currentText, lyricWidth, 2);
        const lyricMetrics = context.measureText(currentLines[0] || currentText);
        const lyricAscent = lyricMetrics.actualBoundingBoxAscent || (currentFontSize * 0.72);
        const lyricDescent = lyricMetrics.actualBoundingBoxDescent || (currentFontSize * 0.28);
        const lyricVisibleHeight = lyricAscent + lyricDescent + ((currentLines.length - 1) * currentLineHeight);
        const lyricBlockTop = currentFormat.id === 'instagram'
            ? Math.min(lyricZoneBottom - lyricVisibleHeight, lyricZoneTop + contentGap)
            : lyricZoneTop + Math.max(0, (lyricZoneHeight - lyricVisibleHeight) * 0.5);
        const firstBaselineY = lyricBlockTop + lyricAscent + (transition.translateY * maxLift);
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
        if (!noisePattern || currentFormat.plainBackdrop) {
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
            context.clearRect(0, 0, canvas.width, canvas.height);
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

        // Overlay canvas is alpha-composited above the GPU video layer.
        context.clearRect(0, 0, canvas.width, canvas.height);
        drawBackdrop(section?.color, featureSample.smoothed, safeTime);
        const bounds = drawMaskedComposition(currentTrack, section, featureSample, safeTime);
        drawText(currentTrack, bounds, section);
        drawLyrics(currentTrack, safeTime, bounds, section);
        drawGrain();
    }

    function setTrack(track) {
        currentTrack = track;
        currentDuration = toFiniteNonNegative(track?.duration, 0);
        currentAudioFeatures = createSilentFeatureSet(currentDuration);
        void loadTrackMedia(track);
        drawFrame(0, { duration: currentDuration });
    }

    function setDuration(duration) {
        currentDuration = Math.max(
            toFiniteNonNegative(currentTrack?.duration, 0),
            toFiniteNonNegative(duration, 0)
        );
        drawFrame(lastRenderedTime, { duration: currentDuration });
    }

    function setAudioFeatures(featureSet) {
        currentAudioFeatures = featureSet || createSilentFeatureSet(currentTrack?.duration || 0);
        drawFrame(lastRenderedTime, { duration: currentDuration });
    }

    async function renderTime(time, { duration, waitForVideo = false, isPlaying = false, sequentialVideo = false } = {}) {
        if (Number.isFinite(Number(duration))) {
            currentDuration = Math.max(
                toFiniteNonNegative(currentTrack?.duration, 0),
                toFiniteNonNegative(duration, 0)
            );
        }

        const safeTime = toFiniteNonNegative(time, 0);

        if (waitForVideo) {
            await mediaReadyPromise;
            await syncVideoToTime(safeTime, true, false, sequentialVideo);
        } else if (videoReady) {
            syncPreviewVideo(safeTime, isPlaying);
        }

        drawFrame(safeTime, { duration: currentDuration });
    }

    if (mode === 'preview' && window.ResizeObserver) {
        const resizeObserver = new window.ResizeObserver(() => {
            updateCanvasSize();
            drawFrame(lastRenderedTime, { duration: lastRenderedDuration || currentDuration });
        });
        resizeObserver.observe(host);
    }

    applyFormat(currentFormat.id);

    function setGlobalSpeed(speed) {
        const safe = Math.max(0.1, Math.min(2, Number(speed) || 1));
        currentGlobalSpeed = safe;
        try {
            video.playbackRate = safe;
        } catch { /* noop */ }
        try {
            loopVideo.playbackRate = safe;
        } catch { /* noop */ }
    }

    return {
        getCanvas() {
            return canvas;
        },
        getDuration() {
            return getTimelineDuration();
        },
        getFormat() {
            return currentFormat;
        },
        getGlobalSpeed() {
            return currentGlobalSpeed;
        },
        isReady() {
            return videoReady || !currentTrack?.video?.path;
        },
        setAudioFeatures,
        setDuration,
        setFormat(formatId) {
            return applyFormat(formatId);
        },
        setGlobalSpeed,
        setTime(time, options = {}) {
            return renderTime(time, options);
        },
        setTrack,
        whenReady() {
            return mediaReadyPromise;
        }
    };
}