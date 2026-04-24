import { loadTrackAudioFeatures } from './visualizer-audio-features.js';
import { getTrackById, getTrackByIndex, loadAlbum } from './visualizer-model.js';
import { createVisualizerStage, getFormatById } from './visualizer-stage.js';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function easeOutQuad(value) {
    return 1 - ((1 - value) * (1 - value));
}

function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function getTrackParam() {
    const params = new URLSearchParams(window.location.search);
    return Number.parseInt(params.get('track'), 10);
}

function getFormatParam() {
    const params = new URLSearchParams(window.location.search);
    return params.get('format') || 'youtube';
}

function setUrlState(trackId, formatId) {
    const url = new URL(window.location.href);
    url.searchParams.set('track', String(trackId));
    url.searchParams.set('format', formatId);
    window.history.replaceState({}, '', url);
}

function formatTrackStatus(track, motionState = 'ready') {
    const base = `${track.id}. ${track.title} | ${track.timing.bpm} BPM | ${track.timing.timeSignature}`;
    if (motionState === 'analyzing') {
        return `${base} | analyzing motion`;
    }
    if (motionState === 'fallback') {
        return `${base} | motion analysis unavailable`;
    }
    return `${base} | motion synced`;
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

function hexToRgbChannels(color) {
    const safeColor = String(color || '#d9d2be').replace('#', '').trim();
    const normalized = safeColor.length === 3
        ? safeColor.split('').map((part) => `${part}${part}`).join('')
        : safeColor.padEnd(6, '0').slice(0, 6);
    const red = Number.parseInt(normalized.slice(0, 2), 16) || 217;
    const green = Number.parseInt(normalized.slice(2, 4), 16) || 210;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) || 190;
    return `${red}, ${green}, ${blue}`;
}

async function bootstrap() {
    const trackList = document.getElementById('visualizer-track-list');
    const previewRoot = document.getElementById('visualizer-preview');
    const playToggle = document.getElementById('visualizer-play-toggle');
    const seekRange = document.getElementById('visualizer-seek');
    const seekSegments = document.getElementById('visualizer-seek-segments');
    const seekMarkers = document.getElementById('visualizer-seek-markers');
    const seekFill = document.getElementById('visualizer-seek-fill');
    const seekPlayhead = document.getElementById('visualizer-seek-playhead');
    const timeReadout = document.getElementById('visualizer-time');
    const status = document.getElementById('visualizer-status');
    const renderRoute = document.getElementById('visualizer-render-route');
    const formatButtons = Array.from(document.querySelectorAll('[data-format-button]'));
    const transportEyebrow = document.querySelector('.visualizer-transport__eyebrow');
    const transportShell = document.querySelector('.visualizer-progress-shell--transport');
    const audio = document.getElementById('visualizer-audio');
    const audioEngine = new window.AudioEngine();
    const stage = createVisualizerStage(previewRoot, { format: getFormatParam() });

    audioEngine.attach(audio);

    let normalizedAlbum = null;
    let currentTrack = null;
    let currentFormat = getFormatById(getFormatParam());
    let animationFrameId = null;
    let isSeekDragging = false;
    let featureLoadToken = 0;
    let transportSegmentRegistry = [];
    let transportMarkerRegistry = [];
    let lastTransportDuration = 0;

    function resetTransportProgress() {
        seekSegments.replaceChildren();
        seekMarkers.replaceChildren();
        seekFill.style.transform = 'scaleX(0)';
        seekFill.style.opacity = '0';
        seekFill.style.background = 'linear-gradient(90deg, rgba(237, 213, 172, 0.18), rgba(237, 213, 172, 0.06))';
        seekPlayhead.style.left = '0%';
        seekPlayhead.style.transform = 'translateX(-50%) scale(1)';
        seekPlayhead.style.setProperty('--transport-progress-rgb', '244, 233, 207');
        if (transportShell) {
            transportShell.style.setProperty('--transport-progress-rgb', '244, 233, 207');
        }
        if (transportEyebrow) {
            transportEyebrow.textContent = 'Playback Timeline';
        }
        transportSegmentRegistry = [];
        transportMarkerRegistry = [];
        lastTransportDuration = 0;
    }

    function rebuildTransportProgress(duration = getTimelineDuration()) {
        seekSegments.replaceChildren();
        seekMarkers.replaceChildren();
        transportSegmentRegistry = [];
        transportMarkerRegistry = [];

        if (!currentTrack) {
            lastTransportDuration = 0;
            return;
        }

        const safeDuration = Math.max(duration || 0, currentTrack.duration || 0, stage.getDuration() || 0, 0.001);
        const sectionMarkerTolerance = (currentTrack.timing?.barDuration || 0.001) * 0.02;
        lastTransportDuration = safeDuration;

        currentTrack.sections.forEach((section) => {
            const segment = document.createElement('div');
            segment.className = 'visualizer-progress__segment';
            segment.style.left = `${(section.startTime / safeDuration) * 100}%`;
            segment.style.width = `${Math.max(0.35, ((section.endTime - section.startTime) / safeDuration) * 100)}%`;
            segment.style.setProperty('--segment-rgb', hexToRgbChannels(section.color));
            segment.title = section.label;
            seekSegments.appendChild(segment);
            transportSegmentRegistry.push({ section, node: segment });
        });

        currentTrack.barMarkers.forEach((marker) => {
            const line = document.createElement('div');
            line.className = 'visualizer-progress__marker visualizer-progress__marker--bar';
            const sectionAtMarker = currentTrack.sections.find((section) => {
                return Math.abs(section.startTime - marker.time) <= sectionMarkerTolerance;
            });

            if (sectionAtMarker && marker.index !== 0) {
                line.classList.add('visualizer-progress__marker--section');
                line.title = sectionAtMarker.label;
            } else {
                line.title = marker.label;
            }

            line.style.left = `${(marker.time / safeDuration) * 100}%`;
            seekMarkers.appendChild(line);
            transportMarkerRegistry.push({
                marker,
                node: line,
                isSectionStart: Boolean(sectionAtMarker && marker.index !== 0)
            });
        });
    }

    function syncTransportProgressStructure(duration) {
        if (!currentTrack) {
            resetTransportProgress();
            return;
        }

        const safeDuration = Math.max(duration || 0, currentTrack.duration || 0, 0.001);
        const durationDrift = Math.abs(safeDuration - lastTransportDuration);
        if (
            durationDrift > 0.01
            || transportSegmentRegistry.length !== currentTrack.sections.length
            || transportMarkerRegistry.length !== currentTrack.barMarkers.length
        ) {
            rebuildTransportProgress(safeDuration);
        }
    }

    function updateTransportProgress(currentTime, duration) {
        if (!currentTrack) {
            resetTransportProgress();
            return;
        }

        const safeDuration = Math.max(duration || 0, currentTrack.duration || 0, 0.001);
        const safeTime = clamp(currentTime, 0, safeDuration);
        const progress = safeTime / safeDuration;
        const currentSection = findSectionForTime(currentTrack.sections, safeTime);
        const sectionColor = currentSection?.color || '#d9d2be';
        const sectionRgb = hexToRgbChannels(sectionColor);
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

        syncTransportProgressStructure(safeDuration);

        seekFill.style.transform = `scaleX(${progress.toFixed(5)})`;
        seekFill.style.opacity = (0.72 + (sectionTransitionStrength * 0.18)).toFixed(3);
        seekFill.style.background = `linear-gradient(90deg, rgba(${sectionRgb}, ${(0.22 + (sectionTransitionStrength * 0.12)).toFixed(3)}), rgba(${sectionRgb}, 0.06))`;
        seekPlayhead.style.left = `${(progress * 100).toFixed(5)}%`;
        seekPlayhead.style.transform = `translateX(-50%) scale(${(1 + (sectionTransitionStrength * 0.18)).toFixed(3)}, ${(1 + (sectionTransitionStrength * 0.08)).toFixed(3)})`;
        seekPlayhead.style.setProperty('--transport-progress-rgb', sectionRgb);

        if (transportShell) {
            transportShell.style.setProperty('--transport-progress-rgb', sectionRgb);
        }

        if (transportEyebrow) {
            transportEyebrow.textContent = currentSection
                ? `Playback Timeline · ${currentSection.label}`
                : 'Playback Timeline';
        }

        transportSegmentRegistry.forEach((entry) => {
            const isActive = currentSection && entry.section.index === currentSection.index;
            entry.node.classList.toggle('is-active', Boolean(isActive));
            entry.node.style.setProperty('--segment-transition-strength', isActive ? sectionTransitionStrength.toFixed(4) : '0');
        });

        transportMarkerRegistry.forEach((entry) => {
            const isTransitionMarker = entry.isSectionStart
                && currentSection
                && Math.abs(entry.marker.time - currentSection.startTime) <= 0.001;
            entry.node.style.setProperty(
                '--marker-transition-strength',
                isTransitionMarker ? sectionTransitionStrength.toFixed(4) : '0'
            );
        });
    }

    function seekToTime(nextTime) {
        if (!currentTrack) {
            return;
        }

        const duration = getTimelineDuration();
        const safeTime = clamp(nextTime, 0, duration || 0);
        audioEngine.seek(safeTime);
        stage.setDuration(duration);
        stage.setTime(safeTime, { duration });
        updateTransportProgress(safeTime, duration);
        seekRange.value = duration ? String((safeTime / duration) * 1000) : '0';
        timeReadout.textContent = `${formatTime(safeTime)} / ${formatTime(duration)}`;
    }

    function seekFromSlider() {
        if (!currentTrack) {
            return;
        }

        const duration = getTimelineDuration();
        const nextTime = (Number(seekRange.value) / 1000) * duration;
        seekToTime(nextTime);
    }

    function getTimelineDuration() {
        return Math.max(currentTrack?.duration || 0, audio.duration || 0, stage.getDuration() || 0);
    }

    function updateRenderRoute() {
        if (!currentTrack) {
            renderRoute.removeAttribute('href');
            return;
        }

        const url = new URL('visualizer-render.html', window.location.href);
        url.searchParams.set('track', String(currentTrack.id));
        url.searchParams.set('format', currentFormat.id);
        renderRoute.href = url.toString();
    }

    function updateFormatButtons() {
        formatButtons.forEach((button) => {
            const isActive = button.dataset.formatButton === currentFormat.id;
            button.classList.toggle('is-active', isActive);
        });
    }

    function updateTrackButtons() {
        Array.from(trackList.querySelectorAll('.visualizer-track-button')).forEach((button) => {
            const isActive = Number(button.dataset.trackId) === currentTrack?.id;
            button.classList.toggle('is-active', isActive);
        });
    }

    function renderCurrentFrame() {
        if (!currentTrack) {
            return;
        }

        const duration = getTimelineDuration();
        const currentTime = clamp(audio.currentTime || 0, 0, duration || 0);
        stage.setDuration(duration);
        stage.setTime(currentTime, { duration });
        updateTransportProgress(currentTime, duration);

        if (!isSeekDragging) {
            seekRange.value = duration ? String((currentTime / duration) * 1000) : '0';
        }

        timeReadout.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }

    function startAnimationLoop() {
        if (animationFrameId) {
            return;
        }

        const tick = () => {
            renderCurrentFrame();
            if (!audio.paused) {
                animationFrameId = window.requestAnimationFrame(tick);
            } else {
                animationFrameId = null;
            }
        };

        animationFrameId = window.requestAnimationFrame(tick);
    }

    function stopAnimationLoop() {
        if (!animationFrameId) {
            return;
        }
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    function setTrack(track, { autoPlay = false } = {}) {
        currentTrack = track;
        featureLoadToken += 1;
        const currentFeatureToken = featureLoadToken;
        audio.src = track.mp3;
        audio.load();
        stage.setTrack(track);
        stage.setFormat(currentFormat.id);
        updateTrackButtons();
        updateRenderRoute();
        setUrlState(track.id, currentFormat.id);
        status.textContent = formatTrackStatus(track, 'analyzing');
        playToggle.textContent = 'Play';
        seekRange.disabled = false;
        lastTransportDuration = 0;
        renderCurrentFrame();

        loadTrackAudioFeatures(track.mp3).then((featureSet) => {
            if (currentFeatureToken !== featureLoadToken || currentTrack?.id !== track.id) {
                return;
            }

            stage.setAudioFeatures(featureSet);
            status.textContent = formatTrackStatus(track, 'ready');
            renderCurrentFrame();
        }).catch(() => {
            if (currentFeatureToken !== featureLoadToken || currentTrack?.id !== track.id) {
                return;
            }

            status.textContent = formatTrackStatus(track, 'fallback');
        });

        if (autoPlay) {
            audioEngine.play().then(() => {
                playToggle.textContent = 'Pause';
                startAnimationLoop();
            }).catch(() => {
                playToggle.textContent = 'Play';
            });
        }
    }

    function buildTrackList() {
        const buttons = normalizedAlbum.tracks.map((track) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'visualizer-track-button';
            button.dataset.trackId = String(track.id);
            button.innerHTML = `
                <span class="visualizer-track-button__index">${track.id}</span>
                <span class="visualizer-track-button__meta">
                    <span class="visualizer-track-button__title">${track.title}</span>
                    <span class="visualizer-track-button__subtitle">${track.timing.bpm} BPM · ${track.timing.timeSignature}</span>
                </span>
            `;
            button.addEventListener('click', () => {
                setTrack(track);
            });
            return button;
        });

        trackList.replaceChildren(...buttons);
    }

    formatButtons.forEach((button) => {
        button.addEventListener('click', () => {
            currentFormat = getFormatById(button.dataset.formatButton);
            stage.setFormat(currentFormat.id);
            updateFormatButtons();
            updateRenderRoute();
            if (currentTrack) {
                setUrlState(currentTrack.id, currentFormat.id);
                renderCurrentFrame();
            }
        });
    });

    playToggle.addEventListener('click', () => {
        if (!currentTrack) {
            return;
        }
        if (audio.paused) {
            audioEngine.play().then(() => {
                playToggle.textContent = 'Pause';
                startAnimationLoop();
            }).catch(() => {
                playToggle.textContent = 'Play';
            });
            return;
        }

        audioEngine.pause();
        playToggle.textContent = 'Play';
        stopAnimationLoop();
        renderCurrentFrame();
    });

    seekRange.addEventListener('pointerdown', () => {
        isSeekDragging = true;
    });

    seekRange.addEventListener('pointerup', () => {
        isSeekDragging = false;
        seekFromSlider();
        renderCurrentFrame();
    });

    seekRange.addEventListener('pointercancel', () => {
        isSeekDragging = false;
    });

    seekRange.addEventListener('change', () => {
        seekFromSlider();
        renderCurrentFrame();
    });

    seekRange.addEventListener('input', () => {
        seekFromSlider();
    });

    audio.addEventListener('play', () => {
        playToggle.textContent = 'Pause';
        startAnimationLoop();
    });

    audio.addEventListener('pause', () => {
        playToggle.textContent = 'Play';
        stopAnimationLoop();
        renderCurrentFrame();
    });

    audio.addEventListener('loadedmetadata', renderCurrentFrame);
    audio.addEventListener('durationchange', renderCurrentFrame);
    audio.addEventListener('seeking', renderCurrentFrame);
    audio.addEventListener('timeupdate', renderCurrentFrame);
    audio.addEventListener('ended', () => {
        playToggle.textContent = 'Play';
        stopAnimationLoop();
        renderCurrentFrame();
    });

    try {
        resetTransportProgress();
        normalizedAlbum = await loadAlbum('album.json');
        buildTrackList();

        const requestedTrack = getTrackById(normalizedAlbum, getTrackParam());
        const initialTrack = requestedTrack || getTrackByIndex(normalizedAlbum, 0);
        currentFormat = getFormatById(getFormatParam());
        updateFormatButtons();

        if (initialTrack) {
            setTrack(initialTrack);
        }
    } catch (error) {
        status.textContent = `Failed to load visualizer data: ${error.message}`;
    }
}

document.getElementById('visualizer-seek').disabled = true;

bootstrap();