import { loadTrackAudioFeatures } from './visualizer-audio-features.js';
import { getTrackById, getTrackByIndex, loadAlbum } from './visualizer-model.js';
import { createVisualizerStage } from './visualizer-stage.js';

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
    const status = document.getElementById('visualizer-render-status');
    const audio = document.getElementById('visualizer-render-audio');
    const stage = createVisualizerStage(root, { format: 'youtube', mode: 'render' });

    let normalizedAlbum = null;
    let currentTrack = null;
    let currentDuration = 0;
    let animationFrameId = null;
    let isReady = false;
    let readyResolver = null;
    let readyPromise = new Promise((resolve) => {
        readyResolver = resolve;
    });

    status.hidden = false;

    function resetReady() {
        isReady = false;
        readyPromise = new Promise((resolve) => {
            readyResolver = resolve;
        });
    }

    function resolveReady() {
        isReady = true;
        if (readyResolver) {
            readyResolver();
            readyResolver = null;
        }
    }

    function getDuration() {
        return Math.max(currentTrack?.duration || 0, currentDuration || 0, audio.duration || 0, stage.getDuration() || 0);
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
            void stage.setTime(audio.currentTime || 0, { duration: getDuration(), isPlaying: true });
            if (!audio.paused) {
                animationFrameId = window.requestAnimationFrame(tick);
            } else {
                animationFrameId = null;
            }
        };

        animationFrameId = window.requestAnimationFrame(tick);
    }

    async function loadTrackSelection(trackId) {
        resetReady();
        currentTrack = getTrackById(normalizedAlbum, trackId) || getTrackByIndex(normalizedAlbum, 0);

        if (!currentTrack) {
            throw new Error('No track data available.');
        }

        currentDuration = currentTrack.duration || 0;
        stage.setTrack(currentTrack);
        status.textContent = `${currentTrack.id}. ${currentTrack.title} · loading render assets`;

        const featurePromise = loadTrackAudioFeatures(currentTrack.analysisAudioUrl || currentTrack.mp3);
        const [featureSet] = await Promise.all([featurePromise, stage.whenReady()]);
        stage.setAudioFeatures(featureSet);
        await stage.whenReady();

        audio.src = currentTrack.mp3;
        audio.load();
        await stage.setTime(getNumberParam(params, 'time', 0), {
            duration: getDuration(),
            waitForVideo: true
        });

        status.textContent = `${currentTrack.id}. ${currentTrack.title} · render route ready`;
        status.hidden = true;
        resolveReady();
    }

    window.__visualizerRender = {
        getTrack() {
            return currentTrack;
        },
        getDuration() {
            return getDuration();
        },
        async loadTrack(trackId) {
            await loadTrackSelection(Number(trackId));
        },
        isReady() {
            return isReady;
        },
        setTime(time) {
            return stage.setTime(clamp(time, 0, getDuration()), {
                duration: getDuration(),
                waitForVideo: true
            });
        },
        whenReady() {
            return readyPromise;
        }
    };

    audio.addEventListener('loadedmetadata', () => {
        currentDuration = Math.max(currentTrack?.duration || 0, audio.duration || 0);
        stage.setDuration(currentDuration);
    });

    audio.addEventListener('play', startLoop);
    audio.addEventListener('pause', () => {
        stopLoop();
        void stage.setTime(audio.currentTime || 0, { duration: getDuration(), isPlaying: false });
    });
    audio.addEventListener('seeking', () => {
        void stage.setTime(audio.currentTime || 0, { duration: getDuration(), isPlaying: false });
    });

    try {
        normalizedAlbum = await loadAlbum('album.json');
        await loadTrackSelection(Number.parseInt(params.get('track'), 10));

        if (params.get('autoplay') === '1') {
            try {
                await audio.play();
            } catch {
                status.hidden = false;
                status.textContent = `${currentTrack.id}. ${currentTrack.title} · autoplay blocked`;
            }
        }
    } catch (error) {
        status.hidden = false;
        status.textContent = `Render route error: ${error.message}`;
        if (readyResolver) {
            readyResolver();
            readyResolver = null;
        }
    }
}

bootstrap();