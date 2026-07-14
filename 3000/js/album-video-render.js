const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const BACKGROUND_TRANSITION_SECONDS = 3.5;
const SILENCE_THRESHOLD = 0.003;
const SILENCE_SCAN_STEP = 128;
const TITLE_DISPLAY_SECONDS = 10;
const COVER_SIZE = 580;
const COVER_X = (CANVAS_WIDTH - COVER_SIZE) / 2;
const COVER_Y = (CANVAS_HEIGHT - COVER_SIZE) / 2;
const PROGRESS_HEIGHT = 10;
const PROGRESS_Y = COVER_Y + COVER_SIZE;
const TITLE_Y = COVER_Y - 50;
const LYRIC_CENTER_Y = PROGRESS_Y + PROGRESS_HEIGHT + 48;

const PLAYER_COLORS = {
    surface: [245, 248, 255],
    fill: [31, 86, 180],
    deep: [17, 71, 159],
    night: [8, 32, 94],
    border: [7, 57, 143]
};

// The player cycles a short set of blue section colors. The album version keeps
// the same family but gives every song its own shade so all boundaries stay clear.
const TRACK_BLUE_SHADES = [
    '#236bd0', '#1f56b4', '#11479f', '#13256d', '#08205e',
    '#285fc0', '#174694', '#3374c7', '#0f3c82', '#2763ad',
    '#153475', '#387bcf', '#0c4a9d', '#244f9c', '#102d68'
];

const canvas = document.getElementById('album-video-canvas');
const status = document.getElementById('album-video-status');
const context = canvas.getContext('2d', { alpha: false, desynchronized: false });

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

let normalizedAlbum = null;
let coverImage = null;
let coverTexture = null;
let backgroundVideos = [];
let backgroundObjectUrl = '';
let lastAlbumTime = 0;
let ready = false;
let fatalError = '';
let readyResolve;
const readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
});

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function modulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function smoothStep(progress) {
    const value = clamp(progress, 0, 1);
    return value * value * (3 - (2 * value));
}

function parseHexColor(hex) {
    const value = String(hex || '').replace('#', '').padEnd(6, '0').slice(0, 6);
    return [
        Number.parseInt(value.slice(0, 2), 16) || 0,
        Number.parseInt(value.slice(2, 4), 16) || 0,
        Number.parseInt(value.slice(4, 6), 16) || 0
    ];
}

function rgba(rgb, alpha = 1) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function setStatus(message) {
    status.textContent = message;
}

function reportPreparation(trackIndex, trackCount, title) {
    setStatus(`Analyzing song ${trackIndex + 1}/${trackCount}: ${title}`);
    if (typeof window.__albumVideoPreparationProgress === 'function') {
        void window.__albumVideoPreparationProgress({
            current: trackIndex + 1,
            total: trackCount,
            title
        });
    }
}

function waitForEvent(target, eventName, rejectName = 'error') {
    return new Promise((resolve, reject) => {
        const handleResolve = () => {
            cleanup();
            resolve();
        };
        const handleReject = () => {
            cleanup();
            reject(new Error(`Media failed while waiting for ${eventName}.`));
        };
        const cleanup = () => {
            target.removeEventListener(eventName, handleResolve);
            if (rejectName) target.removeEventListener(rejectName, handleReject);
        };

        target.addEventListener(eventName, handleResolve, { once: true });
        if (rejectName) target.addEventListener(rejectName, handleReject, { once: true });
    });
}

async function loadImage(source) {
    const image = new Image();
    image.decoding = 'sync';
    image.src = source;
    if (typeof image.decode === 'function') {
        await image.decode();
    } else if (!image.complete) {
        await waitForEvent(image, 'load');
    }
    return image;
}

function buildCoverTexture(image) {
    const texture = document.createElement('canvas');
    // Cache at 2x its final display size. The original 5000x5000 source is used
    // for the one high-quality downsample, while the stable canvas texture avoids
    // Chromium evicting tiles from the very large image during a long render.
    texture.width = 1220;
    texture.height = 1220;
    const textureContext = texture.getContext('2d', { alpha: false });
    textureContext.imageSmoothingEnabled = true;
    textureContext.imageSmoothingQuality = 'high';
    textureContext.drawImage(image, 0, 0, texture.width, texture.height);
    return texture;
}

async function loadBackgroundVideos() {
    const response = await fetch('background.mp4');
    if (!response.ok) {
        throw new Error(`Could not load background.mp4 (${response.status}).`);
    }

    backgroundObjectUrl = URL.createObjectURL(await response.blob());
    const videos = [0, 1].map(() => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = backgroundObjectUrl;
        return video;
    });

    await Promise.all(videos.map(async (video) => {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await waitForEvent(video, 'loadeddata');
        }
        video.pause();
        video.currentTime = 0;
    }));

    return videos;
}

function detectSilenceDuration(audioBuffer, fromEnd = false) {
    const channelCount = audioBuffer.numberOfChannels;
    const frameCount = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    if (!channelCount || !frameCount || !sampleRate) return 0;

    if (fromEnd) {
        for (let frame = frameCount - 1; frame >= 0; frame -= SILENCE_SCAN_STEP) {
            let blockPeak = 0;
            for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
                blockPeak = Math.max(blockPeak, Math.abs(audioBuffer.getChannelData(channelIndex)[frame] || 0));
            }
            if (blockPeak > SILENCE_THRESHOLD) {
                return (frameCount - frame) / sampleRate;
            }
        }
        return frameCount / sampleRate;
    }

    for (let frame = 0; frame < frameCount; frame += SILENCE_SCAN_STEP) {
        let blockPeak = 0;
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
            blockPeak = Math.max(blockPeak, Math.abs(audioBuffer.getChannelData(channelIndex)[frame] || 0));
        }
        if (blockPeak > SILENCE_THRESHOLD) {
            return frame / sampleRate;
        }
    }

    return frameCount / sampleRate;
}

function getTrackTiming(track) {
    const bpm = Number.parseFloat(track?.tempo) || 120;
    const isSixEight = track?.timeSignature === '6/8';
    const beatDuration = isSixEight ? (60 / bpm) * 1.5 : 60 / bpm;
    const beatsPerBar = isSixEight ? 2 : 4;

    return {
        bpm,
        beatDuration,
        beatsPerBar,
        barDuration: beatDuration * beatsPerBar,
        startOffset: Number.parseFloat(track?.startOffset) || 0
    };
}

function buildLyricTimeline(track, trim, timing) {
    const source = Array.isArray(track?.lyrics) ? track.lyrics : [];
    const lyrics = source.map((entry, order) => {
        const barNumber = Math.max(0, Number.parseFloat(entry?.barNumber) || 0);
        const barLength = Math.max(0.25, Number.parseFloat(entry?.barLength) || 1);
        const offset = Number.parseFloat(entry?.offset) || 0;
        const sourceStartTime = timing.startOffset + (barNumber * timing.barDuration) + offset;
        const sourceEndTime = sourceStartTime + (barLength * timing.barDuration);

        return {
            order,
            line: String(entry?.line || '').trim(),
            barNumber,
            barLength,
            offset,
            startTime: clamp(sourceStartTime - trim.sourceStart, 0, trim.duration),
            endTime: clamp(sourceEndTime - trim.sourceStart, 0, trim.duration)
        };
    }).filter((entry) => entry.line && entry.endTime > entry.startTime)
        .sort((left, right) => (left.startTime - right.startTime) || (left.order - right.order));

    // This is the overlap rule used by the site player for manually offset lines.
    lyrics.forEach((entry, entryIndex) => {
        for (let nextIndex = entryIndex + 1; nextIndex < lyrics.length; nextIndex += 1) {
            const nextEntry = lyrics[nextIndex];
            if (nextEntry.startTime >= entry.endTime) break;
            if (nextEntry.barNumber === entry.barNumber) continue;
            if (entry.offset !== 0 || nextEntry.offset !== 0) {
                entry.endTime = Math.min(entry.endTime, nextEntry.startTime);
                break;
            }
        }
    });

    return lyrics.sort((left, right) => left.order - right.order);
}

async function analyzeTrack(audioContext, track, trackIndex, trackCount) {
    const audioPath = String(track?.mp3 || '').trim();
    if (!audioPath) {
        throw new Error(`Song ${trackIndex + 1} (${track?.title || 'untitled'}) has no standard audio source.`);
    }

    reportPreparation(trackIndex, trackCount, track.title || `Song ${trackIndex + 1}`);
    const response = await fetch(audioPath);
    if (!response.ok) {
        throw new Error(`Could not load ${audioPath} (${response.status}).`);
    }

    const encodedAudio = await response.arrayBuffer();
    const decodedAudio = await audioContext.decodeAudioData(encodedAudio.slice(0));
    const rawDuration = decodedAudio.duration || 0;
    const leadingSilence = Math.min(detectSilenceDuration(decodedAudio, false), rawDuration);
    const trailingSilence = Math.min(detectSilenceDuration(decodedAudio, true), rawDuration);
    const sourceStart = clamp(leadingSilence, 0, rawDuration);
    const sourceEnd = clamp(rawDuration - Math.max(0, trailingSilence), sourceStart, rawDuration);
    const audibleDuration = Math.max(0, sourceEnd - sourceStart);
    const trim = audibleDuration > 0.05
        ? { rawDuration, sourceStart, sourceEnd, duration: audibleDuration }
        : { rawDuration, sourceStart: 0, sourceEnd: rawDuration, duration: rawDuration };
    const timing = getTrackTiming(track);

    return {
        ...track,
        trackIndex,
        displayNumber: trackIndex + 1,
        audioPath,
        rawDuration: trim.rawDuration,
        sourceStart: trim.sourceStart,
        sourceEnd: trim.sourceEnd,
        duration: trim.duration,
        timing,
        lyrics: buildLyricTimeline(track, trim, timing)
    };
}

async function buildAlbumTimeline(albumData) {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
        throw new Error('This browser cannot decode the album audio.');
    }

    const audioContext = new AudioContextConstructor();
    // Match index.html exactly: numeric ID order, limited to the standard album.
    const sortedTracks = (Array.isArray(albumData?.tracks) ? albumData.tracks.slice() : [])
        .sort((left, right) => (Number(left?.id) || 9999) - (Number(right?.id) || 9999));
    const standardTrackCount = Number.parseInt(albumData?.album?.standardTrackCount, 10);
    const sourceTracks = Number.isFinite(standardTrackCount) && standardTrackCount > 0
        ? sortedTracks.slice(0, standardTrackCount)
        : sortedTracks;
    const tracks = [];
    let cursor = 0;

    try {
        for (let trackIndex = 0; trackIndex < sourceTracks.length; trackIndex += 1) {
            const track = await analyzeTrack(audioContext, sourceTracks[trackIndex], trackIndex, sourceTracks.length);
            track.albumStart = cursor;
            cursor += track.duration;
            track.albumEnd = cursor;
            tracks.push(track);
        }
    } finally {
        await audioContext.close().catch(() => undefined);
    }

    if (!tracks.length || cursor <= 0) {
        throw new Error('No playable songs were found in album.json.');
    }

    return {
        album: albumData?.album || {},
        tracks,
        duration: cursor
    };
}

function getTrackPosition(albumTime) {
    const safeTime = clamp(Number(albumTime) || 0, 0, normalizedAlbum.duration);
    for (let index = normalizedAlbum.tracks.length - 1; index >= 0; index -= 1) {
        const track = normalizedAlbum.tracks[index];
        if (safeTime >= track.albumStart || index === 0) {
            return {
                track,
                trackTime: clamp(safeTime - track.albumStart, 0, track.duration)
            };
        }
    }
    return { track: normalizedAlbum.tracks[0], trackTime: 0 };
}

function getLyricState(track, trackTime) {
    const lines = track?.lyrics || [];
    if (!lines.length) return { current: null, next: null };

    const activeLines = lines.filter((line) => trackTime >= line.startTime && trackTime < line.endTime);
    const next = lines.find((line) => trackTime < line.startTime) || null;
    if (!activeLines.length) return { current: null, next };

    const sameBarLines = activeLines.filter((line) => line.barNumber === activeLines[0].barNumber);
    return {
        current: activeLines.length > 1
            ? {
                ...activeLines[0],
                line: sameBarLines.map((line) => line.line).join(' / '),
                endTime: Math.max(...sameBarLines.map((line) => line.endTime))
            }
            : activeLines[0],
        next
    };
}

// Kept in step with getLyricTransitionState() in visualizer-stage.js.
function getLyricTransitionState(line, time, track) {
    if (!line) return { alpha: 0, blur: 0, translateY: 0, scale: 1 };

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
        blur: 1 - visibility,
        translateY: 1 - visibility,
        scale: 0.968 + (holdProgress * 0.12)
    };
}

function getBackgroundLoopState(albumTime) {
    const video = backgroundVideos[0];
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
        return { primaryTime: 0, transition: null };
    }

    const duration = video.duration;
    const transitionDuration = Math.min(BACKGROUND_TRANSITION_SECONDS, duration * 0.45);
    const cycleDuration = Math.max(duration - transitionDuration, 0.001);
    const primaryTime = albumTime < duration
        ? albumTime
        : transitionDuration + modulo(albumTime - duration, cycleDuration);
    const transitionStart = duration - transitionDuration;

    if (primaryTime < transitionStart) {
        return { primaryTime, transition: null };
    }

    const blend = smoothStep((primaryTime - transitionStart) / transitionDuration);
    return {
        primaryTime,
        transition: {
            blend,
            incomingTime: clamp(primaryTime - transitionStart, 0, transitionDuration)
        }
    };
}

function setMediaTime(media, time) {
    try {
        media.currentTime = time;
        return true;
    } catch {
        return false;
    }
}

async function seekMediaToTime(media, targetTime, tolerance = 1 / 120) {
    if (Math.abs((media.currentTime || 0) - targetTime) <= tolerance) return;

    await new Promise((resolve) => {
        const finish = () => {
            media.removeEventListener('seeked', finish);
            media.removeEventListener('error', finish);
            resolve();
        };
        media.addEventListener('seeked', finish, { once: true });
        media.addEventListener('error', finish, { once: true });
        if (!setMediaTime(media, targetTime)) finish();
    });

    if (typeof media.requestVideoFrameCallback === 'function') {
        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            media.requestVideoFrameCallback(finish);
            window.setTimeout(finish, 80);
        });
    }
}

async function advanceMediaToTime(media, targetTime, tolerance = 1 / 120) {
    const delta = targetTime - (media.currentTime || 0);
    if (Math.abs(delta) <= tolerance) {
        media.pause();
        return;
    }

    if (delta < -tolerance || delta > 0.35) {
        media.pause();
        await seekMediaToTime(media, targetTime, tolerance);
        media.pause();
        return;
    }

    let started = true;
    try {
        await media.play().catch(() => {
            started = false;
        });
    } catch {
        started = false;
    }

    if (!started || media.paused) {
        await seekMediaToTime(media, targetTime, tolerance);
        return;
    }

    await new Promise((resolve) => {
        const startedAt = performance.now();
        const maxWait = Math.max(160, (delta + 0.25) * 1000);
        const check = () => {
            if (media.currentTime >= targetTime - tolerance || media.paused || media.ended || performance.now() - startedAt > maxWait) {
                resolve();
                return;
            }
            window.setTimeout(check, 4);
        };
        check();
    });
    media.pause();
}

async function syncBackground(albumTime, sequential = false) {
    const loopState = getBackgroundLoopState(albumTime);
    const primary = backgroundVideos[0];
    const incoming = backgroundVideos[1];
    primary.pause();
    incoming.pause();

    if (sequential) {
        await Promise.all([
            advanceMediaToTime(primary, loopState.primaryTime),
            advanceMediaToTime(incoming, loopState.transition?.incomingTime || 0, loopState.transition ? 1 / 120 : 1 / 60)
        ]);
    } else {
        await Promise.all([
            seekMediaToTime(primary, loopState.primaryTime),
            seekMediaToTime(incoming, loopState.transition?.incomingTime || 0, loopState.transition ? 1 / 120 : 1 / 60)
        ]);
    }
}

function drawCoveringMedia(media, opacity = 1) {
    const mediaWidth = media.videoWidth || CANVAS_WIDTH;
    const mediaHeight = media.videoHeight || CANVAS_HEIGHT;
    const mediaAspect = mediaWidth / mediaHeight;
    const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
    let drawWidth;
    let drawHeight;

    if (mediaAspect > canvasAspect) {
        drawHeight = CANVAS_HEIGHT;
        drawWidth = drawHeight * mediaAspect;
    } else {
        drawWidth = CANVAS_WIDTH;
        drawHeight = drawWidth / mediaAspect;
    }

    drawWidth *= 1.015;
    drawHeight *= 1.015;
    context.save();
    context.globalAlpha = opacity;
    context.drawImage(media, (CANVAS_WIDTH - drawWidth) / 2, (CANVAS_HEIGHT - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
}

function drawBackground(albumTime) {
    context.fillStyle = '#07398f';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const loopState = getBackgroundLoopState(albumTime);
    if (backgroundVideos[0]?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        drawCoveringMedia(backgroundVideos[0], loopState.transition ? 1 - loopState.transition.blend : 1);
    }
    if (loopState.transition && backgroundVideos[1]?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        drawCoveringMedia(backgroundVideos[1], loopState.transition.blend);
    }

    const vignette = context.createRadialGradient(960, 475, 170, 960, 520, 1050);
    vignette.addColorStop(0, 'rgba(4, 18, 52, 0.03)');
    vignette.addColorStop(0.58, 'rgba(4, 18, 52, 0.16)');
    vignette.addColorStop(1, 'rgba(3, 13, 42, 0.52)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawCover() {
    context.save();
    context.shadowColor = 'rgba(3, 15, 46, 0.58)';
    context.shadowBlur = 42;
    context.shadowOffsetY = 18;
    context.fillStyle = 'rgba(5, 24, 68, 0.4)';
    context.fillRect(COVER_X, COVER_Y, COVER_SIZE, COVER_SIZE);
    context.shadowColor = 'transparent';
    context.drawImage(coverTexture || coverImage, COVER_X, COVER_Y, COVER_SIZE, COVER_SIZE);
    context.strokeStyle = 'rgba(255, 255, 255, 0.48)';
    context.lineWidth = 1;
    context.strokeRect(COVER_X + 0.5, COVER_Y + 0.5, COVER_SIZE - 1, COVER_SIZE - 1);
    context.restore();
}

function fitFontSize(text, maxSize, minSize, maxWidth, weight = '400') {
    let size = maxSize;
    while (size > minSize) {
        context.font = `${weight} ${size}px "Garet", Arial, sans-serif`;
        if (context.measureText(text).width <= maxWidth) break;
        size -= 1;
    }
    return size;
}

function drawTrackTitle(track, trackTime) {
    if (trackTime < 0 || trackTime >= TITLE_DISPLAY_SECONDS) return;

    const feature = String(track?.feature || '').trim();
    const mainText = String(track.title || '');
    const fullText = feature ? `${mainText}  ${feature}` : mainText;
    const fontSize = fitFontSize(fullText, 37, 26, COVER_SIZE, '400');
    const transition = getLyricTransitionState({
        startTime: 0,
        endTime: TITLE_DISPLAY_SECONDS
    }, trackTime, track);
    const maxBlur = 6;
    const maxLift = 9;

    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `400 ${fontSize}px "Garet", Arial, sans-serif`;
    context.fontKerning = 'normal';
    context.letterSpacing = '1px';
    context.fillStyle = '#fff';
    context.shadowColor = '#4f86b3';
    context.shadowBlur = 9;
    context.shadowOffsetY = 2;
    context.globalAlpha = transition.alpha;
    if (transition.blur > 0.001) {
        context.filter = `blur(${(transition.blur * maxBlur).toFixed(2)}px)`;
    }
    context.translate(CANVAS_WIDTH / 2, TITLE_Y + (transition.translateY * maxLift));
    context.scale(transition.scale, transition.scale);
    context.fillText(fullText, 0, 0, COVER_SIZE);
    context.restore();
}

function drawPlayerProgress(albumTime) {
    const x = COVER_X;
    const y = PROGRESS_Y;
    const width = COVER_SIZE;
    const height = PROGRESS_HEIGHT;
    const frame = 1;
    const innerX = x + frame;
    const innerY = y + frame;
    const innerWidth = width - (frame * 2);
    const innerHeight = height - (frame * 2);
    const topSheen = Math.max(1, Math.floor(innerHeight * 0.34));
    const bottomShade = Math.max(1, Math.floor(innerHeight * 0.18));
    const progress = clamp(albumTime / normalizedAlbum.duration, 0, 1);

    const rect = (rectX, rectY, rectWidth, rectHeight, fill) => {
        if (rectWidth <= 0 || rectHeight <= 0) return;
        context.fillStyle = fill;
        context.fillRect(rectX, rectY, rectWidth, rectHeight);
    };

    const drawProgressFill = (fillX, fillWidth, color, alpha = 1) => {
        rect(fillX, innerY, fillWidth, innerHeight, rgba(color, alpha));
        rect(fillX, innerY, fillWidth, topSheen, `rgba(255, 255, 255, ${0.28 * alpha})`);
        rect(fillX, innerY + innerHeight - bottomShade, fillWidth, bottomShade, rgba(PLAYER_COLORS.night, 0.28 * alpha));
    };

    // Raised square shell and inset track well: the same construction as progress-gl.js.
    rect(x, y, width, height, rgba(PLAYER_COLORS.surface, 1));
    rect(x, y, width, 1, 'rgba(255, 255, 255, 0.78)');
    rect(x, y, 1, height, 'rgba(255, 255, 255, 0.78)');
    rect(x, y + height - 1, width, 1, rgba(PLAYER_COLORS.night, 0.48));
    rect(x + width - 1, y, 1, height, rgba(PLAYER_COLORS.night, 0.48));
    rect(innerX, innerY, innerWidth, innerHeight, rgba(PLAYER_COLORS.night, 0.18));
    rect(innerX, innerY, innerWidth, 1, 'rgba(255, 255, 255, 0.44)');
    rect(innerX, innerY + innerHeight - 1, innerWidth, 1, rgba(PLAYER_COLORS.border, 0.3));

    normalizedAlbum.tracks.forEach((track, index) => {
        const start = track.albumStart / normalizedAlbum.duration;
        const end = track.albumEnd / normalizedAlbum.duration;
        const segmentX = innerX + (start * innerWidth);
        const segmentWidth = Math.max(1, (end - start) * innerWidth);
        const color = parseHexColor(TRACK_BLUE_SHADES[index % TRACK_BLUE_SHADES.length]);
        rect(segmentX, innerY, segmentWidth, innerHeight, rgba(color, 0.34));
        rect(segmentX, innerY, segmentWidth, topSheen, 'rgba(255, 255, 255, 0.22)');
        rect(segmentX, innerY + innerHeight - 1, segmentWidth, 1, rgba(PLAYER_COLORS.night, 0.24));
    });

    normalizedAlbum.tracks.slice(1).forEach((track) => {
        const boundaryX = Math.round(innerX + ((track.albumStart / normalizedAlbum.duration) * innerWidth));
        rect(boundaryX, innerY, 1, innerHeight, 'rgba(255, 255, 255, 0.45)');
        rect(boundaryX + 1, innerY, 1, innerHeight, rgba(PLAYER_COLORS.night, 0.28));
    });

    const filled = progress * innerWidth;
    if (filled > 0) {
        drawProgressFill(innerX, filled, PLAYER_COLORS.deep, 0.64);
        normalizedAlbum.tracks.forEach((track, index) => {
            const start = track.albumStart / normalizedAlbum.duration;
            if (progress <= start) return;
            const end = Math.min(track.albumEnd / normalizedAlbum.duration, progress);
            const segmentX = innerX + (start * innerWidth);
            const segmentWidth = Math.max(1, (end - start) * innerWidth);
            drawProgressFill(segmentX, segmentWidth, parseHexColor(TRACK_BLUE_SHADES[index % TRACK_BLUE_SHADES.length]), 0.98);
        });
        rect(innerX, innerY, Math.max(1, Math.floor(filled)), 1, 'rgba(255, 255, 255, 0.34)');
        rect(Math.min(innerX + innerWidth - 1, innerX + filled), innerY, 1, innerHeight, rgba(PLAYER_COLORS.night, 0.42));
    }
}

function wrapText(text, maxWidth, maxLines = 2) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = '';

    words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (current && context.measureText(candidate).width > maxWidth && lines.length < maxLines - 1) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    });
    if (current) lines.push(current);
    return lines.slice(0, maxLines);
}

function drawLyrics(track, trackTime) {
    const state = getLyricState(track, trackTime);
    const centerX = CANVAS_WIDTH / 2;
    const centerY = LYRIC_CENTER_Y;
    const maxWidth = 1000;

    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = '#4f86b3';
    context.shadowBlur = 8;
    context.shadowOffsetY = 2;

    if (!state.current) {
        context.restore();
        return;
    }

    const fontSize = fitFontSize(state.current.line, 25, 18, maxWidth, '400');
    context.font = `400 ${fontSize}px "Garet", Arial, sans-serif`;
    context.fontKerning = 'normal';
    context.letterSpacing = '0.35px';
    const lines = wrapText(state.current.line, maxWidth, 2);
    const lineHeight = Math.round(fontSize * 1.14);
    const transition = getLyricTransitionState(state.current, trackTime, track);
    const maxBlur = 6;
    const maxLift = 9;
    const blockHeight = Math.max(lineHeight, lines.length * lineHeight);

    context.globalAlpha = transition.alpha;
    context.fillStyle = 'rgba(255, 255, 255, 0.98)';
    if (transition.blur > 0.001) {
        context.filter = `blur(${(transition.blur * maxBlur).toFixed(2)}px)`;
    }
    context.translate(centerX, centerY + (transition.translateY * maxLift));
    context.scale(transition.scale, transition.scale);
    lines.forEach((line, index) => {
        const baseline = ((index - ((lines.length - 1) / 2)) * lineHeight);
        context.fillText(line, 0, baseline, maxWidth);
    });
    context.restore();
}

function drawFrame(albumTime) {
    const safeTime = clamp(Number(albumTime) || 0, 0, normalizedAlbum.duration);
    const { track, trackTime } = getTrackPosition(safeTime);
    drawBackground(safeTime);
    drawCover();
    drawTrackTitle(track, trackTime);
    drawPlayerProgress(safeTime);
    drawLyrics(track, trackTime);
    lastAlbumTime = safeTime;
}

function getDefaultPreviewTime() {
    const track = normalizedAlbum?.tracks?.find((candidate) => candidate.lyrics.length);
    const lyric = track?.lyrics?.[0];
    if (!track) return 0;
    return clamp(track.albumStart + (lyric ? lyric.startTime + 0.45 : Math.min(10, track.duration * 0.25)), 0, normalizedAlbum.duration);
}

async function bootstrap() {
    try {
        setStatus('Loading album data…');
        const albumResponse = await fetch('album.json');
        if (!albumResponse.ok) {
            throw new Error(`Could not load album.json (${albumResponse.status}).`);
        }
        const albumData = await albumResponse.json();

        setStatus('Loading Garet, cover art, and background video…');
        const coverSource = albumData?.album?.coverImage || 'album_cover.png';
        [coverImage, backgroundVideos] = await Promise.all([
            loadImage(coverSource),
            loadBackgroundVideos(),
            document.fonts.load('48px "Garet"'),
            document.fonts.load('700 48px "Garet"'),
            document.fonts.ready
        ]);
        coverTexture = buildCoverTexture(coverImage);

        normalizedAlbum = await buildAlbumTimeline(albumData);
        await syncBackground(getDefaultPreviewTime(), false);
        drawFrame(getDefaultPreviewTime());
        ready = true;
        document.body.classList.add('is-ready');
        readyResolve();
    } catch (error) {
        fatalError = error?.message || String(error);
        setStatus(fatalError);
        console.error(error);
        throw error;
    }
}

window.__albumVideoRender = {
    getCanvas: () => canvas,
    getDefaultPreviewTime: () => ready ? getDefaultPreviewTime() : 0,
    getDuration: () => normalizedAlbum?.duration || 0,
    getError: () => fatalError,
    getState: () => {
        if (!normalizedAlbum) return null;
        const { track, trackTime } = getTrackPosition(lastAlbumTime);
        return {
            albumTime: lastAlbumTime,
            trackTime,
            trackIndex: track.trackIndex,
            trackTitle: track.title
        };
    },
    getTimeline: () => normalizedAlbum ? {
        album: normalizedAlbum.album,
        duration: normalizedAlbum.duration,
        tracks: normalizedAlbum.tracks.map((track) => ({
            id: track.id,
            trackIndex: track.trackIndex,
            displayNumber: track.displayNumber,
            title: track.title,
            audioPath: track.audioPath,
            rawDuration: track.rawDuration,
            sourceStart: track.sourceStart,
            sourceEnd: track.sourceEnd,
            duration: track.duration,
            albumStart: track.albumStart,
            albumEnd: track.albumEnd,
            lyrics: track.lyrics
        }))
    } : null,
    isReady: () => ready,
    setTime: async (albumTime, { sequentialVideo = false } = {}) => {
        if (!ready) await readyPromise;
        const safeTime = clamp(Number(albumTime) || 0, 0, normalizedAlbum.duration);
        await syncBackground(safeTime, sequentialVideo);
        drawFrame(safeTime);
        return window.__albumVideoRender.getState();
    },
    whenReady: () => readyPromise
};

window.addEventListener('beforeunload', () => {
    if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
});

void bootstrap();
