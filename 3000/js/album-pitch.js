const albumUrl = 'album.json';
const fallbackMoodboard = [
    'album_cover.png',
    'resources/background.png',
    'resources/background2.png',
    'resources/background3.png'
];

const shell = document.getElementById('pitch-shell');
const audio = document.getElementById('pitch-audio');
const heroCollage = document.getElementById('pitch-hero-collage');
const footerCollage = document.getElementById('pitch-footer-collage');
const heroTags = document.getElementById('pitch-hero-tags');
const titleLabel = document.getElementById('pitch-title-label');
const bandProfile = document.getElementById('band-profile');
const trackReel = document.getElementById('track-reel');
const trackIndex = document.getElementById('track-index');
const productionPulse = document.getElementById('production-pulse');
const ctaActions = document.getElementById('pitch-cta-actions');
const ctaNote = document.getElementById('pitch-cta-note');
const fixedCta = document.getElementById('pitch-fixed-cta');
const noticeModal = document.getElementById('pitch-notice-modal');
const noticeTitle = document.getElementById('pitch-notice-title');
const noticeBody = document.getElementById('pitch-notice-body');
const noticeAccept = document.getElementById('pitch-notice-accept');

let activePreview = null;
let progressFrame = 0;
let audioFadeFrame = 0;
let previewQueue = [];

const previewFadeInDuration = 2000;
const defaultAudioVolume = 1;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function createElement(tagName, className) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    return element;
}

function createIcon(name) {
    const icon = document.createElement('i');
    icon.className = `fa-solid ${name}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function createSrText(text) {
    const span = createElement('span', 'sr-only');
    span.textContent = text;
    return span;
}

function parseClipTime(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, value);
    }

    const raw = String(value || '').trim();
    if (!raw) {
        return fallback;
    }

    const parts = raw.split(':').map((part) => Number.parseFloat(part));
    if (parts.some((part) => !Number.isFinite(part))) {
        const numeric = Number.parseFloat(raw);
        return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
    }

    if (parts.length === 3) {
        return Math.max(0, (parts[0] * 3600) + (parts[1] * 60) + parts[2]);
    }

    if (parts.length === 2) {
        return Math.max(0, (parts[0] * 60) + parts[1]);
    }

    return Math.max(0, parts[0]);
}

function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatIndex(index) {
    return String(index + 1).padStart(2, '0');
}

function appendTrackTitleWithFeature(element, track) {
    element.replaceChildren();

    const title = document.createElement('span');
    title.className = 'track-title__main';
    title.textContent = track.title;
    element.appendChild(title);

    if (track.feature) {
        const feature = document.createElement('span');
        feature.className = 'track-title__feature';
        feature.textContent = track.feature;
        element.appendChild(feature);
    }
}

function containsCyrillic(value) {
    return /[\u0400-\u04FF]/.test(String(value || ''));
}

function getTrackLanguage(track) {
    if (containsCyrillic(track?.title)) {
        return 'Macedonian';
    }

    const hasCyrillicLyrics = Array.isArray(track?.lyrics)
        && track.lyrics.some((line) => containsCyrillic(line?.line));

    return hasCyrillicLyrics ? 'Macedonian' : 'English';
}

function getTrackLanguageFlag(language) {
    return language === 'Macedonian' ? '🇲🇰' : '🇬🇧';
}

function sortPitchTracks(tracks) {
    return tracks.slice().sort((left, right) => {
        const leftRank = getTrackLanguage(left) === 'Macedonian' ? 0 : 1;
        const rightRank = getTrackLanguage(right) === 'Macedonian' ? 0 : 1;
        return leftRank - rightRank || (left.id || 999) - (right.id || 999);
    });
}

function deriveStatus(status) {
    const value = String(status || '').toLowerCase();
    if (value.includes('outtake')) return 'outtake';
    if (value.includes('studio') && value.includes('unmixed')) return 'studio unmixed';
    if (value.includes('demo')) return 'home demo';
    if (value.includes('missing') || value.includes('recorded') || value.includes('mix')) return 'studio demo';
    return 'in progress';
}

function deriveClipScore(status) {
    const value = String(status || '').toLowerCase();
    if (value.includes('outtake')) return 1;
    if (value.includes('reference demo') || value.includes('home demo')) return 2;
    if (value.includes('studio') && value.includes('unmixed')) return 5;
    if (value.includes('studio demo')) return 4;
    return 3;
}

function normalizePitch(data) {
    const pitch = data.pitch || {};
    const moodboard = Array.isArray(pitch.moodboard) && pitch.moodboard.length
        ? pitch.moodboard
        : fallbackMoodboard;

    return {
        contactEmail: pitch.contactEmail || 'siotojazz@gmail.com',
        infoUrl: pitch.infoUrl || '../index.html',
        visualMode: pitch.visualMode || 'moodboard',
        kicker: pitch.kicker || 'Visual album pitch',
        headline: pitch.headline || data.album?.title || '3000',
        workingTitleLabel: pitch.workingTitleLabel || 'Working title of the album',
        subheadline: pitch.subheadline || data.album?.band || 'Sioto Jazz',
        heroTags: Array.isArray(pitch.heroTags) ? pitch.heroTags : [],
        productionPulse: Array.isArray(pitch.productionPulse) ? pitch.productionPulse : [],
        publisherNote: pitch.publisherNote || '',
        previewNotice: pitch.previewNotice || {},
        bandProfile: pitch.bandProfile || {},
        moodboard,
        productionLabels: pitch.productionLabels || {},
        clips: pitch.clips || {}
    };
}

function getClipForTrack(track, pitch, status) {
    const rawClip = pitch.clips[track.title] || pitch.clips[String(track.id)] || pitch.clips[track.id] || {};
    const start = parseClipTime(rawClip.start, 0);
    const end = Math.max(start + 8, parseClipTime(rawClip.end, start + 30));
    const numericScore = Number.parseInt(rawClip.score, 10);
    const score = Number.isFinite(numericScore)
        ? clamp(Math.round(numericScore), 1, 5)
        : deriveClipScore(status || pitch.productionLabels[String(track.id)] || deriveStatus(track.status));

    return {
        start,
        end,
        range: `${formatTime(start)}-${formatTime(end)}`,
        score,
        scoreLabel: `Completion level ${score} of 5`
    };
}

function createClipMeter(score, scoreLabel, options = {}) {
    const meterShell = createElement('div', `clip-meter-shell${options.className ? ` ${options.className}` : ''}`);
    meterShell.setAttribute('role', 'img');
    meterShell.setAttribute('aria-label', scoreLabel);
    meterShell.title = scoreLabel;

    const label = createElement('span', 'clip-meter__label');
    label.textContent = options.label || '';

    const meter = createElement('span', 'clip-meter');
    for (let index = 0; index < 5; index += 1) {
        const bar = createElement('span', 'clip-meter__bar');
        if (index < score) {
            bar.classList.add('is-active');
        }
        meter.append(bar);
    }

    meterShell.append(label, meter);

    return meterShell;
}

function getMoodboardImage(images, index) {
    if (!images.length) {
        return fallbackMoodboard[index % fallbackMoodboard.length];
    }

    return images[index % images.length];
}

function renderCollage(target, images, count, offset = 0) {
    if (!target) return;

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
        const tile = createElement('div', 'pitch-collage__tile');
        const image = document.createElement('img');
        image.src = getMoodboardImage(images, index + offset);
        image.alt = '';
        image.loading = 'lazy';
        tile.append(image);
        fragment.append(tile);
    }
    target.replaceChildren(fragment);
}

function renderHero(data, pitch, tracks) {
    const kicker = document.getElementById('pitch-kicker');
    const title = document.getElementById('pitch-title');
    const subtitle = document.getElementById('pitch-subtitle');
    const label = title.querySelector('#pitch-title-label') || titleLabel;

    kicker.textContent = pitch.kicker;
    if (label) {
        label.textContent = pitch.workingTitleLabel;
        title.replaceChildren(document.createTextNode(`${pitch.headline} `), label);
    } else {
        title.textContent = `${pitch.headline} ${pitch.workingTitleLabel}`;
    }
    subtitle.textContent = pitch.subheadline;

    const tags = pitch.heroTags.length ? pitch.heroTags : [`${tracks.length} tracks`];
    heroTags.replaceChildren(...tags.map((tag) => {
        const item = createElement('span', 'pitch-tag');
        item.textContent = tag;
        return item;
    }));

    document.title = `${data.album?.band || 'Sioto Jazz'} - ${pitch.headline} Album Pitch`;
}

function renderBandProfile(pitch) {
    if (!bandProfile) return;

    const profile = pitch.bandProfile || {};
    const imageWrap = createElement('div', 'band-profile__image');
    const image = document.createElement('img');
    image.src = profile.image || '../extra/photos/SJ_10.JPG';
    image.alt = `${profile.name || 'Sioto Jazz'} band photo`;
    image.loading = 'lazy';
    imageWrap.append(image);

    const body = createElement('div', 'band-profile__body');
    const summary = document.createElement('p');
    summary.className = 'band-profile__summary';
    summary.textContent = profile.summary || 'Sioto Jazz is an alternative rock band from Bitola, Macedonia.';

    const members = createElement('div', 'band-profile__members');
    const memberList = Array.isArray(profile.members) && profile.members.length
        ? profile.members
        : [
            { name: 'Anastasija', instruments: 'lead vocal' },
            { name: 'Martin', instruments: 'guitar, bass, drums, samplers' },
            { name: 'Eva', instruments: 'vocal, guitar' },
            { name: 'Ilija', instruments: 'saxophone' }
        ];
    memberList.forEach((member) => {
        const item = createElement('span', 'band-profile__member');
        const memberName = createElement('span', 'band-profile__member-name');
        const memberInstruments = createElement('span', 'band-profile__member-instruments');

        if (member && typeof member === 'object') {
            memberName.textContent = member.name || '';
            memberInstruments.textContent = member.instruments || '';
        } else {
            const [name, instruments = ''] = String(member || '').split(/\s+-\s+/, 2);
            memberName.textContent = name;
            memberInstruments.textContent = instruments;
        }

        item.append(memberName, memberInstruments);
        members.append(item);
    });

    const note = createElement('div', 'band-profile__note');
    note.textContent = profile.liveNote || 'Rotating players expand the live setup for bass, drums, and sound.';

    body.append(summary, members, note);
    bandProfile.replaceChildren(imageWrap, body);
}

function setButtonState(button, isPlaying, trackTitle) {
    if (!button) return;

    const icon = button.querySelector('i');
    if (icon) {
        icon.className = `fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`;
    }
    button.title = `${isPlaying ? 'Pause' : 'Play'} ${trackTitle} preview`;
    const label = button.querySelector('.sr-only');
    if (label) {
        label.textContent = button.title;
    }
}

function clearProgressFrame() {
    if (progressFrame) {
        window.cancelAnimationFrame(progressFrame);
        progressFrame = 0;
    }
}

function clearAudioFade(resetVolume = true) {
    if (audioFadeFrame) {
        window.cancelAnimationFrame(audioFadeFrame);
        audioFadeFrame = 0;
    }

    if (resetVolume) {
        audio.volume = defaultAudioVolume;
    }
}

function startAudioFadeIn(duration = previewFadeInDuration) {
    clearAudioFade(false);
    audio.volume = 0;

    const fadeStart = performance.now();
    const step = (timestamp) => {
        const progress = clamp((timestamp - fadeStart) / duration, 0, 1);
        audio.volume = defaultAudioVolume * progress;

        if (progress < 1 && !audio.paused) {
            audioFadeFrame = window.requestAnimationFrame(step);
            return;
        }

        audioFadeFrame = 0;
        audio.volume = defaultAudioVolume;
    };

    audioFadeFrame = window.requestAnimationFrame(step);
}

function setActiveVisualState(isPlaying) {
    if (!activePreview) return;
    activePreview.card.classList.toggle('is-active', true);
    activePreview.card.classList.toggle('is-playing', isPlaying);
    setButtonState(activePreview.button, isPlaying, activePreview.track.title);
}

function resetActivePreview(resetProgress = true) {
    clearProgressFrame();
    clearAudioFade();
    if (!activePreview) return;

    activePreview.card.classList.remove('is-active', 'is-playing');
    if (resetProgress) {
        setProgressValue(activePreview.card, activePreview.progressElement, 0);
    }
    setButtonState(activePreview.button, false, activePreview.track.title);
    activePreview = null;
}

function getNextPreviewEntry(trackId) {
    const currentIndex = previewQueue.findIndex((entry) => entry.track.id === trackId);
    if (currentIndex < 0 || currentIndex >= previewQueue.length - 1) {
        return null;
    }

    return previewQueue[currentIndex + 1];
}

function advanceToNextPreview() {
    if (!activePreview) return;

    const currentPreview = activePreview;
    const nextPreview = getNextPreviewEntry(currentPreview.track.id);

    audio.pause();

    if (!nextPreview) {
        const range = getClipPlaybackRange(currentPreview.clip);
        audio.currentTime = range.start;
    }

    resetActivePreview();

    if (!nextPreview) {
        return;
    }

    void startPreview(
        nextPreview.track,
        nextPreview.clip,
        nextPreview.card,
        nextPreview.button,
        nextPreview.progressElement,
        { fadeInFromStart: false }
    );
}

function getClipPlaybackRange(clip) {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        return { start: clip.start, end: clip.end };
    }

    const start = Math.min(clip.start, Math.max(0, audio.duration - 0.2));
    const end = Math.max(start + 0.1, Math.min(clip.end, audio.duration));
    return { start, end };
}

function setProgressValue(card, progressElement, value) {
    const progress = clamp(value, 0, 1);
    card.style.setProperty('--progress', progress.toFixed(4));
    progressElement?.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
}

function updateProgress() {
    if (!activePreview) return;

    const { card, clip, progressElement } = activePreview;
    const range = getClipPlaybackRange(clip);
    const progress = clamp((audio.currentTime - range.start) / Math.max(0.1, range.end - range.start), 0, 1);
    setProgressValue(card, progressElement, progress);

    if (!audio.paused && audio.currentTime >= range.end - 0.05) {
        setProgressValue(card, progressElement, 1);
        advanceToNextPreview();
        return;
    }

    if (!audio.paused) {
        progressFrame = window.requestAnimationFrame(updateProgress);
    }
}

function waitForMetadata() {
    if (audio.readyState >= 1) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            audio.removeEventListener('loadedmetadata', handleLoaded);
            audio.removeEventListener('error', handleError);
        };
        const handleLoaded = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error('Audio metadata failed to load.'));
        };
        audio.addEventListener('loadedmetadata', handleLoaded, { once: true });
        audio.addEventListener('error', handleError, { once: true });
    });
}

function getSeekRatio(progressElement, clientX) {
    const rect = progressElement.getBoundingClientRect();
    if (!rect.width) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
}

async function seekPreviewToRatio(track, clip, card, button, progressElement, ratio) {
    const isCurrentTrack = activePreview?.track.id === track.id;

    if (!isCurrentTrack) {
        await startPreview(track, clip, card, button, progressElement, {
            initialRatio: ratio,
            fadeInFromStart: false
        });
        return;
    } else if (activePreview && !activePreview.progressElement) {
        activePreview.progressElement = progressElement;
    }

    if (activePreview?.track.id !== track.id) return;

    try {
        if (audio.getAttribute('src') !== track.mp3) {
            audio.src = track.mp3;
            audio.load();
        }

        await waitForMetadata();
        const range = getClipPlaybackRange(clip);
        const nextRatio = clamp(ratio, 0, 1);
        if (nextRatio > 0) {
            clearAudioFade();
        }
        const target = range.start + ((range.end - range.start) * nextRatio);
        audio.currentTime = Math.min(target, Math.max(range.start, range.end - 0.05));
        setProgressValue(card, progressElement, nextRatio);

        if (!audio.paused) {
            clearProgressFrame();
            progressFrame = window.requestAnimationFrame(updateProgress);
        }
    } catch {
        resetActivePreview();
    }
}

async function startPreview(track, clip, card, button, progressElement = null, options = {}) {
    const initialRatio = Number.isFinite(options.initialRatio) ? clamp(options.initialRatio, 0, 1) : 0;
    const fadeInFromStart = options.fadeInFromStart !== false;

    if (activePreview?.track.id === track.id && !audio.paused) {
        audio.pause();
        setActiveVisualState(false);
        clearProgressFrame();
        return;
    }

    if (activePreview?.track.id === track.id && audio.paused) {
        try {
            await waitForMetadata();
            const range = getClipPlaybackRange(clip);
            const shouldFadeIn = fadeInFromStart && audio.currentTime <= range.start + 0.05;

            if (shouldFadeIn) {
                audio.volume = 0;
            } else {
                clearAudioFade();
            }

            await audio.play();

            if (shouldFadeIn) {
                startAudioFadeIn();
            }

            setActiveVisualState(true);
            clearProgressFrame();
            progressFrame = window.requestAnimationFrame(updateProgress);
        } catch {
            clearAudioFade();
            setActiveVisualState(false);
        }
        return;
    }

    audio.pause();
    resetActivePreview();
    activePreview = { track, clip, card, button, progressElement };
    setActiveVisualState(false);

    try {
        if (audio.getAttribute('src') !== track.mp3) {
            audio.src = track.mp3;
            audio.load();
        }
        await waitForMetadata();

        const range = getClipPlaybackRange(clip);
        const startTime = range.start + ((range.end - range.start) * initialRatio);
        const shouldFadeIn = fadeInFromStart && initialRatio <= 0;

        audio.currentTime = Math.min(startTime, Math.max(range.start, range.end - 0.05));
        setProgressValue(card, progressElement, initialRatio);

        if (shouldFadeIn) {
            audio.volume = 0;
        } else {
            clearAudioFade();
        }

        await audio.play();

        if (shouldFadeIn) {
            startAudioFadeIn();
        }

        setActiveVisualState(true);
        clearProgressFrame();
        progressFrame = window.requestAnimationFrame(updateProgress);
    } catch {
        clearAudioFade();
        resetActivePreview();
    }
}

function renderTrackReel(tracks, pitch) {
    const fragment = document.createDocumentFragment();
    previewQueue = [];

    tracks.forEach((track, index) => {
        const status = 'studio demo';
        const clip = getClipForTrack(track, pitch, status);
        const card = createElement('article', 'track-preview');
        card.dataset.trackId = String(track.id);
        card.style.setProperty('--progress', '0');

        const image = document.createElement('img');
        image.className = 'track-preview__image';
        image.src = getMoodboardImage(pitch.moodboard, index * 2);
        image.alt = '';
        image.loading = 'lazy';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'track-preview__button';
        button.append(createIcon('fa-play'), createSrText(`Play ${track.title} preview`));
        button.title = `Play ${track.title} preview`;

        const progress = createElement('div', 'track-preview__progress');
        progress.tabIndex = 0;
        progress.setAttribute('role', 'slider');
        progress.setAttribute('aria-label', `Seek ${track.title} preview`);
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        progress.setAttribute('aria-valuenow', '0');
        progress.title = `Seek ${track.title} preview`;

        button.addEventListener('click', () => {
            void startPreview(track, clip, card, button, progress);
        });

        progress.addEventListener('click', (event) => {
            event.stopPropagation();
            void seekPreviewToRatio(track, clip, card, button, progress, getSeekRatio(progress, event.clientX));
        });

        progress.addEventListener('keydown', (event) => {
            const currentProgress = activePreview?.track.id === track.id
                ? (() => {
                    const range = getClipPlaybackRange(clip);
                    return clamp((audio.currentTime - range.start) / Math.max(0.1, range.end - range.start), 0, 1);
                })()
                : Number(card.style.getPropertyValue('--progress')) || 0;
            let nextProgress = currentProgress;

            if (event.key === 'ArrowLeft') nextProgress -= 0.05;
            else if (event.key === 'ArrowRight') nextProgress += 0.05;
            else if (event.key === 'Home') nextProgress = 0;
            else if (event.key === 'End') nextProgress = 1;
            else return;

            event.preventDefault();
            void seekPreviewToRatio(track, clip, card, button, progress, nextProgress);
        });

        const content = createElement('div', 'track-preview__content');
        const number = createElement('span', 'track-preview__index');
        number.textContent = formatIndex(index);
        const title = document.createElement('h3');
        title.className = 'track-preview__title';
        appendTrackTitleWithFeature(title, track);

        content.append(number, title);
        card.append(image, button, content, progress);
        fragment.append(card);
        previewQueue.push({ track, clip, card, button, progressElement: progress });
    });

    trackReel.replaceChildren(fragment);
}

function renderTrackIndex(tracks, pitch) {
    const fragment = document.createDocumentFragment();

    tracks.forEach((track, index) => {
        const status = 'studio demo';
        const clip = getClipForTrack(track, pitch, status);
        const language = getTrackLanguage(track);
        const row = createElement('li', 'track-index__row');
        const number = createElement('span', 'track-index__number');
        number.textContent = formatIndex(index);
        const title = createElement('span', 'track-index__title');
        appendTrackTitleWithFeature(title, track);
        const rowLanguage = createElement('span', 'track-index__language');
        rowLanguage.textContent = language === 'Macedonian' ? 'Macedonian' : '';
        const rowStatus = createElement('span', 'track-index__status');
        rowStatus.textContent = status;
        const rowScore = createClipMeter(clip.score, clip.scoreLabel, {
            className: 'track-index__score'
        });
        const range = createElement('span', 'track-index__range');
        range.textContent = clip.range;
        row.append(number, title, rowLanguage, rowStatus, rowScore, range);
        fragment.append(row);
    });

    trackIndex.replaceChildren(fragment);
}

function renderProductionPulse(tracks, pitch) {
    const items = pitch.productionPulse.length
        ? pitch.productionPulse
        : [
            { label: 'Current status', value: 'Recording complete; delivered for mixing and mastering' },
            { label: 'Written', value: 'February - June 2025' },
            { label: 'Recorded', value: 'September 2025 - May 2026' },
            { label: 'Expected finish date', value: 'Late June - early July' }
        ];

    productionPulse.replaceChildren(...items.map((item, index) => {
        const pulse = createElement('div', `pulse-item${index === 0 ? ' pulse-item--primary' : ''}`);
        const value = document.createElement('strong');
        value.textContent = String(item.value || '');
        const label = document.createElement('span');
        label.textContent = item.label || '';
        pulse.append(value, label);
        return pulse;
    }));
}

function showPreviewNotice(pitch) {
    if (!noticeModal || !noticeTitle || !noticeBody || !noticeAccept) return;

    const notice = pitch.previewNotice || {};
    noticeTitle.textContent = notice.title || 'Private Work Preview';
    noticeBody.textContent = notice.body || 'These excerpts are provided for evaluation only and should not be shared publicly. Tracklist, recordings, mixes, titles, release sequence, and visuals remain subject to change.';

    const closeNotice = () => {
        noticeModal.hidden = true;
        document.body.classList.remove('has-pitch-modal');
        noticeAccept.removeEventListener('click', closeNotice);
    };

    noticeAccept.addEventListener('click', closeNotice);
    document.body.classList.add('has-pitch-modal');
    noticeModal.hidden = false;
    noticeAccept.focus({ preventScroll: true });
}

function renderCta(pitch) {
    const email = pitch.contactEmail || 'siotojazz@gmail.com';
    const publisherNote = String(pitch.publisherNote || '').trim();
    const contact = document.createElement('a');
    contact.className = 'pitch-action';
    contact.href = `mailto:${email}`;
    contact.append(createIcon('fa-envelope'), document.createTextNode(email));

    const info = document.createElement('a');
    info.className = 'pitch-action pitch-action--info';
    info.href = pitch.infoUrl || '../index.html';
    info.target = '_blank';
    info.rel = 'noreferrer';
    const infoText = document.createElement('span');
    infoText.textContent = 'Info page';
    info.append(createIcon('fa-arrow-up-right-from-square'), infoText);

    if (ctaNote) {
        ctaNote.textContent = publisherNote;
        ctaNote.hidden = !publisherNote;
    }

    ctaActions.replaceChildren(contact, info);
    fixedCta?.replaceChildren(contact.cloneNode(true), info.cloneNode(true));
}

function renderError(error) {
    const message = createElement('div', 'pitch-error');
    const content = document.createElement('div');
    const title = document.createElement('h1');
    title.textContent = 'Album pitch unavailable';
    const detail = document.createElement('p');
    detail.textContent = error?.message || 'Could not load album data.';
    content.append(title, detail);
    message.append(content);
    shell.replaceChildren(message);
}

function setupPitchMotion() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealItems = [];

    const registerReveal = (elements, options = {}) => {
        Array.from(elements).forEach((element, index) => {
            element.classList.add('motion-reveal');
            if (options.variant) element.classList.add(`motion-reveal--${options.variant}`);
            element.style.setProperty('--reveal-order', String(options.order?.(index) ?? index));
            revealItems.push(element);
        });
    };

    document.querySelectorAll('.pitch-collage__tile').forEach((tile, index) => {
        tile.style.setProperty('--tile-order', String(index % 16));
    });

    registerReveal(document.querySelectorAll('.pitch-section__header'), { order: () => 0 });
    registerReveal(document.querySelectorAll('.track-preview'), { order: (index) => index % 4 });
    registerReveal(document.querySelectorAll('.track-index__row'), {
        variant: 'left',
        order: (index) => Math.min(index, 6)
    });
    registerReveal(document.querySelectorAll('.band-profile__image'), { variant: 'left', order: () => 0 });
    registerReveal(document.querySelectorAll('.band-profile__body'), { variant: 'scale', order: () => 1 });
    registerReveal(document.querySelectorAll('.pulse-item'), { variant: 'scale', order: (index) => index });
    registerReveal(document.querySelectorAll('.pitch-cta__content'), { variant: 'scale', order: () => 0 });

    window.requestAnimationFrame(() => {
        document.body.classList.add('pitch-loaded');
    });

    if (reducedMotion) {
        revealItems.forEach((item) => item.classList.add('is-revealed'));
        return;
    }

    if ('IntersectionObserver' in window) {
        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-revealed');
                observer.unobserve(entry.target);
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -4% 0px'
        });

        revealItems.forEach((item) => revealObserver.observe(item));
    } else {
        revealItems.forEach((item) => item.classList.add('is-revealed'));
    }

    const trackParallaxImages = Array.from(document.querySelectorAll('.track-preview__image'));
    const bandParallaxImage = document.querySelector('.band-profile__image img');

    const updateElementParallax = (element, strength, limit) => {
        if (!element) return;
        const frame = element.parentElement?.getBoundingClientRect();
        if (!frame || frame.bottom < -120 || frame.top > window.innerHeight + 120) return;
        const centerDelta = (frame.top + frame.height / 2) - window.innerHeight / 2;
        const normalized = centerDelta / Math.max(window.innerHeight, 1);
        const offset = Math.max(-limit, Math.min(limit, normalized * strength));
        element.style.setProperty('--parallax-y', `${offset.toFixed(2)}px`);
    };

    let scrollFrame = 0;
    const updateScrollMotion = () => {
        scrollFrame = 0;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        document.body.style.setProperty('--page-progress', String(Math.min(1, scrollTop / scrollRange)));

        heroCollage?.style.setProperty('--parallax-y', `${Math.min(46, scrollTop * 0.055).toFixed(2)}px`);
        updateElementParallax(footerCollage, -32, 34);
        trackParallaxImages.forEach((image) => updateElementParallax(image, -24, 18));
        updateElementParallax(bandParallaxImage, -38, 30);
    };

    const requestScrollMotion = () => {
        if (scrollFrame) return;
        scrollFrame = window.requestAnimationFrame(updateScrollMotion);
    };

    window.addEventListener('scroll', requestScrollMotion, { passive: true });
    window.addEventListener('resize', requestScrollMotion, { passive: true });
    updateScrollMotion();
}

async function bootstrap() {
    try {
        const response = await fetch(albumUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`album.json returned ${response.status}`);
        }

        const data = await response.json();
        const standardTrackCount = Number.parseInt(data.album?.standardTrackCount, 10);
        const tracks = Array.isArray(data.tracks)
            ? sortPitchTracks(data.tracks.filter((track) => (
                !Number.isFinite(standardTrackCount) || track.id <= standardTrackCount
            )))
            : [];
        const pitch = normalizePitch(data);
        if (pitch.heroTags.length) {
            pitch.heroTags[0] = `${tracks.length} tracks`;
        }

        renderCollage(heroCollage, pitch.moodboard, 16, 0);
        renderCollage(footerCollage, pitch.moodboard, 12, 12);
        renderHero(data, pitch, tracks);
        renderBandProfile(pitch);
        renderTrackReel(tracks, pitch);
        renderTrackIndex(tracks, pitch);
        renderProductionPulse(tracks, pitch);
        renderCta(pitch);
        setupPitchMotion();
        showPreviewNotice(pitch);
    } catch (error) {
        renderError(error);
    }
}

audio.addEventListener('pause', () => {
    clearAudioFade();
    if (activePreview && audio.currentTime < activePreview.clip.end - 0.05) {
        setActiveVisualState(false);
    }
});

audio.addEventListener('ended', () => {
    advanceToNextPreview();
});

window.addEventListener('beforeunload', () => {
    audio.pause();
    clearProgressFrame();
    clearAudioFade();
});

void bootstrap();
