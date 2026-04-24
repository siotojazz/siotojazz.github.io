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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
    return start + ((end - start) * amount);
}

function createElement(tagName, className, textContent = '') {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (textContent) {
        element.textContent = textContent;
    }
    return element;
}

function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function getDisplayIndex(lyrics, currentTime) {
    if (!lyrics.length) {
        return -1;
    }

    for (let index = 0; index < lyrics.length; index += 1) {
        const lyric = lyrics[index];
        if (currentTime >= lyric.startTime && currentTime <= lyric.endTime) {
            return index;
        }
        if (currentTime < lyric.startTime) {
            return Math.max(0, index - 1);
        }
    }

    return lyrics.length - 1;
}

function getVisibleIndices(lyrics, displayIndex) {
    if (!lyrics.length || displayIndex < 0) {
        return [];
    }

    return [displayIndex - 1, displayIndex, displayIndex + 1, displayIndex + 2]
        .filter((index) => index >= 0 && index < lyrics.length);
}

function getRoleFromOffset(offset) {
    if (offset <= -1) {
        return 'previous';
    }
    if (offset === 0) {
        return 'current';
    }
    if (offset === 1) {
        return 'next';
    }
    return 'future';
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

function formatBandName(name) {
    return String(name || 'SIOTO JAZZ').toUpperCase();
}

function buildWordNode(word, index) {
    const node = createElement('span', 'visualizer-word', word.word);
    node.dataset.wordIndex = String(index);
    return node;
}

function getWordLeadWindow(wordDuration, beatDuration) {
    const beatWindow = beatDuration * 0.72;
    return Math.max(0.12, Math.min(beatWindow, Math.max(0.18, wordDuration * 0.42)));
}

function getWordTrailWindow(wordDuration, beatDuration) {
    const beatWindow = beatDuration * 0.58;
    return Math.max(0.1, Math.min(beatWindow, Math.max(0.14, wordDuration * 0.28)));
}

function easeOutQuad(value) {
    return 1 - ((1 - value) * (1 - value));
}

function easeInOutSine(value) {
    return -(Math.cos(Math.PI * value) - 1) / 2;
}

function hexToRgbChannels(color) {
    const safeColor = String(color || '#d76c4d').replace('#', '').trim();
    const normalized = safeColor.length === 3
        ? safeColor.split('').map((part) => `${part}${part}`).join('')
        : safeColor.padEnd(6, '0').slice(0, 6);
    const red = Number.parseInt(normalized.slice(0, 2), 16) || 215;
    const green = Number.parseInt(normalized.slice(2, 4), 16) || 108;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) || 77;
    return `${red}, ${green}, ${blue}`;
}

export function getFormatById(formatId) {
    return FORMATS[formatId] || FORMATS.youtube;
}

export function createVisualizerStage(container, { format = 'youtube' } = {}) {
    const host = container;
    const stage = createElement('div', 'visualizer-stage');
    stage.innerHTML = `
        <div class="visualizer-stage__image"></div>
        <div class="visualizer-stage__vignette"></div>
        <div class="visualizer-stage__wash"></div>
        <div class="visualizer-stage__beam"></div>
        <div class="visualizer-stage__grain"></div>
        <header class="visualizer-stage__meta">
            <div class="visualizer-stage__band"></div>
            <div class="visualizer-stage__title-row">
                <div class="visualizer-stage__title"></div>
            </div>
        </header>
        <div class="visualizer-stage__lyrics"></div>
        <div class="visualizer-stage__progress">
            <div class="visualizer-stage__progress-meta">
                <div class="visualizer-stage__progress-time"></div>
            </div>
            <div class="visualizer-stage__progress-track">
                <div class="visualizer-stage__segments"></div>
                <div class="visualizer-stage__markers"></div>
                <div class="visualizer-stage__progress-fill"></div>
                <div class="visualizer-stage__playhead"></div>
            </div>
        </div>
    `;
    host.replaceChildren(stage);

    const refs = {
        band: stage.querySelector('.visualizer-stage__band'),
        title: stage.querySelector('.visualizer-stage__title'),
        lyrics: stage.querySelector('.visualizer-stage__lyrics'),
        progressTime: stage.querySelector('.visualizer-stage__progress-time'),
        segments: stage.querySelector('.visualizer-stage__segments'),
        markers: stage.querySelector('.visualizer-stage__markers'),
        progressFill: stage.querySelector('.visualizer-stage__progress-fill'),
        playhead: stage.querySelector('.visualizer-stage__playhead')
    };

    let currentFormat = getFormatById(format);
    let currentTrack = null;
    let currentDuration = 0;
    let currentAudioFeatures = createSilentFeatureSet();
    let lyricWindowKey = '';
    let lineRegistry = [];
    let segmentRegistry = [];
    let markerRegistry = [];
    let lastRenderedTime = 0;
    let lastRenderedDuration = 0;

    function applyFormat(nextFormatId) {
        currentFormat = getFormatById(nextFormatId);
        host.style.aspectRatio = currentFormat.aspectRatio;
        host.dataset.format = currentFormat.id;
        stage.dataset.format = currentFormat.id;
        stage.style.setProperty('--frame-width', String(currentFormat.width));
        stage.style.setProperty('--frame-height', String(currentFormat.height));
    }

    function getTimelineDuration() {
        if (!currentTrack) {
            return 0;
        }
        return Math.max(currentTrack.duration || 0, currentDuration || 0);
    }

    function rebuildProgress() {
        refs.segments.replaceChildren();
        refs.markers.replaceChildren();
        segmentRegistry = [];
        markerRegistry = [];

        if (!currentTrack) {
            return;
        }

        const duration = Math.max(getTimelineDuration(), 0.001);
        const sectionMarkerTolerance = (currentTrack.timing?.barDuration || 0.001) * 0.02;

        currentTrack.sections.forEach((section) => {
            const segment = createElement('div', 'visualizer-progress__segment');
            segment.style.left = `${(section.startTime / duration) * 100}%`;
            segment.style.width = `${Math.max(0.5, ((section.endTime - section.startTime) / duration) * 100)}%`;
            segment.style.setProperty('--segment-rgb', hexToRgbChannels(section.color));
            segment.title = section.label;
            refs.segments.appendChild(segment);
            segmentRegistry.push({ section, node: segment });
        });

        currentTrack.barMarkers.forEach((marker) => {
            const line = createElement('div', 'visualizer-progress__marker');
            line.classList.add('visualizer-progress__marker--bar');
            const sectionAtMarker = currentTrack.sections.find((section) => {
                return Math.abs(section.startTime - marker.time) <= sectionMarkerTolerance;
            });
            if (sectionAtMarker && marker.index !== 0) {
                line.classList.add('visualizer-progress__marker--section');
                line.title = sectionAtMarker.label;
            } else {
                line.title = marker.label;
            }
            line.style.left = `${(marker.time / duration) * 100}%`;
            refs.markers.appendChild(line);
            markerRegistry.push({
                marker,
                node: line,
                isSectionStart: Boolean(sectionAtMarker && marker.index !== 0)
            });
        });
    }

    function rebuildLyricWindow(currentTime) {
        if (!currentTrack) {
            refs.lyrics.replaceChildren();
            lineRegistry = [];
            lyricWindowKey = '';
            return;
        }

        const displayIndex = getDisplayIndex(currentTrack.lyrics, currentTime);
        const visibleIndices = getVisibleIndices(currentTrack.lyrics, displayIndex);
        const nextKey = visibleIndices.join(':');
        if (nextKey === lyricWindowKey) {
            return;
        }

        lyricWindowKey = nextKey;
        lineRegistry = visibleIndices.map((index) => {
            const lyric = currentTrack.lyrics[index];
            const role = getRoleFromOffset(index - displayIndex);
            const line = createElement('div', `visualizer-line visualizer-line--${role}`);
            line.dataset.role = role;
            line.dataset.lineIndex = String(index);

            const wordNodes = lyric.words.map((word, wordIndex) => {
                const node = buildWordNode(word, wordIndex);
                line.appendChild(node);
                return node;
            });

            if (!wordNodes.length) {
                line.textContent = lyric.line || ' ';
            }

            return { lyric, line, role, wordNodes };
        });

        refs.lyrics.replaceChildren(...lineRegistry.map((entry) => entry.line));
    }

    function updateLineStyles(currentTime, featureSample) {
        const beatDuration = currentTrack?.timing?.beatDuration || 0.5;
        const motionEnergy = clamp((featureSample.smoothed * 0.76) + (featureSample.transient * 0.24), 0, 1);
        const hitEnergy = featureSample.transient;

        lineRegistry.forEach((entry) => {
            const line = entry.lyric;
            const role = entry.role;
            const enterLead = Math.max(0.3, Math.min(1.35, line.duration * 0.32 + 0.18));
            const exitTail = Math.max(0.22, Math.min(1.1, line.duration * 0.24 + 0.14));
            const visibleStart = line.startTime - enterLead;
            const visibleEnd = line.endTime + exitTail;
            const preProgress = currentTime < line.startTime
                ? clamp((currentTime - visibleStart) / Math.max(enterLead, 0.001), 0, 1)
                : 1;
            const postProgress = currentTime > line.endTime
                ? clamp(1 - ((currentTime - line.endTime) / Math.max(exitTail, 0.001)), 0, 1)
                : 1;
            const presence = clamp(Math.min(preProgress, postProgress), 0, 1);
            const lineFloatSpeed = ((Math.PI * 2) / Math.max(beatDuration * 2, 0.001)) * (0.18 + (motionEnergy * 0.2));
            const floatPhase = Math.sin(((currentTime - line.startTime) * lineFloatSpeed) + (line.stanzaIndex * 0.7));
            const baseShift = role === 'previous' ? -44 : role === 'current' ? 0 : role === 'next' ? 42 : 82;
            const activeLift = role === 'current' ? floatPhase * (1.2 + (motionEnergy * 4.2) + (hitEnergy * 2.1)) : 0;
            const introShift = (1 - presence) * (role === 'previous' ? -14 : 18);
            const outroShift = currentTime > line.endTime ? (1 - postProgress) * -16 : 0;
            const blur = role === 'current'
                ? (1 - presence) * 9
                : (role === 'future' ? 5 : 2) + ((1 - presence) * 8);
            const opacity = role === 'current'
                ? clamp(0.54 + (presence * 0.38), 0, 0.95)
                : clamp(0.12 + (presence * (role === 'previous' ? 0.28 : 0.36)), 0, 0.52);
            const skew = role === 'current'
                ? (currentTime < line.startTime ? (1 - preProgress) * -2.6 : (1 - postProgress) * 1.8)
                : (role === 'previous' ? -1.6 : 1.2);

            entry.line.style.opacity = opacity.toFixed(3);
            entry.line.style.transform = `translate3d(0, ${baseShift + introShift + outroShift + activeLift}px, 0) skewX(${skew}deg)`;
            entry.line.style.filter = `blur(${Math.max(0, blur).toFixed(2)}px)`;

            entry.wordNodes.forEach((node, wordIndex) => {
                const word = line.words[wordIndex];
                const leadWindow = getWordLeadWindow(word.duration, beatDuration);
                const trailWindow = getWordTrailWindow(word.duration, beatDuration);
                let state = 'pending';
                let translateY = 12;
                let scale = 0.97;
                let opacityWord = role === 'current' ? 0.26 : 0.22;
                let blurWord = 4.8;

                if (currentTime >= word.startTime && currentTime <= word.endTime) {
                    const progress = clamp((currentTime - word.startTime) / Math.max(word.duration, 0.001), 0, 1);
                    const arc = easeInOutSine(progress);
                    state = 'active';
                    translateY = -(6 + (motionEnergy * 10)) * arc
                        - (Math.sin((currentTime * ((Math.PI * 2) / Math.max(beatDuration, 0.001))) + (wordIndex * 0.7)) * (0.6 + (motionEnergy * 1.8) + (hitEnergy * 1.2)));
                    scale = 1 + (arc * (0.05 + (motionEnergy * 0.08) + (hitEnergy * 0.03)));
                    opacityWord = 0.82 + (arc * 0.18);
                    blurWord = 0;
                } else if (currentTime > word.endTime) {
                    const trail = clamp((currentTime - word.endTime) / Math.max(trailWindow, 0.001), 0, 1);
                    state = 'passed';
                    translateY = -6 - (trail * (3 + (motionEnergy * 4)));
                    scale = 1 - (trail * 0.035);
                    opacityWord = role === 'current' ? 0.62 - (trail * 0.16) : 0.42 - (trail * 0.1);
                    blurWord = trail * 0.72;
                } else {
                    const lead = clamp((currentTime - (word.startTime - leadWindow)) / Math.max(leadWindow, 0.001), 0, 1);
                    state = 'pending';
                    const easedLead = easeOutQuad(lead);
                    translateY = (1 - easedLead) * (14 + (motionEnergy * 7));
                    scale = 0.95 + (easedLead * 0.05);
                    opacityWord = role === 'current' ? 0.14 + (easedLead * 0.5) : 0.14 + (easedLead * 0.18);
                    blurWord = (1 - easedLead) * 4.6;
                }

                node.dataset.state = state;
                node.style.opacity = clamp(opacityWord, 0, 1).toFixed(3);
                node.style.transform = `translate3d(0, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;
                node.style.filter = `blur(${Math.max(0, blurWord).toFixed(2)}px)`;
            });
        });
    }

    function setTrack(track) {
        currentTrack = track;
        currentDuration = track?.duration || 0;
        currentAudioFeatures = createSilentFeatureSet(currentDuration);
        lyricWindowKey = '';
        refs.band.textContent = formatBandName(track?.bandName || 'SIOTO JAZZ');
        refs.title.textContent = track?.title || '';
        refs.progressTime.textContent = `0:00 / ${formatTime(track?.duration || 0)}`;
        rebuildProgress();
        rebuildLyricWindow(0);
        renderFrame(0, { duration: currentDuration });
    }

    function setDuration(duration) {
        currentDuration = Math.max(currentTrack?.duration || 0, Number(duration) || 0);
        rebuildProgress();
    }

    function setAudioFeatures(featureSet) {
        currentAudioFeatures = featureSet || createSilentFeatureSet(currentTrack?.duration || 0);
        renderFrame(lastRenderedTime, { duration: lastRenderedDuration || currentDuration });
    }

    function renderFrame(currentTime, { duration } = {}) {
        if (!currentTrack) {
            return;
        }

        if (Number.isFinite(duration)) {
            currentDuration = Math.max(currentTrack.duration || 0, duration);
        }

        const timelineDuration = Math.max(getTimelineDuration(), 0.001);
        const safeTime = clamp(currentTime, 0, timelineDuration);
        const progress = safeTime / timelineDuration;
        const currentSection = findSectionForTime(currentTrack.sections, safeTime);
        const sectionColor = currentSection?.color || '#d76c4d';
        const featureSample = sampleTrackAudioFeatures(currentAudioFeatures, safeTime);
        const sectionTransitionWindow = Math.min(
            Math.max((currentTrack.timing?.barDuration || 0.5) * 0.75, 0.35),
            1.1
        );
        const sectionTransitionStrength = currentSection && currentSection.index > 0
            ? easeOutQuad(
                clamp(
                    1 - (Math.abs(safeTime - currentSection.startTime) / sectionTransitionWindow),
                    0,
                    1
                )
            )
            : 0;

        lastRenderedTime = safeTime;
        lastRenderedDuration = timelineDuration;

        stage.style.setProperty('--playhead-progress', progress.toFixed(5));
        stage.style.setProperty('--section-accent', sectionColor);
        stage.style.setProperty('--section-accent-rgb', hexToRgbChannels(sectionColor));
        stage.style.setProperty('--section-transition-strength', sectionTransitionStrength.toFixed(4));
        refs.progressTime.textContent = `${formatTime(safeTime)} / ${formatTime(timelineDuration)}`;
        refs.progressFill.style.transform = `scaleX(${progress.toFixed(5)})`;
        refs.progressFill.style.opacity = (0.88 + (sectionTransitionStrength * 0.12)).toFixed(3);
        refs.playhead.style.left = `${(progress * 100).toFixed(5)}%`;
        refs.playhead.style.transform = `translateX(-50%) scale(${(1 + (sectionTransitionStrength * 0.16)).toFixed(3)}, ${(1 + (sectionTransitionStrength * 0.08)).toFixed(3)})`;

        segmentRegistry.forEach((entry) => {
            const isActive = currentSection && entry.section.index === currentSection.index;
            entry.node.classList.toggle('is-active', Boolean(isActive));
            entry.node.style.setProperty('--segment-transition-strength', isActive ? sectionTransitionStrength.toFixed(4) : '0');
        });

        markerRegistry.forEach((entry) => {
            const isTransitionMarker = entry.isSectionStart
                && currentSection
                && Math.abs(entry.marker.time - currentSection.startTime) <= 0.001;
            entry.node.style.setProperty(
                '--marker-transition-strength',
                isTransitionMarker ? sectionTransitionStrength.toFixed(4) : '0'
            );
        });

        rebuildLyricWindow(safeTime);
        updateLineStyles(safeTime, featureSample);
    }

    applyFormat(currentFormat.id);

    return {
        getFormat() {
            return currentFormat;
        },
        getTrack() {
            return currentTrack;
        },
        getDuration() {
            return getTimelineDuration();
        },
        setTrack,
        setDuration,
        setAudioFeatures,
        setFormat(formatId) {
            applyFormat(formatId);
        },
        setTime(currentTime, options = {}) {
            renderFrame(currentTime, options);
        },
        isMotionReady() {
            return Boolean(currentAudioFeatures?.samples?.length);
        }
    };
}