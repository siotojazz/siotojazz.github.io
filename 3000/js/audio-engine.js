class AudioEngine {
    constructor() {
        this.context = null;
        this.sourceNode = null;
        this.sourceNodes = new Map();
        this.mediaElement = null;
        this.gainNode = null;
        this.analyserNode = null;
        this.timeDomainData = null;
        this.frequencyData = null;
        this.volume = 1;
    }

    ensureContext() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        }
        if (!this.gainNode) {
            this.gainNode = this.context.createGain();
            this.gainNode.gain.value = this.volume;
            this.analyserNode = this.context.createAnalyser();
            this.analyserNode.fftSize = 2048;
            this.analyserNode.smoothingTimeConstant = 0.72;
            this.gainNode.connect(this.analyserNode);
            this.analyserNode.connect(this.context.destination);
        }
    }

    prime(mediaElement) {
        if (!mediaElement) return null;
        this.ensureContext();

        let sourceNode = this.sourceNodes.get(mediaElement);
        if (!sourceNode) {
            sourceNode = this.context.createMediaElementSource(mediaElement);
            sourceNode.connect(this.gainNode);
            this.sourceNodes.set(mediaElement, sourceNode);
        }

        return sourceNode;
    }

    attach(mediaElement) {
        const sourceNode = this.prime(mediaElement);
        this.mediaElement = mediaElement;
        this.sourceNode = sourceNode;
    }

    getCurrentTime() {
        this.ensureContext();
        return this.context.currentTime;
    }

    createBufferSource(audioBuffer) {
        if (!audioBuffer) return null;
        this.ensureContext();
        const sourceNode = this.context.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(this.gainNode);
        return sourceNode;
    }

    decodeAudioData(arrayBuffer) {
        this.ensureContext();
        return this.context.decodeAudioData(arrayBuffer);
    }

    async resumeContext() {
        if (!this.context) return false;
        if (this.context.state !== 'suspended') {
            return this.context.state === 'running';
        }
        try {
            await this.context.resume();
        } catch (error) {
            console.warn('AudioContext resume failed:', error);
        }
        return this.context.state === 'running';
    }

    async play() {
        this.ensureContext();

        const resumePromise = this.resumeContext();
        const playPromise = this.mediaElement
            ? this.mediaElement.play()
            : Promise.resolve();

        const [, playResult] = await Promise.allSettled([resumePromise, playPromise]);
        if (playResult.status === 'rejected') {
            throw playResult.reason;
        }
        return playResult.value;
    }

    pause() {
        if (this.mediaElement) {
            this.mediaElement.pause();
        }
    }

    stop() {
        if (this.mediaElement) {
            this.mediaElement.pause();
            this.mediaElement.currentTime = 0;
        }
    }

    seek(time) {
        if (this.mediaElement) {
            this.mediaElement.currentTime = time;
        }
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, Number.parseFloat(v) || 0));
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }
    }

    getLiveAnalysis() {
        if (!this.context || !this.analyserNode) {
            return null;
        }

        const fftSize = this.analyserNode.fftSize;
        const binCount = this.analyserNode.frequencyBinCount;

        if (!this.timeDomainData || this.timeDomainData.length !== fftSize) {
            this.timeDomainData = new Float32Array(fftSize);
        }
        if (!this.frequencyData || this.frequencyData.length !== binCount) {
            this.frequencyData = new Uint8Array(binCount);
        }

        this.analyserNode.getFloatTimeDomainData(this.timeDomainData);
        this.analyserNode.getByteFrequencyData(this.frequencyData);

        let peak = 0;
        let energy = 0;
        let clippedSamples = 0;

        for (let index = 0; index < this.timeDomainData.length; index++) {
            const sample = this.timeDomainData[index];
            const magnitude = Math.abs(sample);
            if (magnitude > peak) {
                peak = magnitude;
            }
            energy += sample * sample;
            if (magnitude >= 0.985) {
                clippedSamples++;
            }
        }

        const rms = this.timeDomainData.length ? Math.sqrt(energy / this.timeDomainData.length) : 0;
        const peakDb = peak > 0 ? 20 * Math.log10(peak) : null;
        const rmsDb = rms > 0 ? 20 * Math.log10(rms) : null;
        const crestFactorDb = peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : null;

        const nyquist = this.context.sampleRate / 2;
        let weightedFrequencySum = 0;
        let totalMagnitude = 0;
        let lowMagnitude = 0;
        let midMagnitude = 0;
        let highMagnitude = 0;
        const spectrumBins = [];
        const groupedBinCount = 24;
        const binsPerGroup = Math.max(1, Math.floor(this.frequencyData.length / groupedBinCount));

        for (let index = 0; index < this.frequencyData.length; index++) {
            const normalizedMagnitude = this.frequencyData[index] / 255;
            const frequency = (index / Math.max(1, this.frequencyData.length - 1)) * nyquist;
            weightedFrequencySum += normalizedMagnitude * frequency;
            totalMagnitude += normalizedMagnitude;

            if (frequency < 180) {
                lowMagnitude += normalizedMagnitude;
            } else if (frequency < 2200) {
                midMagnitude += normalizedMagnitude;
            } else {
                highMagnitude += normalizedMagnitude;
            }
        }

        for (let groupIndex = 0; groupIndex < groupedBinCount; groupIndex++) {
            const start = groupIndex * binsPerGroup;
            const end = Math.min(this.frequencyData.length, start + binsPerGroup);
            let groupSum = 0;
            let groupItems = 0;
            for (let index = start; index < end; index++) {
                groupSum += this.frequencyData[index] / 255;
                groupItems++;
            }
            spectrumBins.push(groupItems ? groupSum / groupItems : 0);
        }

        const magnitudeTotal = lowMagnitude + midMagnitude + highMagnitude;

        return {
            peak,
            peakDb,
            rms,
            rmsDb,
            crestFactorDb,
            clippedSamples,
            clipShare: this.timeDomainData.length ? (clippedSamples / this.timeDomainData.length) * 100 : 0,
            spectralCentroidHz: totalMagnitude > 0 ? weightedFrequencySum / totalMagnitude : null,
            lowEnergyPct: magnitudeTotal > 0 ? (lowMagnitude / magnitudeTotal) * 100 : 0,
            midEnergyPct: magnitudeTotal > 0 ? (midMagnitude / magnitudeTotal) * 100 : 0,
            highEnergyPct: magnitudeTotal > 0 ? (highMagnitude / magnitudeTotal) * 100 : 0,
            spectrumBins
        };
    }
}

window.AudioEngine = AudioEngine;
