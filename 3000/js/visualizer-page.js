import { loadTrackAudioFeatures } from './visualizer-audio-features.js';
import { getTrackById, getTrackByIndex, loadAlbum } from './visualizer-model.js';
import { createVisualizerStage } from './visualizer-stage.js';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

function setTrackParam(trackId) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('track', String(trackId));
    window.history.replaceState({}, '', nextUrl);
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

function buildRenderArtifacts(track) {
    const slug = slugifyTrackTitle(track);
    const command = `npm --prefix 3000/tools run render -- --track=${track.id} --output=renders/${track.id}-${slug}.mp4`;
    const manifest = {
        trackId: track.id,
        title: track.title,
        bandName: track.bandName,
        audio: track.mp3,
        analysisAudio: track.analysisAudioUrl,
        backgroundVideo: track.video?.path || '',
        lyricMode: track.lyricsMode,
        estimatedDuration: track.duration,
        renderRoute: `visualizer-render.html?track=${track.id}`,
        output: `renders/${track.id}-${slug}.mp4`
    };

    return {
        command,
        manifest
    };
}

function getStatusText(track, state) {
    const lyricSuffix = track.lyricsMode === 'synced' ? 'synced lyrics' : 'lyric fallback';

    if (state === 'loading') {
        return `${track.id}. ${track.title} · loading video and audio features`;
    }

    if (state === 'ready') {
        return `${track.id}. ${track.title} · preview ready · ${lyricSuffix}`;
    }

    if (state === 'feature-fallback') {
        return `${track.id}. ${track.title} · preview ready · audio analysis fallback`;
    }

    return `${track.id}. ${track.title}`;
}

async function bootstrap() {
    const trackList = document.getElementById('visualizer-track-list');
    const previewRoot = document.getElementById('visualizer-preview');
    const status = document.getElementById('visualizer-status');
    const playToggle = document.getElementById('visualizer-play-toggle');
    const seek = document.getElementById('visualizer-seek');
    const timeReadout = document.getElementById('visualizer-time');
    const renderRoute = document.getElementById('visualizer-render-route');
    const renderButton = document.getElementById('visualizer-render-video');
    const outputStatus = document.getElementById('visualizer-output-status');
    const commandPre = document.getElementById('visualizer-render-command');
    const audio = document.getElementById('visualizer-audio');
    const stage = createVisualizerStage(previewRoot, { format: 'youtube', mode: 'preview' });

    let normalizedAlbum = null;
    let currentTrack = null;
    let animationFrameId = null;
    let isScrubbing = false;
    let featureLoadToken = 0;

    function getDuration() {
        return Math.max(currentTrack?.duration || 0, audio.duration || 0, stage.getDuration() || 0);
    }

    function stopLoop() {
        if (!animationFrameId) {
            return;
        }

        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    function renderCurrentFrame() {
        if (!currentTrack) {
            return;
        }

        const duration = Math.max(getDuration(), 0.001);
        const currentTime = clamp(audio.currentTime || 0, 0, duration);
        stage.setDuration(duration);
        void stage.setTime(currentTime, { duration, isPlaying: !audio.paused });

        if (!isScrubbing) {
            seek.value = String(Math.round((currentTime / duration) * 1000));
        }

        if (timeReadout) {
            timeReadout.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        }
    }

    function startLoop() {
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

    function updateTrackButtons() {
        Array.from(trackList.querySelectorAll('.visualizer-track-button')).forEach((button) => {
            const isActive = Number(button.dataset.trackId) === currentTrack?.id;
            button.classList.toggle('is-active', isActive);
        });
    }

    function updateRenderOutputs(track) {
        const artifacts = buildRenderArtifacts(track);
        const routeUrl = new URL('visualizer-render.html', window.location.href);
        routeUrl.searchParams.set('track', String(track.id));
        renderRoute.href = routeUrl.toString();
        commandPre.textContent = `${artifacts.command}\n\n${JSON.stringify(artifacts.manifest, null, 2)}`;
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
                    <span class="visualizer-track-button__meta-line">Seeded video ${track.video.index + 1} · ${track.lyricsMode === 'synced' ? 'synced lyrics' : 'lyric fallback'}</span>
                </span>
            `;
            button.addEventListener('click', () => {
                void setTrack(track);
            });
            return button;
        });

        trackList.replaceChildren(...buttons);
    }

    async function setTrack(track) {
        currentTrack = track;
        featureLoadToken += 1;
        const currentToken = featureLoadToken;

        stopLoop();
        audio.pause();
        audio.src = track.mp3;
        audio.load();
        seek.disabled = false;
        playToggle.textContent = 'Play';
        setTrackParam(track.id);
        stage.setTrack(track);
        updateTrackButtons();
        updateRenderOutputs(track);
        status.textContent = getStatusText(track, 'loading');
        outputStatus.textContent = 'Render command generated for the selected track.';
        renderCurrentFrame();

        try {
            const featurePromise = loadTrackAudioFeatures(track.analysisAudioUrl || track.mp3);
            const [featureSet] = await Promise.all([featurePromise, stage.whenReady()]);

            if (currentToken !== featureLoadToken || currentTrack?.id !== track.id) {
                return;
            }

            stage.setAudioFeatures(featureSet);
            await stage.whenReady();
            status.textContent = getStatusText(track, 'ready');
            renderCurrentFrame();
        } catch {
            if (currentToken !== featureLoadToken || currentTrack?.id !== track.id) {
                return;
            }

            status.textContent = getStatusText(track, 'feature-fallback');
            renderCurrentFrame();
        }
    }

    function seekToSliderPosition() {
        if (!currentTrack) {
            return;
        }

        const duration = Math.max(getDuration(), 0.001);
        const currentTime = (Number(seek.value) / 1000) * duration;
        audio.currentTime = currentTime;
        void stage.setTime(currentTime, { duration, isPlaying: !audio.paused });
        renderCurrentFrame();
    }

    renderButton.addEventListener('click', async () => {
        if (!currentTrack) {
            return;
        }

        const { command } = buildRenderArtifacts(currentTrack);
        updateRenderOutputs(currentTrack);

        try {
            await navigator.clipboard.writeText(command);
            outputStatus.textContent = 'Render command copied to the clipboard. Run it in a terminal to export the MP4.';
        } catch {
            outputStatus.textContent = 'Render command generated below. Run it in a terminal to export the MP4.';
        }
    });

    playToggle.addEventListener('click', async () => {
        if (!currentTrack) {
            return;
        }

        if (audio.paused) {
            try {
                await audio.play();
                playToggle.textContent = 'Pause';
                startLoop();
            } catch {
                playToggle.textContent = 'Play';
            }
            return;
        }

        audio.pause();
        playToggle.textContent = 'Play';
        stopLoop();
        renderCurrentFrame();
    });

    seek.addEventListener('pointerdown', () => {
        isScrubbing = true;
    });

    seek.addEventListener('pointerup', () => {
        isScrubbing = false;
        seekToSliderPosition();
    });

    seek.addEventListener('pointercancel', () => {
        isScrubbing = false;
    });

    seek.addEventListener('input', () => {
        seekToSliderPosition();
    });

    seek.addEventListener('change', () => {
        seekToSliderPosition();
    });

    audio.addEventListener('play', () => {
        playToggle.textContent = 'Pause';
        startLoop();
    });

    audio.addEventListener('pause', () => {
        playToggle.textContent = 'Play';
        stopLoop();
        renderCurrentFrame();
    });

    audio.addEventListener('loadedmetadata', renderCurrentFrame);
    audio.addEventListener('durationchange', renderCurrentFrame);
    audio.addEventListener('seeking', renderCurrentFrame);
    audio.addEventListener('timeupdate', renderCurrentFrame);
    audio.addEventListener('ended', () => {
        playToggle.textContent = 'Play';
        stopLoop();
        renderCurrentFrame();
    });

    try {
        seek.disabled = true;
        normalizedAlbum = await loadAlbum('album.json');
        buildTrackList();

        const initialTrack = getTrackById(normalizedAlbum, getTrackParam()) || getTrackByIndex(normalizedAlbum, 0);
        if (initialTrack) {
            await setTrack(initialTrack);
        }
    } catch (error) {
        status.textContent = `Failed to load visualizer data: ${error.message}`;
        outputStatus.textContent = 'Preview setup failed.';
    }
}

bootstrap();