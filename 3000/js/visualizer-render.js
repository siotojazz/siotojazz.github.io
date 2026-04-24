import { loadTrackAudioFeatures } from './visualizer-audio-features.js';
import { getTrackById, getTrackByIndex, loadAlbum } from './visualizer-model.js';
import { createVisualizerStage, getFormatById } from './visualizer-stage.js';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getNumberParam(params, key, fallback = 0) {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : fallback;
}

async function bootstrap() {
    const params = new URLSearchParams(window.location.search);
    const root = document.getElementById('visualizer-render-root');
    const audio = document.getElementById('visualizer-render-audio');
    const status = document.getElementById('visualizer-render-status');
    const stage = createVisualizerStage(root, { format: params.get('format') || 'youtube' });

    let normalizedAlbum = null;
    let currentTrack = null;
    let currentDuration = 0;
    let animationFrameId = null;
    let audioEngine = null;
    let isReady = false;
    let readyResolver = null;
    const readyPromise = new Promise((resolve) => {
        readyResolver = resolve;
    });

    window.__visualizerRender = {
        getTrack() {
            return currentTrack;
        },
        getDuration() {
            return getDuration();
        },
        setFormat(formatId) {
            applyFormat(formatId);
        },
        setTime(time) {
            renderAt(time);
        },
        isReady() {
            return isReady;
        },
        whenReady() {
            return readyPromise;
        }
    };

    function applyFormat(formatId) {
        const format = getFormatById(formatId);
        stage.setFormat(format.id);
        root.style.width = `${format.width}px`;
        root.style.height = `${format.height}px`;
        return format;
    }

    function getDuration() {
        return Math.max(currentTrack?.duration || 0, currentDuration || 0, audio.duration || 0);
    }

    function renderAt(time) {
        if (!currentTrack) {
            return;
        }
        const duration = getDuration();
        stage.setDuration(duration);
        stage.setTime(clamp(time, 0, duration), { duration });
    }

    function stopLoop() {
        if (!animationFrameId) {
            return;
        }
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    function startLoop() {
        if (animationFrameId) {
            return;
        }

        const tick = () => {
            renderAt(audio.currentTime || 0);
            if (!audio.paused) {
                animationFrameId = window.requestAnimationFrame(tick);
            } else {
                animationFrameId = null;
            }
        };

        animationFrameId = window.requestAnimationFrame(tick);
    }

    try {
        normalizedAlbum = await loadAlbum('album.json');
        const requestedTrackId = Number.parseInt(params.get('track'), 10);
        const requestedFormat = applyFormat(params.get('format') || 'youtube');
        currentTrack = getTrackById(normalizedAlbum, requestedTrackId) || getTrackByIndex(normalizedAlbum, 0);
        currentDuration = currentTrack?.duration || 0;

        if (!currentTrack) {
            throw new Error('No track data available.');
        }

        stage.setTrack(currentTrack);
        status.textContent = `${currentTrack.id}. ${currentTrack.title} | analyzing motion`;
        const featureSet = await loadTrackAudioFeatures(currentTrack.mp3);
        stage.setAudioFeatures(featureSet);
        renderAt(getNumberParam(params, 'time', 0));
        status.textContent = `${currentTrack.id}. ${currentTrack.title} | motion synced`;
        isReady = true;
        readyResolver();

        if (params.get('autoplay') === '1') {
            audioEngine = new window.AudioEngine();
            audioEngine.attach(audio);
            audio.src = currentTrack.mp3;
            audio.load();

            audio.addEventListener('play', startLoop);
            audio.addEventListener('pause', () => {
                stopLoop();
                renderAt(audio.currentTime || 0);
            });
            audio.addEventListener('seeking', () => renderAt(audio.currentTime || 0));
            audio.addEventListener('loadedmetadata', () => {
                currentDuration = Math.max(currentTrack.duration || 0, audio.duration || 0);
                renderAt(audio.currentTime || 0);
            });
            audioEngine.play().catch(() => {
                status.textContent = `${currentTrack.id}. ${currentTrack.title} | autoplay blocked`;
            });
        }
    } catch (error) {
        status.textContent = `Render route error: ${error.message}`;
        readyResolver();
    }
}

bootstrap();