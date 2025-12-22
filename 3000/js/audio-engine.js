class AudioEngine {
    constructor() {
        this.context = null;
        this.sourceNode = null;
        this.mediaElement = null;
        this.gainNode = null;
    }

    attach(mediaElement) {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        }
        this.mediaElement = mediaElement;
        // Create or reuse nodes
        if (!this.sourceNode) {
            this.sourceNode = this.context.createMediaElementSource(this.mediaElement);
            this.gainNode = this.context.createGain();
            this.sourceNode.connect(this.gainNode).connect(this.context.destination);
        }
    }

    async play() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        }
        if (this.context.state === 'suspended') {
            await this.context.resume();
        }
        if (this.mediaElement) {
            return this.mediaElement.play();
        }
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
        if (this.gainNode) {
            this.gainNode.gain.value = v;
        }
    }
}

window.AudioEngine = AudioEngine;
