import { loadTrackAudioFeatures } from './visualizer-audio-features.js';
import { getTrackById, getTrackByIndex, loadAlbum } from './visualizer-model.js';
import { createVisualizerStage } from './visualizer-stage.js';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toFiniteNonNegative(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
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
    const initialFormat = params.get('format') === 'instagram' ? 'instagram' : 'youtube';
    const initialSpeed = (() => {
        const value = Number.parseFloat(params.get('speed'));
        return Number.isFinite(value) ? Math.max(0.1, Math.min(2, value)) : 1;
    })();
    const stage = createVisualizerStage(root, { format: initialFormat, mode: 'render' });
    stage.setGlobalSpeed(initialSpeed);
    audio.playbackRate = initialSpeed;

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
        return Math.max(
            toFiniteNonNegative(currentTrack?.duration, 0),
            toFiniteNonNegative(currentDuration, 0),
            toFiniteNonNegative(audio.duration, 0),
            toFiniteNonNegative(stage.getDuration(), 0)
        );
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

        currentDuration = toFiniteNonNegative(currentTrack.duration, 0);
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
        getFormat() {
            return stage.getFormat();
        },
        getSpeed() {
            return audio.playbackRate || 1;
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
        setFormat(formatId) {
            stage.setFormat(formatId);
        },
        setSpeed(speed) {
            const safe = Math.max(0.1, Math.min(2, Number(speed) || 1));
            audio.playbackRate = safe;
            stage.setGlobalSpeed(safe);
        },
        whenReady() {
            return readyPromise;
        },
        async captureToBlob({ fps = 30, duration, mimeType, mimeTypes, videoBitsPerSecond, audioBitsPerSecond, uploadUrl, completeUrl } = {}) {
            await readyPromise;
            const canvas = stage.getCanvas();
            if (!canvas?.captureStream) {
                throw new Error('Canvas captureStream is not supported in this browser.');
            }

            const speed = audio.playbackRate || 1;
            const availableDuration = toFiniteNonNegative(getDuration(), 0);
            const hasDurationOverride = duration !== null && duration !== undefined && Number.isFinite(Number(duration));
            const requestedDuration = hasDurationOverride
                ? Math.max(0.001, toFiniteNonNegative(duration, 0.001))
                : 0;
            const captureDuration = hasDurationOverride
                ? (availableDuration > 0 ? Math.min(requestedDuration, availableDuration) : requestedDuration)
                : availableDuration;

            if (!Number.isFinite(captureDuration) || captureDuration <= 0) {
                throw new Error('Track duration is not ready for capture.');
            }

            audio.pause();
            audio.currentTime = 0;
            await stage.setTime(0, { duration: captureDuration, waitForVideo: true });

            const videoStream = canvas.captureStream(fps);
            let audioTracks = [];
            if (typeof audio.captureStream === 'function') {
                try {
                    audioTracks = audio.captureStream().getAudioTracks();
                } catch {
                    audioTracks = [];
                }
            } else if (typeof audio.mozCaptureStream === 'function') {
                try {
                    audioTracks = audio.mozCaptureStream().getAudioTracks();
                } catch {
                    audioTracks = [];
                }
            }
            const merged = new MediaStream([
                ...videoStream.getVideoTracks(),
                ...audioTracks
            ]);

            const candidateMimeTypes = Array.isArray(mimeTypes) && mimeTypes.length
                ? mimeTypes
                : mimeType
                ? [mimeType]
                : [
                    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
                    'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
                    'video/mp4',
                    'video/webm;codecs=vp9,opus',
                    'video/webm;codecs=vp8,opus',
                    'video/webm'
                ];
            const chosenMimeType = candidateMimeTypes.find((type) => {
                try {
                    return MediaRecorder.isTypeSupported(type);
                } catch {
                    return false;
                }
            });

            if (!chosenMimeType) {
                throw new Error(`No supported MediaRecorder MIME type found: ${candidateMimeTypes.join(', ')}`);
            }

            const recorder = new MediaRecorder(merged, {
                mimeType: chosenMimeType,
                videoBitsPerSecond: videoBitsPerSecond || 12_000_000,
                audioBitsPerSecond: audioBitsPerSecond || 192_000
            });

            const chunks = [];
            let uploadedBytes = 0;
            let uploadChain = Promise.resolve();
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    if (uploadUrl) {
                        uploadChain = uploadChain.then(async () => {
                            const response = await fetch(uploadUrl, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/octet-stream'
                                },
                                body: event.data
                            });

                            if (!response.ok) {
                                throw new Error(`Chunk upload failed with HTTP ${response.status}`);
                            }

                            const payload = await response.json().catch(() => null);
                            uploadedBytes = Number.isFinite(Number(payload?.bytesWritten))
                                ? Number(payload.bytesWritten)
                                : (uploadedBytes + event.data.size);
                        });
                        return;
                    }

                    chunks.push(event.data);
                }
            };
            const stopped = new Promise((resolve, reject) => {
                recorder.onstop = resolve;
                recorder.onerror = (event) => reject(event?.error || new Error('Recorder error'));
            });

            // Drive a tight RAF loop so the canvas keeps repainting (otherwise
            // captureStream goes idle once the audio loop ends).
            stopLoop();
            let recordingActive = true;
            let lastProgressReport = 0;
            const reportProgress = (force = false) => {
                if (typeof window.__visualizerRenderProgress !== 'function') {
                    return;
                }
                const now = performance.now();
                if (!force && now - lastProgressReport < 250) {
                    return;
                }
                lastProgressReport = now;
                const currentTime = clamp(toFiniteNonNegative(audio.currentTime, 0), 0, captureDuration);
                void window.__visualizerRenderProgress({
                    currentTime,
                    duration: captureDuration,
                    progress: clamp(currentTime / Math.max(captureDuration, 0.001), 0, 1)
                });
            };

            let resolveFinished = null;
            const finished = new Promise((resolve) => {
                resolveFinished = resolve;
            });
            const tick = () => {
                if (!recordingActive) {
                    return;
                }
                const currentTime = Math.min(toFiniteNonNegative(audio.currentTime, 0), captureDuration);
                void stage.setTime(currentTime, { duration: captureDuration, isPlaying: !audio.paused });
                reportProgress();
                if (currentTime >= captureDuration) {
                    audio.pause();
                    resolveFinished();
                    return;
                }
                window.requestAnimationFrame(tick);
            };
            window.requestAnimationFrame(tick);

            reportProgress(true);
            recorder.start(250);
            await audio.play();
            audio.addEventListener('ended', resolveFinished, { once: true });
            await finished;
            audio.removeEventListener('ended', resolveFinished);

            await new Promise((resolve) => {
                const handleEnded = () => {
                    audio.removeEventListener('ended', handleEnded);
                    resolve();
                };
                if (audio.paused) {
                    resolve();
                    return;
                }
                audio.addEventListener('ended', handleEnded, { once: true });
            });

            // One last frame so the final lyric/state lands in the recording.
            await stage.setTime(captureDuration, { duration: captureDuration, waitForVideo: false });
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            recordingActive = false;
            reportProgress(true);
            recorder.stop();
            await stopped;
            await uploadChain;

            for (const track of merged.getTracks()) {
                track.stop();
            }
            for (const track of videoStream.getTracks()) {
                track.stop();
            }
            for (const track of audioTracks) {
                track.stop();
            }

            if (uploadUrl) {
                if (!completeUrl) {
                    throw new Error('completeUrl is required when uploadUrl is provided.');
                }

                const response = await fetch(completeUrl, {
                    method: 'POST'
                });

                if (!response.ok) {
                    throw new Error(`Upload finalize failed with HTTP ${response.status}`);
                }

                const payload = await response.json().catch(() => null);
                uploadedBytes = Number.isFinite(Number(payload?.bytesWritten))
                    ? Number(payload.bytesWritten)
                    : uploadedBytes;

                return {
                    mimeType: chosenMimeType,
                    speed,
                    streamed: true,
                    bytesWritten: uploadedBytes
                };
            }

            const blob = new Blob(chunks, { type: chosenMimeType });
            const buffer = await blob.arrayBuffer();
            return {
                mimeType: chosenMimeType,
                speed,
                bytes: Array.from(new Uint8Array(buffer))
            };
        }
    };

    audio.addEventListener('loadedmetadata', () => {
        currentDuration = Math.max(
            toFiniteNonNegative(currentTrack?.duration, 0),
            toFiniteNonNegative(audio.duration, 0)
        );
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