const SECTION_TYPE_PATTERNS = [
    { type: 'intro', test: /intro/i },
    { type: 'verse', test: /verse/i },
    { type: 'pre-chorus', test: /pre[-\s]?chorus/i },
    { type: 'chorus', test: /chorus/i },
    { type: 'post-chorus', test: /post[-\s]?chorus/i },
    { type: 'bridge', test: /bridge/i },
    { type: 'solo', test: /solo/i },
    { type: 'interlude', test: /interlude/i },
    { type: 'breakdown', test: /breakdown/i },
    { type: 'outro', test: /outro|ending/i }
];

export const SECTION_TYPE_COLORS = {
    intro: '#efe6c8',
    verse: '#d76c4d',
    'pre-chorus': '#e9a03b',
    chorus: '#f2d06b',
    'post-chorus': '#c36d9c',
    bridge: '#6b91c7',
    solo: '#7cb79d',
    interlude: '#a49fca',
    breakdown: '#8c91a4',
    outro: '#d9d2be',
    other: '#b6ae96'
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function parseTempo(rawTempo) {
    const tempo = Number.parseFloat(rawTempo);
    return Number.isFinite(tempo) && tempo > 0 ? tempo : 120;
}

function parseTimeSignature(signature) {
    const [rawNumerator = '4', rawDenominator = '4'] = String(signature || '4/4').split('/');
    const numerator = Number.parseInt(rawNumerator, 10);
    const denominator = Number.parseInt(rawDenominator, 10);
    const isCompoundSix = numerator === 6 && denominator === 8;
    const beatsPerBar = isCompoundSix ? 2 : (Number.isFinite(numerator) && numerator > 0 ? numerator : 4);
    const beatDuration = isCompoundSix ? (60 / parseTempo(120)) : 0;

    return {
        numerator: Number.isFinite(numerator) && numerator > 0 ? numerator : 4,
        denominator: Number.isFinite(denominator) && denominator > 0 ? denominator : 4,
        isCompoundSix,
        beatsPerBar,
        beatDuration
    };
}

function getTiming(tempo, timeSignature) {
    const signature = parseTimeSignature(timeSignature);
    const bpm = parseTempo(tempo);
    const beatDuration = signature.isCompoundSix ? (60 / bpm) * 1.5 : (60 / bpm);

    return {
        bpm,
        timeSignature: `${signature.numerator}/${signature.denominator}`,
        isCompoundSix: signature.isCompoundSix,
        beatsPerBar: signature.beatsPerBar,
        beatDuration,
        barDuration: signature.beatsPerBar * beatDuration
    };
}

function inferSectionType(label) {
    const safeLabel = String(label || '');
    const match = SECTION_TYPE_PATTERNS.find((entry) => entry.test.test(safeLabel));
    return match ? match.type : 'other';
}

function getSectionColor(type) {
    return SECTION_TYPE_COLORS[type] || SECTION_TYPE_COLORS.other;
}

function sanitizeWord(word) {
    return word.replace(/[^\p{L}\p{N}'’-]+/gu, '');
}

function getWordWeight(word) {
    const cleaned = sanitizeWord(word);
    const visibleLength = cleaned.length;
    const punctuationWeight = /[,.!?;:)]$/.test(word) ? 0.18 : 0;
    const bracketWeight = /^[('"“]/.test(word) ? 0.08 : 0;
    const repeatBonus = /(.)\1{2,}$/u.test(cleaned) ? 0.22 : 0;
    return Math.max(0.9, visibleLength * 0.22) + punctuationWeight + bracketWeight + repeatBonus;
}

function getGapWeight(word) {
    if (/[,.!?;:]$/.test(word)) {
        return 0.24;
    }
    if (/[)]$/.test(word)) {
        return 0.18;
    }
    return 0.12;
}

function splitWords(line) {
    return String(line || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function buildWordTimeline(line, startTime, duration) {
    const words = splitWords(line);
    if (!words.length) {
        return [];
    }

    const clampedDuration = Math.max(0.15, duration);
    const wordWeights = words.map(getWordWeight);
    const gapWeights = words.map((word, index) => (index < words.length - 1 ? getGapWeight(word) : 0));
    const totalWeight = wordWeights.reduce((sum, weight) => sum + weight, 0)
        + gapWeights.reduce((sum, weight) => sum + weight, 0);
    const unit = clampedDuration / Math.max(totalWeight, 0.001);

    let cursor = startTime;

    return words.map((word, index) => {
        const wordDuration = wordWeights[index] * unit;
        const gapAfter = gapWeights[index] * unit;
        const wordStart = cursor;
        const wordEnd = wordStart + wordDuration;

        cursor = wordEnd + gapAfter;

        return {
            index,
            word,
            startTime: wordStart,
            endTime: wordEnd,
            duration: wordDuration,
            progressMidpoint: wordStart + (wordDuration * 0.5)
        };
    });
}

function normalizeSection(section, sectionIndex, startBeat, timing) {
    const chords = Array.isArray(section?.chords) ? section.chords.slice() : [];
    const beatCount = chords.length;
    const startBar = startBeat / timing.beatsPerBar;
    const endBeat = startBeat + beatCount;
    const endBar = endBeat / timing.beatsPerBar;
    const type = inferSectionType(section?.label);

    return {
        index: sectionIndex,
        label: section?.label || `Section ${sectionIndex + 1}`,
        type,
        color: getSectionColor(type),
        chords,
        beatCount,
        barCount: beatCount / timing.beatsPerBar,
        startBeat,
        endBeat,
        startBar,
        endBar,
        startTime: startBar * timing.barDuration,
        endTime: endBar * timing.barDuration
    };
}

function normalizeLyrics(lyrics, timing) {
    let stanzaIndex = 0;

    return (Array.isArray(lyrics) ? lyrics : []).map((entry, lineIndex) => {
        const barNumber = Number.parseFloat(entry?.barNumber) || 0;
        const barLength = Math.max(0.25, Number.parseFloat(entry?.barLength) || 1);
        const offset = Number.parseFloat(entry?.offset) || 0;
        const startTime = (barNumber * timing.barDuration) + offset;
        const duration = barLength * timing.barDuration;
        const line = entry?.line || '';
        const wordTimings = buildWordTimeline(line, startTime, duration);
        const lyric = {
            index: lineIndex,
            line,
            barNumber,
            barLength,
            offset,
            startTime,
            endTime: startTime + duration,
            duration,
            stanzaIndex,
            stanzaEnd: Boolean(entry?.stanzaEnd),
            words: wordTimings
        };

        if (entry?.stanzaEnd) {
            stanzaIndex += 1;
        }

        return lyric;
    });
}

function buildBarMarkers(totalBars, timing) {
    const roundedBars = Math.max(0, Math.ceil(totalBars));

    return Array.from({ length: roundedBars + 1 }, (_, index) => ({
        index,
        kind: 'bar',
        label: index === 0 ? 'Start' : `Bar ${index}`,
        time: index * timing.barDuration,
        position: roundedBars ? index / roundedBars : 0
    }));
}

function normalizeTrack(track, albumMeta = {}) {
    const timing = getTiming(track?.tempo, track?.timeSignature);
    let currentBeat = 0;
    const sections = (Array.isArray(track?.structure?.sections) ? track.structure.sections : []).map((section, sectionIndex) => {
        const normalized = normalizeSection(section, sectionIndex, currentBeat, timing);
        currentBeat = normalized.endBeat;
        return normalized;
    });

    const totalBeats = sections.length ? sections[sections.length - 1].endBeat : 0;
    const totalBars = totalBeats / timing.beatsPerBar;
    const estimatedDuration = totalBars * timing.barDuration;
    const lyrics = normalizeLyrics(track?.lyrics, timing);
    const lyricDuration = lyrics.reduce((maxDuration, lyric) => Math.max(maxDuration, lyric.endTime), 0);
    const duration = Math.max(estimatedDuration, lyricDuration);

    return {
        ...track,
        albumTitle: albumMeta.title || '',
        bandName: albumMeta.band || '',
        timing,
        sections,
        lyrics,
        totalBeats,
        totalBars,
        duration,
        estimatedDuration,
        barMarkers: buildBarMarkers(totalBars, timing),
        sectionPalette: sections.map((section) => ({
            label: section.label,
            type: section.type,
            color: section.color
        }))
    };
}

export function normalizeAlbum(albumData) {
    const album = albumData?.album || {};
    const tracks = (Array.isArray(albumData?.tracks) ? albumData.tracks.slice() : [])
        .sort((left, right) => (Number(left?.id) || 0) - (Number(right?.id) || 0))
        .map((track) => normalizeTrack(track, album));

    return {
        album,
        tracks,
        trackIndex: new Map(tracks.map((track) => [track.id, track]))
    };
}

export async function loadAlbum(url = 'album.json') {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load album data from ${url}: ${response.status}`);
    }

    const albumData = await response.json();
    return normalizeAlbum(albumData);
}

export function getTrackById(normalizedAlbum, trackId) {
    return normalizedAlbum?.trackIndex?.get?.(trackId) || null;
}

export function getTrackByIndex(normalizedAlbum, index) {
    const tracks = normalizedAlbum?.tracks || [];
    const safeIndex = clamp(index, 0, Math.max(0, tracks.length - 1));
    return tracks[safeIndex] || null;
}