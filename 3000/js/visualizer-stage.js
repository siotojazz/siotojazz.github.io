import { createSilentFeatureSet, sampleTrackAudioFeatures } from './visualizer-audio-features.js';

export const FORMATS = {
    youtube: {
        id: 'youtube',
        label: 'YouTube 16:9',
        width: 1920,
        height: 1080,
        aspectRatio: '16 / 9',
        capsules: { widthRatio: 0.76, lengthRatio: 0.29, thicknessRatio: 0.31, centerYRatio: 0.49 },
        // Title row centered above capsules, lyrics centered below.
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
        capsules: { widthRatio: 0.78, lengthRatio: 0.285, thicknessRatio: 0.32, centerYRatio: 0.49 },
        contentGapRatio: 0.028,
        titleZone: { topRatio: 0, heightRatio: null },
        lyricZone: { topRatio: null, heightRatio: null },
        safeMargin: { top: 220, bottom: 260, left: 64, right: 64 }
    }
};

const BACKDROP_COLORS = {
    base: '#07398f',
    sand: '#d7c6a1',
    slate: '#7f95a7',
    indexBlue: '#1f56b4',
    indexBlueStrong: '#07398f',
    indexBlueDeep: '#11479f',
    indexBlueNight: '#08205e',
    indexBlueBright: '#236bd0'
};

const INDEX_BACKGROUND_IMAGE = new URL('../resources/background.jpg', import.meta.url).href;
const CAPSULE_COUNT = 4;
const CAPSULE_ANGLE = -(42 * Math.PI) / 180;
const CAPSULE_ZOOM_LEVELS = [1, 2, 4, 6];
const CAPSULE_SHADOW_ANGLE = Math.PI / 3.7;

const VIDEO_LOOP_TRANSITION = {
    minSeconds: 0.65,
    maxSeconds: 1.35,
    ratio: 0.16
};

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

    const activeLines = lines.filter((line) => time >= line.startTime && time < line.endTime);
    const index = activeLines.length ? lines.indexOf(activeLines[0]) : -1;
    const nextIndex = lines.findIndex((line) => time < line.startTime);
    const previousIndex = nextIndex === -1
        ? lines.length - 1
        : Math.max(-1, nextIndex - 1);
    const sameBarActiveLines = activeLines.length
        ? activeLines.filter((line) => line.barNumber === activeLines[0].barNumber)
        : [];
    const currentLine = activeLines.length > 1
        ? {
            ...activeLines[0],
            line: sameBarActiveLines
                .map((line) => line.line)
                .join(' / '),
            endTime: Math.max(...sameBarActiveLines.map((line) => line.endTime))
        }
        : activeLines[0] || null;

    return {
        mode: 'synced',
        current: index >= 0 ? currentLine : null,
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
    context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';

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
    const { panX = 0, panY = 0, scale = 1, fit = 'cover' } = options;
    const xPercent = clamp(50 + (panX * 40), 0, 100) / 100;
    const yPercent = clamp(50 + (panY * 40), 0, 100) / 100;
    const boxAspect = bounds.width / bounds.height;
    const videoAspect = videoWidth / videoHeight;

    // First fit cover into the box, then apply scale around the box centre.
    let drawWidth;
    let drawHeight;
    if (fit === 'height') {
        drawHeight = bounds.height;
        drawWidth = drawHeight * videoAspect;
    } else if (videoAspect > boxAspect) {
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

function drawCoveringImageFrame(context, imageElement, bounds, scale = 1) {
    const imageWidth = imageElement.naturalWidth || imageElement.width;
    const imageHeight = imageElement.naturalHeight || imageElement.height;
    if (!imageWidth || !imageHeight) {
        return;
    }

    const boxAspect = bounds.width / bounds.height;
    const imageAspect = imageWidth / imageHeight;
    let drawWidth;
    let drawHeight;
    if (imageAspect > boxAspect) {
        drawHeight = bounds.height;
        drawWidth = drawHeight * imageAspect;
    } else {
        drawWidth = bounds.width;
        drawHeight = drawWidth / imageAspect;
    }

    drawWidth *= scale;
    drawHeight *= scale;
    const drawX = bounds.x + ((bounds.width - drawWidth) * 0.5);
    const drawY = bounds.y + ((bounds.height - drawHeight) * 0.5);
    context.drawImage(imageElement, drawX, drawY, drawWidth, drawHeight);
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

function getRotatedBounds(rect) {
    const cos = Math.cos(rect.angle);
    const sin = Math.sin(rect.angle);
    const rotatedWidth = Math.abs(rect.width * cos) + Math.abs(rect.height * sin);
    const rotatedHeight = Math.abs(rect.width * sin) + Math.abs(rect.height * cos);

    return {
        x: rect.centerX - (rotatedWidth * 0.5),
        y: rect.centerY - (rotatedHeight * 0.5),
        width: rotatedWidth,
        height: rotatedHeight
    };
}

function getUnionBounds(items) {
    if (!items.length) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    const bounds = items.map(getRotatedBounds);
    const minX = Math.min(...bounds.map((item) => item.x));
    const minY = Math.min(...bounds.map((item) => item.y));
    const maxX = Math.max(...bounds.map((item) => item.x + item.width));
    const maxY = Math.max(...bounds.map((item) => item.y + item.height));

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

function buildCapsuleTiles(area, config = {}) {
    const layoutWidth = Math.max(1, area.width * (Number.isFinite(config.widthRatio) ? config.widthRatio : 0.79));
    const capsuleWidth = Math.max(1, layoutWidth * (Number.isFinite(config.lengthRatio) ? config.lengthRatio : 0.235));
    const capsuleHeight = Math.max(1, capsuleWidth * (Number.isFinite(config.thicknessRatio) ? config.thicknessRatio : 0.31));
    const rawGap = CAPSULE_COUNT > 1
        ? (layoutWidth - (capsuleWidth * CAPSULE_COUNT)) / (CAPSULE_COUNT - 1)
        : 0;
    const gap = clamp(rawGap, -capsuleWidth * 0.2, capsuleWidth * 0.65);
    const startX = area.x + ((area.width - layoutWidth) * 0.5) + (capsuleWidth * 0.5);
    const centerY = area.y + (area.height * (Number.isFinite(config.centerYRatio) ? config.centerYRatio : 0.49));

    return Array.from({ length: CAPSULE_COUNT }, (_, index) => ({
        index,
        centerX: startX + (index * (capsuleWidth + gap)),
        centerY,
        width: capsuleWidth,
        height: capsuleHeight,
        angle: CAPSULE_ANGLE,
        zoom: CAPSULE_ZOOM_LEVELS[index] || CAPSULE_ZOOM_LEVELS[CAPSULE_ZOOM_LEVELS.length - 1],
        inset: 3
    }));
}

function traceCapsulePath(context, width, height, inset = 0) {
    const safeInset = Math.min(Math.max(0, inset), Math.max(0, (Math.min(width, height) * 0.5) - 1));
    const x = (-width * 0.5) + safeInset;
    const y = (-height * 0.5) + safeInset;
    const w = Math.max(2, width - (safeInset * 2));
    const h = Math.max(2, height - (safeInset * 2));
    const radius = h * 0.5;

    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + w - radius, y);
    context.arc(x + w - radius, y + radius, radius, -Math.PI / 2, Math.PI / 2);
    context.lineTo(x + radius, y + h);
    context.arc(x + radius, y + radius, radius, Math.PI / 2, -Math.PI / 2);
    context.closePath();
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
    context.strokeStyle = 'rgba(255, 255, 255, 0.42)';

    context.beginPath();
    context.moveTo(-size, 0);
    context.lineTo(size, 0);
    context.moveTo(0, -size);
    context.lineTo(0, size);
    context.stroke();

    context.rotate(Math.PI / 4);
    context.fillStyle = 'rgba(255, 255, 255, 0.18)';
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
    // The canvas owns the final picture so preview and captured render stay identical.
    const context = canvas.getContext('2d', { alpha: true, desynchronized: false });

    stage.style.position = 'relative';
    stage.style.width = '100%';
    stage.style.height = '100%';
    stage.style.overflow = 'hidden';
    stage.style.background = BACKDROP_COLORS.indexBlueStrong;

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
        element.style.position = 'absolute';
        element.style.left = '0';
        element.style.top = '0';
        element.style.width = '100%';
        element.style.height = '100%';
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
    let backdropImageReady = false;
    const backdropImage = new Image();
    const backdropReadyPromise = new Promise((resolve) => {
        backdropImage.onload = () => {
            backdropImageReady = true;
            resolve();
            drawFrame(lastRenderedTime, { duration: lastRenderedDuration || currentDuration });
        };
        backdropImage.onerror = () => resolve();
    });
    backdropImage.decoding = 'async';
    backdropImage.src = INDEX_BACKGROUND_IMAGE;

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

    function getCapsuleLayoutForSize(width, height) {
        const safeArea = getSafeAreaForSize(width, height);
        const shouldUseSafeArea = currentFormat.id === 'instagram';
        const layoutArea = shouldUseSafeArea
            ? safeArea
            : { x: 0, y: 0, width, height };
        const capsules = buildCapsuleTiles(layoutArea, currentFormat.capsules);
        return {
            bounds: getUnionBounds(capsules),
            capsules
        };
    }

    function applyVideoBoxToFormat() {
        for (const element of [video, loopVideo]) {
            element.style.left = '0';
            element.style.top = '0';
            element.style.width = '100%';
            element.style.height = '100%';
        }
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
        cachedClipKey = `${width}x${height}`;
        videoLayer.style.clipPath = 'none';
        videoLayer.style.webkitClipPath = 'none';
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
        stage.style.background = BACKDROP_COLORS.indexBlueStrong;
        applyVideoBoxToFormat();
        // Invalidate cached layouts that depended on the previous format ratios.
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
        const base = parseHexColor(BACKDROP_COLORS.indexBlueStrong);
        const blue = parseHexColor(BACKDROP_COLORS.indexBlue);
        const deep = parseHexColor(BACKDROP_COLORS.indexBlueDeep);
        const night = parseHexColor(BACKDROP_COLORS.indexBlueNight);
        const bright = parseHexColor(BACKDROP_COLORS.indexBlueBright);

        context.fillStyle = BACKDROP_COLORS.indexBlueStrong;
        context.fillRect(0, 0, width, height);

        if (backdropImageReady) {
            drawCoveringImageFrame(context, backdropImage, { x: 0, y: 0, width, height }, 1.06);
        }

        const bodyGradient = context.createLinearGradient(0, 0, width, height);
        bodyGradient.addColorStop(0, rgba(night, 0.42));
        bodyGradient.addColorStop(0.38, rgba(bright, 0.34));
        bodyGradient.addColorStop(0.68, rgba(blue, 0.42));
        bodyGradient.addColorStop(1, rgba(deep, 0.28));
        context.fillStyle = bodyGradient;
        context.fillRect(0, 0, width, height);

        const indexGlow = context.createRadialGradient(width * 0.82, height * 0.08, width * 0.02, width * 0.82, height * 0.08, width * 0.31);
        indexGlow.addColorStop(0, rgba(bright, 0.58));
        indexGlow.addColorStop(1, rgba(bright, 0));
        context.fillStyle = indexGlow;
        context.fillRect(0, 0, width, height);

        const accent = parseHexColor(sectionColor, base);
        const glowX = width * (0.22 + (Math.sin((safeTime * 0.06) + 0.4) * 0.05));
        const glowY = height * (0.18 + (Math.cos((safeTime * 0.08) + 0.7) * 0.04));
        const sectionGlow = context.createRadialGradient(glowX, glowY, width * 0.04, glowX, glowY, width * 0.38);
        sectionGlow.addColorStop(0, rgba(accent, 0.035 + (safeEnergy * 0.018)));
        sectionGlow.addColorStop(1, rgba(accent, 0));
        context.fillStyle = sectionGlow;
        context.fillRect(0, 0, width, height);
    }

    function drawMaskedComposition(track, section, featureSample, time) {
        const width = canvas.width;
        const height = canvas.height;
        const accent = parseHexColor(section?.color, parseHexColor(BACKDROP_COLORS.sand));
        const cool = parseHexColor(BACKDROP_COLORS.slate);
        const layoutKey = `${width}x${height}`;
        if (layoutKey !== cachedCanvasLayoutKey) {
            const { bounds, capsules } = getCapsuleLayoutForSize(width, height);
            cachedCanvasLayout = {
                bounds,
                capsules
            };
            cachedCanvasLayoutKey = layoutKey;
        }
        const { bounds, capsules } = cachedCanvasLayout;
        const videoMotion = {
            panX: Math.sin((time * 0.04) + (track.id * 0.5)) * 0.14,
            panY: Math.cos((time * 0.03) + (track.id * 0.35)) * 0.12,
            scale: 1
        };
        const loopTransitionState = getLoopTransitionState(time);
        const hasVideo = videoReady && video.videoWidth && video.videoHeight;
        const hasLoop = loopTransitionState && loopVideoReady && loopVideo.videoWidth && loopVideo.videoHeight;

        videoLayer.style.visibility = 'hidden';

        capsules.forEach((capsule) => {
            const localBounds = {
                x: -capsule.width * 0.5,
                y: -capsule.height * 0.5,
                width: capsule.width,
                height: capsule.height
            };
            const capsuleMotion = {
                panX: videoMotion.panX + ((capsule.index - ((CAPSULE_COUNT - 1) * 0.5)) * 0.045),
                panY: videoMotion.panY - ((capsule.index - ((CAPSULE_COUNT - 1) * 0.5)) * 0.025),
                scale: capsule.zoom
            };
            const shadowAngle = CAPSULE_SHADOW_ANGLE - capsule.angle;
            const shadowDistance = capsule.height * 0.18;
            const shadowOffsetX = Math.cos(shadowAngle) * shadowDistance;
            const shadowOffsetY = Math.sin(shadowAngle) * shadowDistance;
            const lightingDistance = Math.max(capsule.width, capsule.height) * 0.55;
            const lightingX = Math.cos(shadowAngle) * lightingDistance;
            const lightingY = Math.sin(shadowAngle) * lightingDistance;

            context.save();
            context.translate(capsule.centerX, capsule.centerY);
            context.rotate(capsule.angle);

            context.save();
            context.shadowColor = 'rgba(0, 17, 55, 0.42)';
            context.shadowBlur = Math.max(16, capsule.height * 0.26);
            context.shadowOffsetX = shadowOffsetX;
            context.shadowOffsetY = shadowOffsetY;
            context.fillStyle = 'rgba(8, 76, 150, 0.08)';
            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.fill();
            context.restore();

            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.clip();

            if (hasVideo) {
                drawCoveringVideoFrame(context, video, localBounds, capsuleMotion,
                    hasLoop ? loopTransitionState.outgoingOpacity : 1);
                if (hasLoop) {
                    drawCoveringVideoFrame(context, loopVideo, localBounds, capsuleMotion,
                        loopTransitionState.incomingOpacity);
                }
            } else {
                const fallbackFill = context.createLinearGradient(localBounds.x, localBounds.y, localBounds.x + localBounds.width, localBounds.y + localBounds.height);
                fallbackFill.addColorStop(0, rgba(accent, 0.4));
                fallbackFill.addColorStop(1, rgba(cool, 0.24));
                context.fillStyle = fallbackFill;
                context.fillRect(localBounds.x, localBounds.y, localBounds.width, localBounds.height);
            }

            const sheen = context.createLinearGradient(-lightingX, -lightingY, lightingX, lightingY);
            sheen.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
            sheen.addColorStop(0.34, 'rgba(255, 255, 255, 0.08)');
            sheen.addColorStop(0.62, 'rgba(255, 255, 255, 0)');
            sheen.addColorStop(1, 'rgba(0, 18, 58, 0.28)');
            context.fillStyle = sheen;
            context.fillRect(localBounds.x, localBounds.y, localBounds.width, localBounds.height);

            context.save();
            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.clip();
            context.filter = 'blur(0.75px)';
            context.lineWidth = capsule.inset;
            context.strokeStyle = 'rgba(0, 15, 50, 0.5)';
            context.translate(shadowOffsetX * 0.08, shadowOffsetY * 0.08);
            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.stroke();
            context.restore();

            context.save();
            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.clip();
            context.filter = 'blur(0.45px)';
            context.lineWidth = capsule.inset;
            context.strokeStyle = 'rgba(255, 255, 255, 0.42)';
            context.translate(-shadowOffsetX * 0.07, -shadowOffsetY * 0.07);
            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.stroke();
            context.restore();

            context.save();
            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.clip();
            context.filter = 'blur(0.6px)';
            context.lineWidth = capsule.inset;
            context.strokeStyle = 'rgba(0, 18, 58, 0.38)';
            context.translate(shadowOffsetX * 0.12, shadowOffsetY * 0.12);
            traceCapsulePath(context, capsule.width, capsule.height, 0);
            context.stroke();
            context.restore();

            context.restore();
        });

        return bounds;
    }

    function drawText(track, bounds, section) {
        const height = canvas.height;
        const sizeBase = Math.min(canvas.width, canvas.height);
        const band = String(track.bandName || 'Sioto Jazz').toUpperCase();
        const title = String(track.title || '').toUpperCase();
        const titleFontFamily = '"UniversCnRg", "Arial Narrow", Arial, sans-serif';

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
                context.font = `${titleSize}px ${titleFontFamily}`;
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
            context.shadowColor = 'rgba(3, 20, 56, 0.36)';
            context.shadowBlur = Math.max(4, sizeBase * 0.006);
            context.shadowOffsetY = Math.max(1, sizeBase * 0.002);
            context.fillStyle = 'rgba(255, 255, 255, 0.96)';
            context.font = `${bandSize}px "Astrella", "Garet", sans-serif`;
            context.fillText(band, centerX, bandBaselineY, maxWidth);
            context.font = `${titleSize}px ${titleFontFamily}`;
            context.fillStyle = 'rgba(255, 255, 255, 0.92)';
            context.fillText(title, centerX, titleBaselineY, maxWidth);
            context.restore();
            return;
        }

        const bandReferenceText = 'SIOTO';
        const titleReferenceText = 'AG';
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
            context.font = `${titleSize}px ${titleFontFamily}`;
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

        context.font = `${titleSize}px ${titleFontFamily}`;
        const titleWidth = context.measureText(title).width;
        const titleReferenceMetrics = context.measureText(titleReferenceText);
        const totalWidth = bandWidth + gap + titleWidth;
        const startX = (canvas.width - totalWidth) * 0.5;
        const rowCenterY = bounds.y * 0.5;
        const bandAscent = bandReferenceMetrics.actualBoundingBoxAscent || (bandSize * 0.72);
        const bandDescent = bandReferenceMetrics.actualBoundingBoxDescent || (bandSize * 0.28);
        const titleAscent = titleReferenceMetrics.actualBoundingBoxAscent || (titleSize * 0.72);
        const titleDescent = titleReferenceMetrics.actualBoundingBoxDescent || (titleSize * 0.28);
        const bandBaselineY = rowCenterY + ((bandAscent - bandDescent) * 0.5);
        const titleBaselineY = rowCenterY + ((titleAscent - titleDescent) * 0.5);
        const separatorCenterX = startX + bandWidth + separatorPadding + separatorSize;

        context.save();
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        context.shadowColor = 'rgba(3, 20, 56, 0.36)';
        context.shadowBlur = Math.max(4, sizeBase * 0.006);
        context.shadowOffsetY = Math.max(1, sizeBase * 0.002);
        context.fillStyle = 'rgba(255, 255, 255, 0.96)';
        context.font = `${bandSize}px "Astrella", "Garet", sans-serif`;
        context.fillText(band, startX, bandBaselineY, bandWidth + 4);
        drawHeaderSeparator(context, separatorCenterX, rowCenterY, separatorSize);
        context.font = `${titleSize}px ${titleFontFamily}`;
        context.fillStyle = 'rgba(255, 255, 255, 0.92)';
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
        context.shadowColor = 'rgba(3, 20, 56, 0.34)';
        context.shadowBlur = Math.max(3, sizeBase * 0.004);
        context.shadowOffsetY = Math.max(1, sizeBase * 0.0015);

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
            context.fillStyle = 'rgba(255, 255, 255, 0.78)';
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
                context.fillStyle = 'rgba(255, 255, 255, 0.72)';
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
        context.fillStyle = 'rgba(255, 255, 255, 0.96)';
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
            return Promise.all([mediaReadyPromise, backdropReadyPromise]).then(() => undefined);
        }
    };
}
