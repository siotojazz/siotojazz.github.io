const DEFAULT_FEATURE_RATE = 30;
const analysisCache = new Map();

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
    return start + ((end - start) * amount);
}

function getAnalysisContext() {
    if (!window.__visualizerAnalysisContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error('Web Audio API is not available in this browser.');
        }

        window.__visualizerAnalysisContext = new AudioContextClass({ latencyHint: 'playback' });
    }

    return window.__visualizerAnalysisContext;
}

function mixToMono(audioBuffer) {
    const channelCount = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;

    if (channelCount === 1) {
        return audioBuffer.getChannelData(0).slice();
    }

    const mono = new Float32Array(length);
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        const channelData = audioBuffer.getChannelData(channelIndex);
        for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
            mono[sampleIndex] += channelData[sampleIndex];
        }
    }

    const scale = 1 / channelCount;
    for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
        mono[sampleIndex] *= scale;
    }

    return mono;
}

function computeFeatureSamples(signal, sampleRate, featureRate) {
    const duration = signal.length / sampleRate;
    const sampleCount = Math.max(1, Math.ceil(duration * featureRate));
    const frameSize = Math.max(64, Math.floor(sampleRate / featureRate));
    const windowSize = Math.max(frameSize, Math.floor(sampleRate * 0.085));
    const halfWindow = Math.floor(windowSize / 2);

    const rawSamples = [];
    let maxRms = 0;
    let maxPeak = 0;
    let maxTransient = 0;
    let previousRms = 0;

    for (let index = 0; index < sampleCount; index += 1) {
        const time = index / featureRate;
        const centerSample = Math.min(signal.length - 1, Math.floor(time * sampleRate));
        const start = Math.max(0, centerSample - halfWindow);
        const end = Math.min(signal.length, centerSample + halfWindow);
        const length = Math.max(1, end - start);

        let sumSquares = 0;
        let peak = 0;
        for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
            const value = signal[sampleIndex];
            const absolute = Math.abs(value);
            sumSquares += value * value;
            if (absolute > peak) {
                peak = absolute;
            }
        }

        const rms = Math.sqrt(sumSquares / length);
        const transient = Math.max(0, rms - previousRms);
        previousRms = (previousRms * 0.76) + (rms * 0.24);

        maxRms = Math.max(maxRms, rms);
        maxPeak = Math.max(maxPeak, peak);
        maxTransient = Math.max(maxTransient, transient);

        rawSamples.push({
            time,
            rms,
            peak,
            transient
        });
    }

    let smoothed = 0;
    const samples = rawSamples.map((sample) => {
        const normalizedRms = maxRms > 0 ? sample.rms / maxRms : 0;
        const normalizedPeak = maxPeak > 0 ? sample.peak / maxPeak : 0;
        const normalizedTransient = maxTransient > 0 ? sample.transient / maxTransient : 0;
        const loudness = Math.pow(normalizedRms, 0.82);
        smoothed = lerp(smoothed, loudness, 0.22);

        return {
            time: sample.time,
            loudness,
            smoothed,
            peak: normalizedPeak,
            transient: normalizedTransient,
            presence: clamp((loudness * 0.68) + (normalizedPeak * 0.22) + (normalizedTransient * 0.1), 0, 1)
        };
    });

    return {
        duration,
        sampleRate: featureRate,
        samples
    };
}

function buildEmptyFeatures(duration = 0, featureRate = DEFAULT_FEATURE_RATE) {
    return {
        duration,
        sampleRate: featureRate,
        samples: [{
            time: 0,
            loudness: 0,
            smoothed: 0,
            peak: 0,
            transient: 0,
            presence: 0
        }]
    };
}

export async function loadTrackAudioFeatures(audioUrl, { featureRate = DEFAULT_FEATURE_RATE } = {}) {
    const key = `${audioUrl}::${featureRate}`;
    if (!analysisCache.has(key)) {
        analysisCache.set(key, (async () => {
            const context = getAnalysisContext();
            const response = await fetch(audioUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch audio for analysis: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
            const monoSignal = mixToMono(audioBuffer);
            return computeFeatureSamples(monoSignal, audioBuffer.sampleRate, featureRate);
        })().catch((error) => {
            analysisCache.delete(key);
            throw error;
        }));
    }

    return analysisCache.get(key);
}

export function sampleTrackAudioFeatures(featureSet, time) {
    if (!featureSet?.samples?.length) {
        return buildEmptyFeatures().samples[0];
    }

    const duration = Math.max(featureSet.duration || 0, 0);
    const safeTime = clamp(time, 0, duration || time || 0);
    const sampleRate = featureSet.sampleRate || DEFAULT_FEATURE_RATE;
    const exactIndex = safeTime * sampleRate;
    const lowerIndex = clamp(Math.floor(exactIndex), 0, featureSet.samples.length - 1);
    const upperIndex = clamp(Math.ceil(exactIndex), 0, featureSet.samples.length - 1);
    const left = featureSet.samples[lowerIndex];
    const right = featureSet.samples[upperIndex];
    const amount = upperIndex === lowerIndex ? 0 : (exactIndex - lowerIndex) / (upperIndex - lowerIndex);

    return {
        time: safeTime,
        loudness: lerp(left.loudness, right.loudness, amount),
        smoothed: lerp(left.smoothed, right.smoothed, amount),
        peak: lerp(left.peak, right.peak, amount),
        transient: lerp(left.transient, right.transient, amount),
        presence: lerp(left.presence, right.presence, amount)
    };
}

export function createSilentFeatureSet(duration = 0, featureRate = DEFAULT_FEATURE_RATE) {
    return buildEmptyFeatures(duration, featureRate);
}