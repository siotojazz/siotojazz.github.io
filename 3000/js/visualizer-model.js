export let STOCK_VIDEO_LIBRARY = [
    'stock-videos/13458514_1920_1080_30fps.mp4',
    'stock-videos/14086573_3840_2160_60fps.mp4',
    'stock-videos/14170315_1920_1080_24fps.mp4',
    'stock-videos/14395989_3840_2160_30fps.mp4',
    'stock-videos/2776523-uhd_3840_2160_30fps.mp4'
];

const STOCK_VIDEO_MANIFEST_URL = 'stock-videos/manifest.json';
let stockVideoLibraryPromise = null;

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
    intro: '#d7c6a1',
    verse: '#bb8264',
    'pre-chorus': '#d0a15f',
    chorus: '#d9c98d',
    'post-chorus': '#99a7b9',
    bridge: '#6e8398',
    solo: '#8ea08b',
    interlude: '#a39db6',
    breakdown: '#7b828d',
    outro: '#bfb49e',
    other: '#9e9484'
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

    return {
        numerator: Number.isFinite(numerator) && numerator > 0 ? numerator : 4,
        denominator: Number.isFinite(denominator) && denominator > 0 ? denominator : 4,
        isCompoundSix,
        beatsPerBar: isCompoundSix ? 2 : (Number.isFinite(numerator) && numerator > 0 ? numerator : 4)
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

function hashString(input) {
    let hash = 2166136261;
    const safeInput = String(input || '');

    for (let index = 0; index < safeInput.length; index += 1) {
        hash ^= safeInput.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function normalizeVideoPath(entry) {
    const safeEntry = String(entry || '').trim().replace(/\\/g, '/');
    if (!safeEntry || !/\.mp4$/i.test(safeEntry)) {
        return '';
    }

    if (safeEntry.startsWith('stock-videos/')) {
        return safeEntry;
    }

    return `stock-videos/${safeEntry.replace(/^\.\//, '')}`;
}

function normalizeVideoLibrary(entries) {
    return Array.from(new Set((Array.isArray(entries) ? entries : [])
        .map(normalizeVideoPath)
        .filter(Boolean))).sort();
}

async function loadStockVideoLibrary() {
    if (!stockVideoLibraryPromise) {
        stockVideoLibraryPromise = (async () => {
            try {
                const response = await fetch(STOCK_VIDEO_MANIFEST_URL, { cache: 'no-store' });
                if (response.ok) {
                    const manifest = await response.json();
                    const manifestEntries = Array.isArray(manifest)
                        ? manifest
                        : (Array.isArray(manifest?.videos) ? manifest.videos : []);
                    const manifestLibrary = normalizeVideoLibrary(manifestEntries);
                    if (manifestLibrary.length) {
                        STOCK_VIDEO_LIBRARY = manifestLibrary;
                        return manifestLibrary;
                    }
                }
            } catch {
                return STOCK_VIDEO_LIBRARY;
            }

            return STOCK_VIDEO_LIBRARY;
        })();
    }

    return stockVideoLibraryPromise;
}

function selectSeededVideo(track, stockVideoLibrary = STOCK_VIDEO_LIBRARY) {
    if (!stockVideoLibrary.length) {
        return { index: -1, path: '', seed: 0 };
    }

    const seed = hashString(`${track?.id || 0}|${track?.title || ''}|${track?.mp3 || ''}`);
    const index = seed % stockVideoLibrary.length;

    return {
        index,
        path: stockVideoLibrary[index],
        seed
    };
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

function isFiniteNumber(value) {
    return Number.isFinite(Number.parseFloat(value));
}

function normalizeLyrics(lyrics, timing, audioOffset) {
    const source = Array.isArray(lyrics) ? lyrics : [];
    const fallbackLines = source
        .map((entry) => String(entry?.line || '').trim())
        .filter(Boolean);

    if (!fallbackLines.length) {
        return {
            mode: 'empty',
            lines: [],
            fallbackLines: []
        };
    }

    const hasCompleteTiming = source.every((entry) => {
        return isFiniteNumber(entry?.barNumber)
            && isFiniteNumber(entry?.barLength)
            && isFiniteNumber(entry?.offset ?? 0);
    });

    if (!hasCompleteTiming) {
        return {
            mode: 'fallback',
            lines: [],
            fallbackLines
        };
    }

    let stanzaIndex = 0;
    const normalizedLines = source.map((entry, lineIndex) => {
        const barNumber = Math.max(1, Number.parseFloat(entry?.barNumber));
        const barLength = Math.max(0.25, Number.parseFloat(entry?.barLength));
        const offset = Number.parseFloat(entry?.offset) || 0;
        const startTime = audioOffset + ((barNumber - 1) * timing.barDuration) + offset;
        const duration = barLength * timing.barDuration;
        const lyric = {
            index: lineIndex,
            line: String(entry?.line || '').trim(),
            startTime,
            endTime: startTime + duration,
            duration,
            barNumber,
            barLength,
            offset,
            stanzaIndex,
            stanzaEnd: Boolean(entry?.stanzaEnd)
        };

        if (entry?.stanzaEnd) {
            stanzaIndex += 1;
        }

        return lyric;
    });

    return {
        mode: 'synced',
        lines: normalizedLines,
        fallbackLines
    };
}

function getAnalysisAudioUrl(track) {
    const backingTrack = String(track?.backingmp3 || '').trim();
    if (!backingTrack) {
        return track?.mp3 || '';
    }

    if (backingTrack.startsWith('audio/backing/')) {
        return backingTrack;
    }

    if (backingTrack.startsWith('audio/')) {
        return backingTrack.replace(/^audio\//, 'audio/backing/');
    }

    return backingTrack;
}

function normalizeTrack(track, albumMeta = {}, stockVideoLibrary = STOCK_VIDEO_LIBRARY) {
    const timing = getTiming(track?.tempo, track?.timeSignature);
    const audioOffset = Number.parseFloat(track?.audioOffset) || 0;
    let currentBeat = 0;
    const sections = (Array.isArray(track?.structure?.sections) ? track.structure.sections : []).map((section, sectionIndex) => {
        const normalizedSection = normalizeSection(section, sectionIndex, currentBeat, timing);
        currentBeat = normalizedSection.endBeat;
        return normalizedSection;
    });

    const totalBeats = sections.length ? sections[sections.length - 1].endBeat : 0;
    const totalBars = totalBeats / timing.beatsPerBar;
    const estimatedDuration = totalBars * timing.barDuration;
    const normalizedLyrics = normalizeLyrics(track?.lyrics, timing, audioOffset);
    const lyricDuration = normalizedLyrics.lines.reduce((maxDuration, lyric) => {
        return Math.max(maxDuration, lyric.endTime);
    }, 0);
    const duration = Math.max(estimatedDuration, lyricDuration);
    const video = selectSeededVideo(track, stockVideoLibrary);

    return {
        ...track,
        albumTitle: albumMeta.title || '',
        bandName: albumMeta.band || '',
        audioOffset,
        timing,
        sections,
        lyrics: normalizedLyrics.lines,
        lyricsMode: normalizedLyrics.mode,
        lyricFallbackLines: normalizedLyrics.fallbackLines,
        hasSyncedLyrics: normalizedLyrics.mode === 'synced',
        totalBeats,
        totalBars,
        duration,
        estimatedDuration,
        video,
        analysisAudioUrl: getAnalysisAudioUrl(track),
        barMarkers: buildBarMarkers(totalBars, timing),
        sectionPalette: sections.map((section) => ({
            label: section.label,
            type: section.type,
            color: section.color
        }))
    };
}

export function normalizeAlbum(albumData, stockVideoLibrary = STOCK_VIDEO_LIBRARY) {
    const album = albumData?.album || {};
    const tracks = (Array.isArray(albumData?.tracks) ? albumData.tracks.slice() : [])
        .sort((left, right) => (Number(left?.id) || 0) - (Number(right?.id) || 0))
        .map((track, trackIndex) => ({
            ...normalizeTrack(track, album, stockVideoLibrary),
            trackIndex
        }));

    return {
        album,
        tracks,
        trackIndex: new Map(tracks.map((track) => [track.id, track]))
    };
}

export async function loadAlbum(url = 'album.json') {
    const [response, stockVideoLibrary] = await Promise.all([
        fetch(url),
        loadStockVideoLibrary()
    ]);
    if (!response.ok) {
        throw new Error(`Failed to load album data from ${url}: ${response.status}`);
    }

    const albumData = await response.json();
    return normalizeAlbum(albumData, stockVideoLibrary);
}

export function getTrackById(normalizedAlbum, trackId) {
    return normalizedAlbum?.trackIndex?.get?.(trackId) || null;
}

export function getTrackByIndex(normalizedAlbum, index) {
    const tracks = normalizedAlbum?.tracks || [];
    const safeIndex = clamp(index, 0, Math.max(0, tracks.length - 1));
    return tracks[safeIndex] || null;
}