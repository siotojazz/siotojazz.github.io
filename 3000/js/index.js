    const AUDIO_CACHE_NAME = 'sioto-jazz-audio-v2';
    const audioCacheReady = (async () => {
        if (!('caches' in window)) return null;
        try {
            return await caches.open(AUDIO_CACHE_NAME);
        } catch (error) {
            console.warn('Persistent audio cache is unavailable:', error);
            return null;
        }
    })();

    Promise.all([
        fetch('album.json?v=20260718').then(response => response.json()),
        audioCacheReady
    ])
.then(([data]) => {
    // Enforce desired track order by title
    const desiredOrder = [
        'Импулс',
        'Magic',
        'Time Machine',
        'Нов Зеланд',
        'Higher Ground',
        'Cinema',
        'Колку Далеку?',
        'My Innocent Sea',
        'Quite Unreal',
        'Roots Apart',
        'Одмор'
    ];
    // Prefer ordering by numeric id so album.json id reflects order
    if (Array.isArray(data.tracks)) {
        data.tracks.sort((a, b) => (a.id || 9999) - (b.id || 9999));
        const standardTrackCount = Number.parseInt(data.album?.standardTrackCount, 10);
        if (Number.isFinite(standardTrackCount) && standardTrackCount > 0) {
            data.tracks = data.tracks.slice(0, standardTrackCount);
        }
    }
    renderAlbumTitle(document.getElementById('album-title'));
    const albumBandEl = document.getElementById('album-band');
    if (albumBandEl) {
        albumBandEl.textContent = data.album.band;
    }
    renderAlbumCredits(data);

    const chordMap = new Map(data.chords.map(chordObj => {
        const chordName = Object.keys(chordObj)[0];
        const tab = chordObj[chordName];
        return [chordName, { instructions: tab }];
    }));
    let selectedChordInstrument = 'guitar';
    let selectedCapoFret = 0;

    function generateChordDiagram(chordName, tab) {
        if (!tab || tab.length !== 6 || tab.split('').some(f => f !== 'x' && isNaN(parseInt(f)))) {
            return `    01 02 03 04 05
        e |              
        B |              
        G |              
        D |              
        A |              
        E |              `;
        }

        const strings = ['e', 'B', 'G', 'D', 'A', 'E'];
        let frets = tab.split('').map(f => f.toLowerCase() === 'x' ? 'x' : parseInt(f)).reverse();
        let minFret = Infinity;
        let maxFret = 0;
        frets.forEach(f => {
            if (f !== 'x' && f > 0) {
                minFret = Math.min(minFret, f);
                maxFret = Math.max(maxFret, f);
            }
        });

        if (minFret === Infinity) {
            minFret = 1;
            maxFret = 5;
        }

        const fretRange = 5;
        let startFret = Math.max(1, minFret - 1);
        if (startFret + fretRange - 1 < maxFret) {
            startFret = maxFret - fretRange + 2;
        }

        const fretNumbers = Array.from(
            { length: fretRange },
            (_, i) => (startFret + i).toString().padStart(2, '0')
        ).join(' ');
        let diagram = `    ${fretNumbers}\n`;

        for (let i = 0; i < 6; i++) {
            const fret = frets[i];
            let stringLine = `${strings[i]} | `;
            if (fret === 'x') {
                stringLine += 'x             ';
            } else if (fret === 0) {
                stringLine += '              ';
            } else {
                let content = '              ';
                const relativeFret = fret - startFret;
                if (relativeFret >= 0 && relativeFret < fretRange) {
                    const pos = 1 + relativeFret * 3;
                    content = content.substring(0, pos) + '•' + content.substring(pos + 1);
                }
                stringLine += content;
            }
            diagram += stringLine + '\n';
        }

        return diagram;
    }

    function getPianoChordIntervals(chordName) {
        const normalized = normalizeChordName(chordName);
        const diagramSymbol = normalized.includes('>')
            ? normalized.split('>').pop().trim()
            : normalized.split('/')[0].trim();
        const parsed = parseChordSymbol(diagramSymbol);
        if (!parsed) return [];
        const suffix = parsed.suffix;
        let intervals = [0, 4, 7];
        if (parsed.quality === 'minor') intervals = [0, 3, 7];
        if (parsed.quality === 'diminished') intervals = [0, 3, 6];
        if (parsed.quality === 'augmented') intervals = [0, 4, 8];
        if (parsed.quality === 'power') intervals = [0, 7];
        if (parsed.quality === 'suspended') intervals = /sus2/.test(suffix) ? [0, 2, 7] : [0, 5, 7];
        if (/maj7/.test(suffix)) intervals.push(11);
        else if (/7/.test(suffix)) intervals.push(10);
        if (/add9|add2/.test(suffix)) intervals.push(2);
        if (/6/.test(suffix)) intervals.push(9);
        return [...new Set(intervals)].map(interval => (parsed.rootSemitone + interval) % 12);
    }

    function generatePianoChordDiagram(chordName) {
        const chordTones = getPianoChordIntervals(chordName);
        if (!chordTones.length) {
            return { instructions: 'Piano voicing unavailable', diagram: '' };
        }

        const whiteNotes = [0, 2, 4, 5, 7, 9, 11];
        const blackNotes = [
            { note: 1, x: 18 }, { note: 3, x: 45 }, { note: 6, x: 98 },
            { note: 8, x: 125 }, { note: 10, x: 152 }
        ];
        const whiteKeys = whiteNotes.map((note, index) => `
            <rect x="${index * 27 + 1}" y="1" width="26" height="72" rx="1" fill="${chordTones.includes(note) ? '#8fb7ff' : '#ffffff'}" stroke="#08205e"/>
        `).join('');
        const blackKeys = blackNotes.map(({ note, x }) => `
            <rect x="${x}" y="1" width="17" height="44" rx="1" fill="${chordTones.includes(note) ? '#4c82df' : '#08205e'}" stroke="#08205e"/>
        `).join('');
        const noteNames = chordTones.map(note => SEMITONE_TO_NOTE[note]).join(' · ');
        return {
            instructions: `Piano · ${noteNames}`,
            diagram: `<svg viewBox="0 0 191 74" role="img" aria-label="${normalizeChordName(chordName)} piano keys">${whiteKeys}${blackKeys}</svg>`
        };
    }

    const STRING_INSTRUMENTS = Object.freeze({
        guitar: { label: 'Guitar', strings: ['E', 'A', 'D', 'G', 'B', 'e'], tuning: [4, 9, 2, 7, 11, 4] },
        ukulele: { label: 'Ukulele', strings: ['G', 'C', 'E', 'A'], tuning: [7, 0, 4, 9] },
        bass: { label: 'Bass guitar', strings: ['E', 'A', 'D', 'G'], tuning: [4, 9, 2, 7] },
        violin: { label: 'Violin', strings: ['G', 'D', 'A', 'E'], tuning: [7, 2, 9, 4], fretless: true },
        cello: { label: 'Cello', strings: ['C', 'G', 'D', 'A'], tuning: [0, 7, 2, 9], fretless: true }
    });

    function generateInstrumentVoicing(chordName, instrument) {
        const chordTones = getPianoChordIntervals(chordName);
        if (!chordTones.length) return instrument.tuning.map(() => 'x');
        const unusedTones = new Set(chordTones);
        const usedCounts = new Map();
        return instrument.tuning.map(openNote => {
            const candidates = [];
            for (let fret = 0; fret <= 7; fret += 1) {
                const tone = (openNote + fret) % 12;
                if (!chordTones.includes(tone)) continue;
                candidates.push({
                    fret,
                    tone,
                    score: fret + (unusedTones.has(tone) ? -4 : 0) + (usedCounts.get(tone) || 0) * 2
                });
            }
            candidates.sort((a, b) => a.score - b.score || a.fret - b.fret);
            const chosen = candidates[0];
            if (!chosen) return 'x';
            unusedTones.delete(chosen.tone);
            usedCounts.set(chosen.tone, (usedCounts.get(chosen.tone) || 0) + 1);
            return chosen.fret;
        });
    }

    function generateStringInstrumentDiagram(chordName, instrumentKey) {
        const instrument = STRING_INSTRUMENTS[instrumentKey] || STRING_INSTRUMENTS.guitar;
        const guitarTab = instrumentKey === 'guitar' ? chordMap.get(chordName)?.instructions : '';
        const validGuitarTab = typeof guitarTab === 'string'
            && guitarTab.length === 6
            && [...guitarTab].every(fret => fret.toLowerCase() === 'x' || Number.isFinite(Number.parseInt(fret, 10)));
        let frets = validGuitarTab
            ? [...guitarTab].map(fret => fret.toLowerCase() === 'x' ? 'x' : Number.parseInt(fret, 10))
            : generateInstrumentVoicing(chordName, instrument);
        const chordTones = getPianoChordIntervals(chordName);
        const rootTone = chordTones[0];
        if (instrumentKey === 'bass' && Number.isFinite(rootTone)) {
            const rootCandidates = instrument.tuning.flatMap((openNote, stringIndex) => {
                const candidates = [];
                for (let fret = 0; fret <= 7; fret += 1) {
                    if ((openNote + fret) % 12 === rootTone) candidates.push({ stringIndex, fret });
                }
                return candidates;
            }).sort((a, b) => a.fret - b.fret || a.stringIndex - b.stringIndex);
            frets = instrument.tuning.map(() => 'x');
            if (rootCandidates[0]) frets[rootCandidates[0].stringIndex] = rootCandidates[0].fret;
        }
        const numericFrets = frets.filter(Number.isFinite);
        const fretCount = Math.max(5, Math.min(9, numericFrets.length ? Math.max(...numericFrets) : 5));
        const width = 190;
        const top = 20;
        const fretHeight = 17;
        const nutY = top + fretCount * fretHeight;
        const headstockBottom = nutY + 31;
        const originalHeight = headstockBottom + 12;
        const xStart = 38;
        const xEnd = 168;
        const stringGap = instrument.strings.length > 1 ? (xEnd - xStart) / (instrument.strings.length - 1) : 0;
        const strings = instrument.strings.map((label, index) => {
            // Reverse the native vertical stack so the rotated neck follows
            // standard tablature: highest string on top, lowest on the bottom.
            const x = xEnd - index * stringGap;
            const strokeWidth = instrumentKey === 'bass' ? Math.max(1.2, 3.2 - index * 0.45) : Math.max(0.8, 1.8 - index * 0.13);
            return `<line x1="${x}" y1="${top}" x2="${x}" y2="${nutY}" stroke="#ffffff" stroke-width="${strokeWidth}" opacity="0.9"/><text x="${x}" y="12" fill="#ffffff" text-anchor="middle" font-size="9">${label}</text>`;
        }).join('');
        const guides = Array.from({ length: fretCount + 1 }, (_, index) => {
            const fretNumber = fretCount - index;
            const y = top + index * fretHeight;
            const opacity = instrument.fretless && fretNumber > 0 ? 0.28 : 0.75;
            return `<line x1="${xStart}" y1="${y}" x2="${xEnd}" y2="${y}" stroke="#ffffff" stroke-width="${fretNumber === 0 ? 3 : 1}" opacity="${opacity}"/>`;
        }).join('');
        const markers = frets.map((fret, index) => {
            const x = xEnd - index * stringGap;
            if (fret === 'x') return `<text x="${x}" y="${nutY + 20}" fill="#ffffff" text-anchor="middle" font-size="12">×</text>`;
            if (fret === 0) return `<circle cx="${x}" cy="${nutY + 17}" r="5" fill="none" stroke="#ffffff" stroke-width="1.5"/>`;
            const y = nutY - (fret - 0.5) * fretHeight;
            const note = (instrument.tuning[index] + fret) % 12;
            const isRoot = note === rootTone;
            return `<circle cx="${x}" cy="${y}" r="6.5" fill="${isRoot ? '#ffd166' : '#8fb7ff'}" stroke="#08205e" stroke-width="1.5"/><text x="${x}" y="${y + 3}" fill="#08205e" text-anchor="middle" font-size="7" font-weight="700">${SEMITONE_TO_NOTE[note]}</text>`;
        }).join('');
        const headstock = `<path d="M${xStart} ${nutY} L${xEnd} ${nutY} L${xEnd + 8} ${nutY + 16} Q${width / 2} ${headstockBottom + 8} ${xStart - 8} ${nutY + 16} Z" fill="rgba(255,255,255,0.1)" stroke="#ffffff" stroke-width="1"/>`;
        const positionFrets = numericFrets.filter(fret => fret > 0);
        const positionFret = positionFrets.length && Math.min(...positionFrets) > 3 ? Math.min(...positionFrets) : 0;
        const positionY = positionFret ? nutY - positionFret * fretHeight : 0;
        const positionMarker = positionFret
            ? `<line x1="${xStart - 3}" y1="${positionY}" x2="${xEnd + 3}" y2="${positionY}" stroke="#8fb7ff" stroke-width="3"/>`
            : '';
        const positionNumber = positionFret
            ? `<text x="${originalHeight - positionY}" y="186" fill="#8fb7ff" text-anchor="middle" font-size="9" font-weight="800">${positionFret}</text>`
            : '';
        const capoMarker = selectedCapoFret > 0
            ? `<line x1="${xStart - 3}" y1="${nutY + 6}" x2="${xEnd + 3}" y2="${nutY + 6}" stroke="#ffd166" stroke-width="5"/>`
            : '';
        const capoNumber = selectedCapoFret > 0
            ? `<text x="${originalHeight - nutY - 6}" y="186" fill="#ffd166" text-anchor="middle" font-size="10" font-weight="800">${selectedCapoFret}</text>`
            : '';
        const instruction = instrumentKey === 'bass' && Number.isFinite(rootTone)
            ? `${instrument.label} · ${SEMITONE_TO_NOTE[rootTone]} single note`
            : `${instrument.label}${selectedCapoFret > 0 ? ` · capo ${selectedCapoFret}` : ''} · ${frets.join(' ')}`;
        const diagramContent = `${guides}${strings}${headstock}${positionMarker}${capoMarker}${markers}`;
        return {
            instructions: instruction,
            diagram: `<svg viewBox="0 0 ${originalHeight} ${width}" role="img" aria-label="${normalizeChordName(chordName)} ${instrument.label} fingering, rotated 90 degrees clockwise"><g transform="translate(${originalHeight} 0) rotate(90)">${diagramContent}</g>${positionNumber}${capoNumber}</svg>`
        };
    }

    function getChordPresentation(chordName) {
        if (selectedChordInstrument === 'piano') {
            return { ...generatePianoChordDiagram(chordName), isHtml: true };
        }
        return { ...generateStringInstrumentDiagram(chordName, selectedChordInstrument), isHtml: true };
    }

    function getSlotChordNames(chordName) {
        return String(chordName || '')
            .split('>')
            .map(name => name.trim())
            .filter(Boolean);
    }

    function renderChordSlotLabel(chordElement, chordName) {
        const chordLabel = chordElement?.querySelector('.chord');
        if (!chordLabel) return;
        const slotChordNames = getSlotChordNames(chordName);
        const isSequence = slotChordNames.length > 1;
        chordElement.classList.toggle('has-chord-sequence', isSequence);
        chordLabel.classList.toggle('chord-sequence-label', isSequence);
        chordLabel.style.setProperty('--slot-label-count', Math.max(1, slotChordNames.length));
        if (!isSequence) {
            chordLabel.textContent = slotChordNames[0] || 'N/A';
            return;
        }
        chordLabel.replaceChildren(...slotChordNames.map(slotChordName => {
            const chordPart = document.createElement('span');
            chordPart.className = 'chord-sequence-label__chord';
            chordPart.textContent = slotChordName;
            return chordPart;
        }));
    }

    function getChordSlotAriaLabel(chordName) {
        const chordNames = getSlotChordNames(chordName);
        const chordDescription = chordNames.length > 1
            ? `${chordNames.join(', then ')}. Play all ${chordNames.length} chords in this slot.`
            : `${chordNames[0] || 'N/A'} chord.`;
        return `${chordDescription} Hover or tap for ${selectedChordInstrument} diagram.`;
    }

    function renderChordPresentation(chordElement, chordName) {
        if (!chordElement) return;
        const chordNames = getSlotChordNames(chordName);
        const presentation = getChordPresentation(chordNames[0] || chordName);
        const value = chordElement.querySelector('.chord-value');
        const diagram = chordElement.querySelector('.chord-diagram');
        if (value) {
            const instrumentLabel = selectedChordInstrument === 'piano'
                ? 'Piano'
                : (STRING_INSTRUMENTS[selectedChordInstrument]?.label || 'Guitar');
            value.textContent = chordNames.length > 1
                ? `Play all ${chordNames.length} chords in this slot · ${instrumentLabel}`
                : presentation.instructions;
        }
        if (diagram) {
            diagram.classList.toggle('is-chord-sequence', chordNames.length > 1);
            diagram.style.setProperty('--slot-chord-count', Math.max(1, chordNames.length));
            if (chordNames.length > 1) {
                diagram.replaceChildren(...chordNames.map((name, index) => {
                    const chordPresentation = getChordPresentation(name);
                    const item = document.createElement('span');
                    item.className = 'slot-chord-diagram';
                    const label = document.createElement('span');
                    label.className = 'slot-chord-diagram__label';
                    label.textContent = `${index + 1}. ${name}`;
                    const artwork = document.createElement('span');
                    artwork.innerHTML = chordPresentation.diagram;
                    item.append(label, artwork);
                    return item;
                }));
            } else if (presentation.isHtml) {
                diagram.innerHTML = presentation.diagram;
            } else {
                diagram.textContent = presentation.diagram;
            }
        }
    }

    function positionMobileChordPreview(chordElement) {
        if (!chordElement || !window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
        const preview = chordElement.querySelector('.chord-preview');
        if (!preview || !chordElement.classList.contains('is-diagram-open')) return;

        const margin = 8;
        const gap = 8;
        const anchorRect = chordElement.getBoundingClientRect();
        const previewRect = preview.getBoundingClientRect();
        const previewWidth = previewRect.width || 244;
        const previewHeight = previewRect.height || 210;
        const halfWidth = previewWidth / 2;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const panelRect = chordElement.closest('.tab-panel')?.getBoundingClientRect();
        const usableTop = panelRect ? Math.max(margin, panelRect.top + margin) : margin;
        const playerTop = playerBasic?.getBoundingClientRect().top;
        const panelBottom = panelRect ? Math.min(viewportHeight - margin, panelRect.bottom - margin) : viewportHeight - margin;
        const usableBottom = Number.isFinite(playerTop) && playerTop > anchorRect.bottom
            ? Math.min(panelBottom, playerTop - margin)
            : panelBottom;

        const anchorCenter = anchorRect.left + anchorRect.width / 2;
        const left = Math.max(margin + halfWidth, Math.min(viewportWidth - margin - halfWidth, anchorCenter));
        const topPosition = anchorRect.top - gap - previewHeight;
        const bottomPosition = anchorRect.bottom + gap;
        let top;

        if (topPosition >= usableTop) {
            top = topPosition;
        } else if (bottomPosition + previewHeight <= usableBottom) {
            top = bottomPosition;
        } else {
            top = Math.max(usableTop, Math.min(topPosition, usableBottom - previewHeight));
        }

        preview.style.setProperty('--chord-preview-left', `${left}px`);
        preview.style.setProperty('--chord-preview-top', `${top}px`);

        // A transformed tab panel becomes the containing block for fixed descendants.
        // Correct from that local coordinate space back to the requested viewport point.
        const positionedRect = preview.getBoundingClientRect();
        const positionedCenter = positionedRect.left + positionedRect.width / 2;
        const correctedLeft = left + (left - positionedCenter);
        const correctedTop = top + (top - positionedRect.top);
        preview.style.setProperty('--chord-preview-left', `${correctedLeft}px`);
        preview.style.setProperty('--chord-preview-top', `${correctedTop}px`);
    }

    function getTrackStatusLabel(status) {
        return typeof status === 'string' ? status.trim().replace(/\s+/g, ' ') : '';
    }

    function getTrackStatusKey(status) {
        return getTrackStatusLabel(status)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function setupResponsiveAlbumCover() {
        if (!albumCoverImage) return;

        const smallSource = albumCoverImage.dataset.smallSrc || 'album_cover_500x500.webp';
        const fullSource = albumCoverImage.dataset.fullSrc || 'album_cover_1000x1000.webp';
        let queued = false;

        const updateCoverSource = () => {
            queued = false;
            const rect = albumCoverImage.getBoundingClientRect();
            const renderedSize = Math.max(rect.width || 0, rect.height || 0);
            const nextSource = renderedSize > 500 ? fullSource : smallSource;
            if (!albumCoverImage.getAttribute('src')?.endsWith(nextSource)) {
                albumCoverImage.src = nextSource;
            }
        };

        const queueUpdate = () => {
            if (!deferredPageMediaReleased) return;
            if (queued) return;
            queued = true;
            window.requestAnimationFrame(updateCoverSource);
        };

        queueAlbumCoverSourceUpdate = queueUpdate;

        if (window.ResizeObserver) {
            new ResizeObserver(queueUpdate).observe(albumCoverImage.parentElement || albumCoverImage);
        } else {
            window.addEventListener('resize', queueUpdate);
        }

        queueUpdate();
    }

    const songList = document.getElementById('song-list');
    const albumTotalTime = document.getElementById('album-total-time');
    const player = document.getElementById('player');
    const playerBasic = document.getElementById('player-basic');
    const albumCoverImage = document.getElementById('album-cover-image');
    let deferredPageMediaReleased = false;
    let queueAlbumCoverSourceUpdate = () => {};
    const songInfoHost = document.getElementById('song-info-host');
    const lyricsWaveformCanvas = document.getElementById('lyrics-waveform');
    const LIVE_LYRICS_WAVEFORM_WINDOW_BARS = 4;
    const LIVE_LYRICS_WAVEFORM_FALLBACK_SECONDS = 8;
    const LIVE_LYRICS_WAVEFORM_CURRENT_ANCHOR = 0.5;
    const LIVE_LYRICS_WAVEFORM_FRAME_INTERVAL = 16;
    const liveWaveformDino = document.getElementById('live-waveform-dino');
    const dinosaurAnimationFiles = new Map([
        ['dancin_dino.png', 'dancin_dino.webp'],
        ['dancin_dino_slow.png', 'dancin_dino_slow.webp'],
        ['dancin_dino_headbang.png', 'dancin_dino_headbang.webp']
    ]);
    function updateLiveWaveformDinosaur(track) {
        if (!liveWaveformDino) return;
        const requestedFile = track?.dinosaurAnimation;
        const spriteFile = dinosaurAnimationFiles.get(requestedFile) || 'dancin_dino.webp';
        const dinoSpriteUrl = new URL(spriteFile, document.baseURI);
        liveWaveformDino.style.backgroundImage = `url("${dinoSpriteUrl.href}")`;
    }
    let audio = document.getElementById('audio-player');
    // Web Audio remains the sample-accurate transport everywhere. On mobile, a
    // silent HTMLMediaElement keeps the OS media session and lock-screen controls alive.
    const useMobileMediaSessionAnchor = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let mediaSessionAnchorUrl = '';
    let mediaSessionAnchorExpectedPause = false;
    let mediaSessionAnchorStartedAt = 0;
    const seekCanvas = document.getElementById('seek-gl');
    const seekSectionTooltip = document.getElementById('seek-section-tooltip');
    let seekSectionTooltipHideTimer = 0;
    const glSeek = createSeekRenderer(seekCanvas);
    const audioEngine = new AudioEngine();
    configureManagedAudioElement(audio, { standby: false });
    let standbyAudio = createGaplessAudioElement();
    const toggleBtn = playerBasic.querySelector('.toggle-btn');
    const prevTrackBtn = playerBasic.querySelector('.prev-track-btn');
    const nextTrackBtn = playerBasic.querySelector('.next-track-btn');
    const prevSectionBtn = playerBasic.querySelector('.prev-section-btn');
    const nextSectionBtn = playerBasic.querySelector('.next-section-btn');
    const volumeControl = document.getElementById('volume-control');
    const volumeBtn = document.getElementById('volume-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const loopModeBtn = document.getElementById('loop-mode-btn');
    const chordInstrument = document.getElementById('chord-instrument');
    const chordCapo = document.getElementById('chord-capo');
    const tempoDino = document.getElementById('tempo-dino');
    const versionToggle = document.getElementById('version-toggle');
    const versionToggleLabel = versionToggle?.querySelector('.version-toggle__label');
    const versionToggleMessage = document.getElementById('version-toggle-message');
    const timeline = playerBasic.querySelector('.player-timeline');
    const seekBar = null;
    const seekFill = null;
    const lyricsContent = player.querySelector('.lyrics-content');
    const structureContent = player.querySelector('.structure-content');
    const currentSongNameDisplay = document.getElementById('current-song-name');
    const currentLyricDisplay = playerBasic.querySelector('.current-lyric');
    const liveLyricsDisplay = document.getElementById('live-lyrics');
    const lyricsPanel = document.getElementById('tab-lyrics');
    let lastLiveLyricIndex = -1;
    let lastLiveLyricAnchorIndex = 0;
    const playerWrap = document.querySelector('.player-wrap');
    const moodboardEl = document.querySelector('.moodboard');
    const appContainer = document.querySelector('.app-container');
    const telemetryGrid = document.getElementById('telemetry-grid');
    const telemetryRecommendations = document.getElementById('telemetry-recommendations');
    const telemetrySongs = document.getElementById('telemetry-songs');
    const telemetryStatus = document.getElementById('telemetry-status');
    const telemetryLiveTitle = document.getElementById('telemetry-live-title');
    const telemetryLiveMeta = document.getElementById('telemetry-live-meta');
    const telemetryLiveTime = document.getElementById('telemetry-live-time');
    const telemetryLiveProgressFill = document.getElementById('telemetry-live-progress-fill');
    const telemetryLivePeak = document.getElementById('telemetry-live-peak');
    const telemetryLiveRms = document.getElementById('telemetry-live-rms');
    const telemetryLiveCrest = document.getElementById('telemetry-live-crest');
    const telemetryLiveCentroid = document.getElementById('telemetry-live-centroid');
    const telemetryLiveLow = document.getElementById('telemetry-live-low');
    const telemetryLiveHigh = document.getElementById('telemetry-live-high');
    const telemetryLivePeakHold = document.getElementById('telemetry-live-peak-hold');
    const telemetryLiveRmsAvg = document.getElementById('telemetry-live-rms-avg');
    const telemetryLiveCrestAvg = document.getElementById('telemetry-live-crest-avg');
    const telemetryLiveCentroidAvg = document.getElementById('telemetry-live-centroid-avg');
    const telemetryLiveClipPressure = document.getElementById('telemetry-live-clip-pressure');
    const telemetryLiveBassTilt = document.getElementById('telemetry-live-bass-tilt');
    const telemetryLiveRmsSwing = document.getElementById('telemetry-live-rms-swing');
    const telemetryLiveBrightnessDrift = document.getElementById('telemetry-live-brightness-drift');
    const telemetryLiveReferences = {
        peak: document.getElementById('telemetry-live-peak-ref'),
        rms: document.getElementById('telemetry-live-rms-ref'),
        crest: document.getElementById('telemetry-live-crest-ref'),
        centroid: document.getElementById('telemetry-live-centroid-ref'),
        low: document.getElementById('telemetry-live-low-ref'),
        high: document.getElementById('telemetry-live-high-ref'),
        peakHold: document.getElementById('telemetry-live-peak-hold-ref'),
        rmsAvg: document.getElementById('telemetry-live-rms-avg-ref'),
        crestAvg: document.getElementById('telemetry-live-crest-avg-ref'),
        centroidAvg: document.getElementById('telemetry-live-centroid-avg-ref'),
        clipPressure: document.getElementById('telemetry-live-clip-pressure-ref'),
        bassTilt: document.getElementById('telemetry-live-bass-tilt-ref'),
        rmsSwing: document.getElementById('telemetry-live-rms-swing-ref'),
        brightnessDrift: document.getElementById('telemetry-live-brightness-drift-ref')
    };
    const telemetryLiveSpectrum = document.getElementById('telemetry-live-spectrum');
    const telemetryEnabled = Boolean(document.querySelector('.tab-btn[data-tab="telemetry"]'));
    const createSongMotifForTrack = window.SiotoJazzSongMotifs?.createSongMotif
        || (() => document.createElement('span'));
    const audioPreloader = document.getElementById('audio-preloader');
    const audioPreloaderMeta = document.getElementById('audio-preloader-meta');
    const audioPreloaderBar = document.getElementById('audio-preloader-bar');
    const audioPreloaderCanvas = document.getElementById('audio-preloader-gl');
    const audioPreloaderPercent = document.getElementById('audio-preloader-percent');
    const audioPreloaderRacingDino = document.getElementById('audio-preloader-racing-dino');
    const audioPreloaderAudioButton = document.getElementById('audio-preloader-audio-button');
    let racingDinoTargetProgress = 0;
    let racingDinoDisplayedProgress = 0;
    let racingDinoVelocity = 0;

    function setRacingDinoTargetProgress(progress) {
        const nextProgress = Math.max(0, Math.min(1, Number.parseFloat(progress) || 0));
        racingDinoTargetProgress = Math.max(racingDinoTargetProgress, nextProgress);
    }

    if (audioPreloaderRacingDino) {
        const racingDinoUrl = new URL('racing_dino.webp', document.baseURI);
        audioPreloaderRacingDino.style.backgroundImage = `url("${racingDinoUrl.href}")`;

        const racingFrameDuration = 1000 / 6;
        const racingDinoTrack = audioPreloaderRacingDino.parentElement;
        let racingFrame = 0;
        let lastRacingFrameAt = 0;
        let lastRacingMotionAt = 0;
        let racingDinoTravelDistance = 0;
        const updateRacingDinoTravelDistance = () => {
            const trackWidth = racingDinoTrack?.getBoundingClientRect().width || 0;
            const dinoWidth = audioPreloaderRacingDino.getBoundingClientRect().width || 0;
            racingDinoTravelDistance = Math.max(
                0,
                trackWidth - dinoWidth
            );
        };
        updateRacingDinoTravelDistance();
        if (window.ResizeObserver && racingDinoTrack) {
            new ResizeObserver(updateRacingDinoTravelDistance).observe(racingDinoTrack);
        } else {
            window.addEventListener('resize', updateRacingDinoTravelDistance);
        }
        const animateRacingDino = timestamp => {
            if (!document.body.classList.contains('is-audio-preloading')) return;
            if (!lastRacingFrameAt) lastRacingFrameAt = timestamp;
            if (!lastRacingMotionAt) lastRacingMotionAt = timestamp;
            const motionDelta = Math.min(0.05, Math.max(0, (timestamp - lastRacingMotionAt) / 1000));
            lastRacingMotionAt = timestamp;
            const remainingDistance = Math.max(0, racingDinoTargetProgress - racingDinoDisplayedProgress);
            const cruiseSpeed = 0.42;
            const acceleration = 0.72;
            const deceleration = 1.1;
            const stoppingDistance = (racingDinoVelocity * racingDinoVelocity) / (2 * deceleration);

            if (remainingDistance <= 0.0001) {
                racingDinoDisplayedProgress = racingDinoTargetProgress;
                racingDinoVelocity = 0;
            } else {
                const isApproachingTarget = remainingDistance <= Math.max(0.004, stoppingDistance * 1.08);
                racingDinoVelocity = isApproachingTarget
                    ? Math.max(0, racingDinoVelocity - deceleration * motionDelta)
                    : Math.min(cruiseSpeed, racingDinoVelocity + acceleration * motionDelta);
                const motionStep = racingDinoVelocity * motionDelta;
                if (motionStep >= remainingDistance) {
                    racingDinoDisplayedProgress = racingDinoTargetProgress;
                    racingDinoVelocity = 0;
                } else {
                    racingDinoDisplayedProgress += motionStep;
                }
            }
            const displayedPosition = racingDinoDisplayedProgress * racingDinoTravelDistance;
            audioPreloaderRacingDino.style.transform = `translate3d(${displayedPosition}px, 0, 0)`;
            const elapsed = timestamp - lastRacingFrameAt;
            if (elapsed >= racingFrameDuration) {
                const elapsedFrames = Math.floor(elapsed / racingFrameDuration);
                racingFrame = (racingFrame + elapsedFrames) % 36;
                lastRacingFrameAt += elapsedFrames * racingFrameDuration;
                const racingColumn = racingFrame % 6;
                const racingRow = Math.floor(racingFrame / 6);
                audioPreloaderRacingDino.style.backgroundPosition = `${racingColumn * 20}% ${racingRow * 20}%`;
            }
            requestAnimationFrame(animateRacingDino);
        };
        requestAnimationFrame(animateRacingDino);
    }
    const glPreload = audioPreloaderCanvas
        ? createSeekRenderer(audioPreloaderCanvas)
        : { render: () => {}, setSections: () => {} };
    const LOADING_UI_EXIT_DURATION_MS = 900;
    const TITLE_CARD_REVEAL_DURATION_MS = 6000;
    const CINEMATIC_REVEAL_DURATION_MS = LOADING_UI_EXIT_DURATION_MS + TITLE_CARD_REVEAL_DURATION_MS;
    const REDUCED_LOADING_UI_EXIT_DURATION_MS = 250;
    const REDUCED_TITLE_CARD_REVEAL_DURATION_MS = 6000;
    const REDUCED_CINEMATIC_REVEAL_DURATION_MS = REDUCED_LOADING_UI_EXIT_DURATION_MS + REDUCED_TITLE_CARD_REVEAL_DURATION_MS;
    const ALBUM_PRELOAD_MAX_CONCURRENCY = 2;
    const ALBUM_PRELOAD_SAVE_DATA_CONCURRENCY = 1;
    const trackDurations = new Map();
    data.tracks.forEach((track, trackIndex) => {
        const declaredDuration = Number.parseFloat(track.duration);
        if (Number.isFinite(declaredDuration) && declaredDuration > 0) {
            trackDurations.set(trackIndex, declaredDuration);
        }
    });
    const trackAudioAnalysis = new Map();
    const versionAvailability = new Map();
    const versionLeadingSilence = new Map();
    const trackDaniSources = new Map();
    const durationFailures = new Set();
    const audioAnalysisFailures = new Set();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const NEXT_TRACK_PRELOAD_AHEAD_SECONDS = 24;
    const GAPLESS_READY_TIMEOUT_MS = 1200;
    const GAPLESS_BUFFER_SECONDS = 1.5;
    const GAPLESS_READY_STATE = window.HTMLMediaElement?.HAVE_FUTURE_DATA || 3;
    const MEDIA_SESSION_SEEK_SECONDS = 10;
    const MEDIA_SESSION_POSITION_UPDATE_MS = 1000;
    const WEB_AUDIO_START_DELAY_SECONDS = 0.04;
    let knownAudioOutputDevices = new Map();
    let gaplessPrepareToken = 0;
    let gaplessPreparedTrack = null;
    let gaplessTransitioning = false;
    let selectSongLoadToken = 0;
    const decodedAudioBuffers = new Map();
    const decodedAudioBufferPromises = new Map();
    const preloadedTrackAudio = new Map();
    const trackPreloadPromises = new Map();
    const preloadedTrackByteLengths = new Map();
    const preloadTrackByteTotals = new Map();
    const preloadTrackLoadedBytes = new Map();
    let audioPreloaderSkipped = false;
    let audioRevealPromise = null;
    const trackPlaybackTrims = new Map();
    const stitchedTrackStarts = [];
    let stitchedAlbumDuration = 0;
    let scheduledGaplessBuffer = null;
    const bufferPlayback = {
        active: false,
        track: null,
        trackIndex: -1,
        source: '',
        audioBuffer: null,
        sourceNode: null,
        startedAt: 0,
        duration: 0,
        version: ''
    };
    const webAudioPlayback = {
        playing: false,
        startContextTime: 0,
        startAlbumTime: 0,
        pausedAlbumTime: 0,
        scheduledSources: [],
        scheduleToken: 0
    };

    function appendTrackTitleParts(container, trackIndex, track) {
        container.replaceChildren();
        if (!track) return;

        const main = document.createElement('span');
        main.className = 'song-title__main';
        main.textContent = `${trackIndex + 1} ${track.title}`;
        container.appendChild(main);

        if (track.feature) {
            const feature = document.createElement('span');
            feature.className = 'song-feature';
            feature.textContent = track.feature;
            container.appendChild(feature);
        }
    }

    function updatePlayerSongMotif(track, trackIndex) {
        if (!currentSongNameDisplay) return;

        currentSongNameDisplay.replaceChildren();
        currentSongNameDisplay.classList.toggle('has-player-motif', Boolean(track));

        if (!track) return;

        const main = document.createElement('span');
        main.className = 'current-song-name__main';
        main.textContent = `${trackIndex + 1} ${track.title}`;
        currentSongNameDisplay.appendChild(main);

        if (track.feature) {
            const feature = document.createElement('span');
            feature.className = 'current-song-name__feature';
            feature.textContent = track.feature;
            currentSongNameDisplay.appendChild(feature);
        }

        const motif = createSongMotifForTrack(trackIndex);
        motif.classList.add('song-motif--player');
        currentSongNameDisplay.appendChild(motif);
    }

    function updateAlbumTotalTime() {
        const resolvedTrackCount = trackDurations.size + durationFailures.size;
        if (resolvedTrackCount < data.tracks.length) return;
        let totalSeconds = 0;
        trackDurations.forEach((duration, trackIndex) => {
            if (trackIndex >= 0 && trackIndex < data.tracks.length) {
                totalSeconds += duration;
            }
        });
        albumTotalTime.textContent = formatTime(totalSeconds);
    }

    function getSongLengthElement(trackIndex) {
        return songList?.querySelector(`.song-item[data-track-index="${trackIndex}"] .song-length`) || null;
    }

    function setSongDurationDisplay(trackIndex) {
        const songLength = getSongLengthElement(trackIndex);
        if (!songLength) return;

        const songItem = songLength.closest('.song-item');
        songItem?.classList.remove('is-audio-loading');
        songLength.classList.remove('is-loading');
        songLength.removeAttribute('data-loading-percent');
        songLength.removeAttribute('aria-label');

        const duration = getTrackAudioDuration(trackIndex);
        if (Number.isFinite(duration) && duration > 0) {
            songLength.textContent = formatTime(duration);
        } else if (durationFailures.has(trackIndex)) {
            songLength.textContent = '0:00';
        } else {
            songLength.textContent = '--:--';
        }
    }

    function getTrackPreloadPercent(trackIndex) {
        if (preloadedTrackAudio.has(trackIndex)) return 100;

        const loadedBytes = getPreloadTrackLoadedBytes(trackIndex);
        const totalBytes = getEstimatedPreloadTrackBytes(trackIndex);
        if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;

        return Math.max(0, Math.min(99, Math.round((loadedBytes / totalBytes) * 100)));
    }

    function updateSongPreloadIndicator(trackIndex) {
        const songLength = getSongLengthElement(trackIndex);
        if (!songLength) return;

        if (preloadedTrackAudio.has(trackIndex) || durationFailures.has(trackIndex)) {
            setSongDurationDisplay(trackIndex);
            return;
        }

        if (!audioPreloaderSkipped) return;

        const percent = getTrackPreloadPercent(trackIndex);
        const songItem = songLength.closest('.song-item');
        const title = data.tracks[trackIndex]?.title || `song ${trackIndex + 1}`;
        songItem?.classList.add('is-audio-loading');
        songLength.classList.add('is-loading');
        songLength.dataset.loadingPercent = String(percent);
        songLength.textContent = `${percent}%`;
        songLength.setAttribute('aria-label', `${title} audio ${percent}% loaded`);
    }

    function refreshSongPreloadIndicators() {
        data.tracks.forEach((track, trackIndex) => {
            updateSongPreloadIndicator(trackIndex);
        });
    }
    const NOTE_TO_SEMITONE = Object.freeze({
        'C': 0,
        'C#': 1,
        'Db': 1,
        'D': 2,
        'D#': 3,
        'Eb': 3,
        'E': 4,
        'Fb': 4,
        'E#': 5,
        'F': 5,
        'F#': 6,
        'Gb': 6,
        'G': 7,
        'G#': 8,
        'Ab': 8,
        'A': 9,
        'A#': 10,
        'Bb': 10,
        'B': 11,
        'Cb': 11
    });
    const SEMITONE_TO_NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const LYRIC_STOPWORDS = new Set([
        'the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'are', 'our', 'out', 'all', 'but', 'can', 'know', 'like', 'into', 'there', 'they', 'them', 'then', 'where', 'what', 'when', 'will', 'just', 'still', 'again', 'only', 'have', 'from', 'down', 'near', 'away', 'been', 'cuz', 'hey',
        'its', 'it', 'ive', 'ill', 'cant', 'wont', 'youre', 'someone', 'maybe', 'still', 'gotta', 'oughta',
        'и', 'во', 'не', 'се', 'те', 'од', 'на', 'со', 'до', 'за', 'само', 'таму', 'една', 'еден', 'сосема', 'има', 'по', 'го', 'то', 'ја', 'ќе', 'што', 'како', 'сум', 'си', 'сме', 'сте', 'ова', 'оваа', 'оној', 'овај', 'сега', 'таму', 'тука', 'еден', 'едно', 'едни',
        'оооо', 'ооооо', 'аааа', 'ааааа', 'aaaa', 'oooo'
    ]);
    const KEY_CANDIDATES = Array.from({ length: 12 }, (_, tonic) => ([
        {
            tonic,
            mode: 'major',
            label: `${SEMITONE_TO_NOTE[tonic]} major`,
            scale: [0, 2, 4, 5, 7, 9, 11],
            qualities: ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished']
        },
        {
            tonic,
            mode: 'minor',
            label: `${SEMITONE_TO_NOTE[tonic]} minor`,
            scale: [0, 2, 3, 5, 7, 8, 10],
            qualities: ['minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major']
        }
    ])).flat();
    let telemetryAudioScanStarted = false;
    let telemetryAudioScanComplete = false;
    let telemetryAudioContext = null;
    const LIVE_TELEMETRY_WINDOW_MS = 8000;
    const liveTelemetryHistory = [];
    let liveTelemetryTrackIndex = -1;
    let liveTelemetryLastSampleAt = 0;
    let lastLiveAnalysisSnapshot = null;

    if (telemetryLiveSpectrum) {
        telemetryLiveSpectrum.innerHTML = Array.from({ length: 24 }, () => '<span class="telemetry-live-spectrum-bar"></span>').join('');
    }
    const telemetryLiveSpectrumBars = telemetryLiveSpectrum
        ? Array.from(telemetryLiveSpectrum.children)
        : [];

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderAlbumTitle(target) {
        if (!target) return;
        target.innerHTML = `
            <span class="album-title-line album-title-line--en">In a Race Against Time</span>
            <span class="album-title-line album-title-line--mk">Во Трка со Времето</span>
        `;
        syncStackedAlbumTitle(target);
    }

    function syncStackedAlbumTitle(target) {
        if (!target) return;
        const english = target.querySelector('.album-title-line--en, .credits-title-line--en');
        const macedonian = target.querySelector('.album-title-line--mk, .credits-title-line--mk');
        if (!english || !macedonian) return;

        macedonian.style.letterSpacing = '0px';
        const letterGaps = Math.max((macedonian.textContent || '').trim().length - 1, 1);
        const targetWidth = english.getBoundingClientRect().width;
        let spacing = Math.max(0, (targetWidth - macedonian.getBoundingClientRect().width) / letterGaps);
        for (let i = 0; i < 3; i += 1) {
            macedonian.style.letterSpacing = `${spacing}px`;
            spacing = Math.max(0, spacing + ((targetWidth - macedonian.getBoundingClientRect().width) / letterGaps));
        }
        macedonian.style.letterSpacing = `${spacing}px`;
    }

    function renderAlbumCredits(albumData) {
        const creditsContent = document.getElementById('credits-content');
        if (!creditsContent) return;

        creditsContent.innerHTML = `
            <section class="credits-language" lang="en" aria-labelledby="credits-english-heading">
                <h3 class="credits-language-title" id="credits-english-heading">English</h3>
                <div class="credits-copy">
                    <p>All songs written by Sioto Jazz. All lyrics written by Martin Petkovski.</p>
                    <p>Produced, mixed and mastered by Martin Petkovski.</p>
                    <p>Cover photography by Tomi Akimovski.</p>
                    <p>Recorded by Martin Petkovski at Kamai Sobata Dolu and Daniel Mitrevski at Studio Atelier, March 2025 - July 2026. All instruments played by Martin Petkovski except where noted.</p>
                    <p>Vocals: Anastasija Trajkovska (tracks 1, 2, 3, 4, 5, 7, 9, 10), Eva Todorovska (tracks 6, 8), Krste Rodjevski (track 3). Backing vocals on tracks 4 and 7 by Irena Dimovska-Mitrevska.</p>
                    <p>Saxophone on tracks 1, 4, 5, 9 by Ilija Volcheski. Strings on tracks 8 and 10 by Tanja Kotevska.</p>
                    <p>Special thanks to Dino the dino for winning against time, Blagojche Aceski and Gorazd Hristovski for their creative contributions, Tomi Akimovski for executively producing track 3, Zoki Parket and Dimitar Zhirov for lending us secret equipment, Martin's mom and dad for obvious reasons, Marija Stojkovska (hypegirl #1), Andre Butorac (hypeman #1), Andrej Bogatinoski for being the glue in times of need, Marija Nedelkovska for being cool, Petar Kotevski for being aggressively honest, and Gordon Downie - you were ahead by a century.</p>
                    <p>Executive producer: Martin Petkovski</p>
                    <p>&copy; 2026 Sioto Jazz. All rights reserved.</p>
                    <p>Created in Bitola, Macedonia</p>
                </div>
            </section>
            <hr class="credits-divider" aria-hidden="true">
            <section class="credits-language" lang="mk" aria-labelledby="credits-macedonian-heading">
                <h3 class="credits-language-title" id="credits-macedonian-heading">Македонски</h3>
                <div class="credits-copy">
                    <p>Сите песни се напишани од Sioto Jazz. Сите текстови се напишани од Мартин Петковски.</p>
                    <p>Продукција, микс и мастеринг: Мартин Петковски.</p>
                    <p>Фотографија за обвивката: Томи Акимовски.</p>
                    <p>Снимано од Мартин Петковски во Камај Собата Долу и од Даниел Митревски во Studio Atelier, Март 2025 - Јули 2026. Сите инструменти ги отсвири Мартин Петковски, освен каде што е наведено поинаку.</p>
                    <p>Вокали: Анастасија Трајковска (песни 1, 2, 3, 4, 5, 7, 9, 10), Ева Тодоровска (песни 6, 8), Крсте Роџевски (песна 3). Придружни вокали на песни 4 и 7: Ирена Димовска-Митревска.</p>
                    <p>Саксофон на песни 1, 4, 5, 9: Илија Волчески. Жичани инструменти на песни 8 и 10: Тања Котевска.</p>
                    <p>Посебна благодарност до Дино диносаурусот затоа што победува во трката со времето, Благојче Ацески и Горазд Христовски за нивниот креативен придонес, Томи Акимовски за извршното продуцентство на песна 3, Зоки Паркет и Димитар Жиров за тоа што ни позајмија тајна опрема, мајка му и татко му на Мартин од очигледни причини, Марија Стојковска (хајпчупе #1), Андре Буторац (хајпчоек #1), Андреј Богатиноски затоа што е лепакот во најпотребните моменти, Марија Неделковска затоа што е кул, Петар Котевски затоа што е агресивно искрен, и Гордон Дауни - ти беше за век понапред.</p>
                    <p>Извршен продуцент: Мартин Петковски.</p>
                    <p>&copy; 2026 Сиото Џез. Сите права се задржани.</p>
                    <p>Создадено во Битола, Македонија</p>
                </div>
            </section>
        `;
    } 

    const resyncAlbumTitles = () => {
        syncStackedAlbumTitle(document.getElementById('album-title'));
        syncStackedAlbumTitle(document.getElementById('credits-heading'));
    };
    if (document.fonts?.ready) {
        document.fonts.ready.then(resyncAlbumTitles);
    }
    window.addEventListener('resize', resyncAlbumTitles);

    function normalizeWorldCoordinates(value) {
        if (typeof value !== 'string') return '';
        const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
        if (!match) return '';
        return `${match[1]},${match[2]}`;
    }

    function formatMomentLabel(value) {
        if (!value) return 'moment n/a';
        if (value === 'TBD') return 'TBD';

        const momentDate = new Date(value);
        if (Number.isNaN(momentDate.getTime())) return String(value);

        return momentDate.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    function getWorldCoordinatesLinkMarkup(value) {
        const coordinates = normalizeWorldCoordinates(value);
        if (!coordinates) return 'location n/a';

        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
        return `<a class="song-info-link" href="${mapsUrl}" target="_blank" rel="noreferrer noopener">${escapeHtml(coordinates)}</a>`;
    }

    function average(values) {
        if (!values.length) return null;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function median(values) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle];
    }

    function getExtremeMetric(metrics, selector, pickMax = true) {
        return metrics
            .filter(metric => Number.isFinite(selector(metric)))
            .reduce((best, metric) => {
                if (!best) return metric;
                return pickMax
                    ? selector(metric) > selector(best) ? metric : best
                    : selector(metric) < selector(best) ? metric : best;
            }, null);
    }

    function normalizeChordName(chordName) {
        return String(chordName || '').replace(/\*/g, '').trim();
    }

    function parseChordSymbol(chordName) {
        const normalized = normalizeChordName(chordName);
        const match = normalized.match(/^([A-Ga-g])([#b]?)(.*)$/);
        if (!match) return null;

        const rootName = `${match[1].toUpperCase()}${match[2] || ''}`;
        const suffix = (match[3] || '').trim().toLowerCase();
        const rootSemitone = NOTE_TO_SEMITONE[rootName];
        if (!Number.isFinite(rootSemitone)) return null;

        let quality = 'major';
        if (/dim|o/.test(suffix)) {
            quality = 'diminished';
        } else if (/aug|\+/.test(suffix)) {
            quality = 'augmented';
        } else if (/m(?!aj)/.test(suffix)) {
            quality = 'minor';
        } else if (/sus/.test(suffix)) {
            quality = 'suspended';
        } else if (/5/.test(suffix)) {
            quality = 'power';
        } else if (/7/.test(suffix) && !/maj7/.test(suffix)) {
            quality = 'dominant';
        }

        return {
            symbol: normalized,
            rootName,
            rootSemitone,
            quality,
            suffix
        };
    }

    function getChordFitScore(parsedChord, candidate) {
        if (!parsedChord) return -1;

        const relativeRoot = (parsedChord.rootSemitone - candidate.tonic + 12) % 12;
        const degreeIndex = candidate.scale.indexOf(relativeRoot);

        if (degreeIndex === -1) {
            if (candidate.mode === 'minor' && relativeRoot === 11 && parsedChord.quality === 'diminished') {
                return 1.6;
            }
            return -0.65;
        }

        const expectedQuality = candidate.qualities[degreeIndex];
        let score = 1.15;

        if (parsedChord.quality === expectedQuality) {
            score = 2.7;
        } else if (parsedChord.quality === 'dominant' && (expectedQuality === 'major' || (candidate.mode === 'minor' && degreeIndex === 4))) {
            score = 2.4;
        } else if (['power', 'suspended'].includes(parsedChord.quality) && expectedQuality !== 'diminished') {
            score = 2.0;
        } else if (parsedChord.quality === 'augmented') {
            score = 0.9;
        }

        if (relativeRoot === 0 || relativeRoot === 7) {
            score += 0.12;
        }

        return score;
    }

    function analyzeHarmony(chordSequence) {
        const parsedChords = chordSequence
            .map(chord => ({
                symbol: normalizeChordName(chord),
                parsed: parseChordSymbol(chord)
            }))
            .filter(entry => entry.parsed);

        if (!parsedChords.length) {
            return {
                keyLabel: 'n/a',
                confidence: null,
                borrowedCount: 0,
                borrowedNames: [],
                chromaticMoves: 0,
                tritoneMoves: 0,
                weirdnessScore: 0,
                weirdSummary: 'n/a'
            };
        }

        const rankedCandidates = KEY_CANDIDATES
            .map(candidate => ({
                ...candidate,
                score: parsedChords.reduce((sum, entry) => sum + getChordFitScore(entry.parsed, candidate), 0)
            }))
            .sort((a, b) => b.score - a.score);

        const bestCandidate = rankedCandidates[0];
        const nextCandidate = rankedCandidates[1] || rankedCandidates[0];
        const borrowedCounts = new Map();
        let chromaticMoves = 0;
        let tritoneMoves = 0;
        let borrowedCount = 0;

        parsedChords.forEach((entry, index) => {
            const fitScore = getChordFitScore(entry.parsed, bestCandidate);
            if (fitScore < 1.2) {
                borrowedCount++;
                borrowedCounts.set(entry.symbol, (borrowedCounts.get(entry.symbol) || 0) + 1);
            }

            if (index === 0) return;
            const previous = parsedChords[index - 1].parsed;
            const interval = (entry.parsed.rootSemitone - previous.rootSemitone + 12) % 12;
            if (interval === 1 || interval === 11) {
                chromaticMoves++;
            } else if (interval === 6) {
                tritoneMoves++;
            }
        });

        const borrowedNames = [...borrowedCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([symbol, count]) => `${symbol}×${count}`);

        const weirdParts = [];
        if (borrowedCount) weirdParts.push(`${borrowedCount} detour${borrowedCount === 1 ? '' : 's'}`);
        if (chromaticMoves) weirdParts.push(`${chromaticMoves} chromatic`);
        if (tritoneMoves) weirdParts.push(`${tritoneMoves} tritone`);

        return {
            keyLabel: bestCandidate.label,
            confidence: parsedChords.length ? (bestCandidate.score - nextCandidate.score) / parsedChords.length : null,
            borrowedCount,
            borrowedNames,
            chromaticMoves,
            tritoneMoves,
            weirdnessScore: borrowedCount * 2 + chromaticMoves * 1.25 + tritoneMoves * 1.5,
            weirdSummary: weirdParts.length ? weirdParts.join(' / ') : 'mostly diatonic'
        };
    }

    function normalizeLyricText(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFKC')
            .replace(/[’']/g, '')
            .replace(/[^\p{L}\s-]/gu, ' ');
    }

    function tokenizeLyricWords(text, contentOnly = false) {
        const tokens = normalizeLyricText(text)
            .split(/\s+/)
            .map(token => token.replace(/^-+|-+$/g, ''))
            .filter(Boolean);

        if (!contentOnly) return tokens;

        return tokens.filter(token => token.length >= 3 && !LYRIC_STOPWORDS.has(token));
    }

    function analyzeLyrics(lyrics) {
        const safeLyrics = Array.isArray(lyrics) ? lyrics : [];
        const contentWordCounts = new Map();
        const contentWords = [];
        const stanzaLineCounts = [];
        const stanzaWordCounts = [];
        let currentStanzaLines = 0;
        let currentStanzaWords = 0;

        safeLyrics.forEach((lineObj, index) => {
            const text = (lineObj.line || '').trim();
            const rawWords = tokenizeLyricWords(text, false);
            const contentTokens = tokenizeLyricWords(text, true);

            if (text) {
                currentStanzaLines++;
                currentStanzaWords += rawWords.length;
            }

            contentTokens.forEach(token => {
                contentWords.push(token);
                contentWordCounts.set(token, (contentWordCounts.get(token) || 0) + 1);
            });

            if ((lineObj.stanzaEnd || index === safeLyrics.length - 1) && currentStanzaLines > 0) {
                stanzaLineCounts.push(currentStanzaLines);
                stanzaWordCounts.push(currentStanzaWords);
                currentStanzaLines = 0;
                currentStanzaWords = 0;
            }
        });

        const rankedWords = [...contentWordCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([word, count]) => ({ word, count }));

        return {
            topWords: rankedWords,
            topWordsLabel: rankedWords.length
                ? rankedWords.map(entry => `${entry.word}×${entry.count}`).join(', ')
                : 'n/a',
            topWordShare: rankedWords.length && contentWords.length
                ? (rankedWords[0].count / contentWords.length) * 100
                : null,
            uniqueWords: new Set(contentWords).size,
            stanzaCount: stanzaLineCounts.length,
            avgStanzaLines: average(stanzaLineCounts),
            maxStanzaLines: stanzaLineCounts.length ? Math.max(...stanzaLineCounts) : null,
            avgStanzaWords: average(stanzaWordCounts),
            stanzaProfile: stanzaLineCounts.length
                ? `${stanzaLineCounts.length} stz • ${average(stanzaLineCounts).toFixed(1)}L avg • ${Math.max(...stanzaLineCounts)}L max`
                : 'n/a'
        };
    }

    function getTrackSections(track) {
        return Array.isArray(track.structure?.sections) ? track.structure.sections : [];
    }

    function getBeatsPerBar(track) {
        return track.timeSignature === '6/8' ? 2 : 4;
    }

    function formatBars(barCount) {
        if (!Number.isFinite(barCount)) return '0';
        return Number.isInteger(barCount) ? String(barCount) : barCount.toFixed(1);
    }

    function formatSecondsMetric(seconds) {
        if (!Number.isFinite(seconds)) return '--';
        if (seconds >= 60) return formatTime(seconds);
        if (seconds >= 10) return `${seconds.toFixed(1)}s`;
        return `${seconds.toFixed(2)}s`;
    }

    function formatDb(value, unit = 'dB') {
        if (!Number.isFinite(value)) return '--';
        return `${value.toFixed(1)} ${unit}`;
    }

    function formatBitrate(value) {
        if (!Number.isFinite(value)) return '--';
        return `${Math.round(value)} kbps`;
    }

    function formatPercent(value) {
        if (!Number.isFinite(value)) return '--';
        return `${Math.round(value)}%`;
    }

    function formatPercentFixed(value, digits = 1) {
        if (!Number.isFinite(value)) return '--';
        return `${value.toFixed(digits)}%`;
    }

    function formatFrequency(value) {
        if (!Number.isFinite(value)) return '--';
        if (value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
        return `${Math.round(value)} Hz`;
    }

    function formatSignedPoints(value) {
        if (!Number.isFinite(value)) return '--';
        const sign = value > 0 ? '+' : '';
        return `${sign}${value.toFixed(1)} pts`;
    }

    function formatFrequencySpread(value) {
        if (!Number.isFinite(value)) return '--';
        if (value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
        return `${Math.round(value)} Hz`;
    }

    function formatRatio(value) {
        if (!Number.isFinite(value)) return '--';
        return value.toFixed(2);
    }

    function formatStereoBalance(value) {
        if (!Number.isFinite(value)) return '--';
        if (Math.abs(value) < 0.05) return 'centered';
        const side = value > 0 ? 'L' : 'R';
        return `${side}+${Math.abs(value).toFixed(1)} dB`;
    }

    function formatHeadroom(value) {
        if (!Number.isFinite(value)) return '--';
        return `${value.toFixed(2)} dB`;
    }

    function formatDensity(value) {
        if (!Number.isFinite(value)) return '--';
        return `${value.toFixed(1)}/min`;
    }

    function formatCount(value) {
        if (!Number.isFinite(value)) return '--';
        return `${Math.round(value)}`;
    }

    function formatGainAdjustment(value) {
        if (!Number.isFinite(value)) return '--';
        const sign = value > 0 ? '+' : '';
        return `${sign}${value.toFixed(1)} dB`;
    }

    function formatTimeRange(startTime, endTime) {
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return '--';
        return `${formatTime(startTime)}-${formatTime(endTime)}`;
    }

    function createTextReference(rangeText, positionText, tone = 'inside') {
        return { rangeText, positionText, tone };
    }

    function getRangeReference(value, min, max, formatter, options = {}) {
        const rangeText = options.rangeText || `Normal ${formatter(min)} to ${formatter(max)}`;
        const inspectedValue = Number.isFinite(value)
            ? (options.absolute ? Math.abs(value) : value)
            : null;

        if (!Number.isFinite(inspectedValue)) {
            return createTextReference(rangeText, options.pendingText || 'current pending', 'pending');
        }
        if (inspectedValue < min) {
            return createTextReference(rangeText, options.lowText || 'current below band', 'low');
        }
        if (inspectedValue > max) {
            return createTextReference(rangeText, options.highText || 'current above band', 'high');
        }
        if (typeof options.insideResolver === 'function') {
            return createTextReference(rangeText, options.insideResolver(inspectedValue, min, max), 'inside');
        }

        const span = max - min;
        const normalized = span > 0 ? (inspectedValue - min) / span : 0.5;
        if (normalized <= 0.18) return createTextReference(rangeText, 'current low edge', 'inside');
        if (normalized >= 0.82) return createTextReference(rangeText, 'current high edge', 'inside');
        if (normalized >= 0.42 && normalized <= 0.58) return createTextReference(rangeText, 'current mid-band', 'inside');
        return createTextReference(rangeText, 'current inside band', 'inside');
    }

    function getReferenceTone(referenceInfo) {
        return referenceInfo?.tone || 'pending';
    }

    function renderReferenceNote(referenceInfo, className = 'telemetry-reference') {
        if (!referenceInfo) return '';
        return `
            <span class="${className} telemetry-reference telemetry-reference--${referenceInfo.tone || 'inside'}">
                <span class="telemetry-reference-range">${escapeHtml(referenceInfo.rangeText)}</span>
                <span class="telemetry-reference-status">${escapeHtml(referenceInfo.positionText)}</span>
            </span>
        `;
    }

    function renderTelemetryCell(mainContent, referenceInfo) {
        const tone = getReferenceTone(referenceInfo);
        return `
            <div class="telemetry-table-stack telemetry-tone--${tone}">
                <span class="telemetry-table-main">${mainContent}</span>
                ${renderReferenceNote(referenceInfo, 'telemetry-table-reference')}
            </div>
        `;
    }

    function getTempoReference(bpm) {
        return getRangeReference(bpm, 72, 140, value => `${Math.round(value)} BPM`, {
            lowText: 'current laid-back pocket',
            highText: 'current brisk pocket'
        });
    }

    function getSignatureReference(signature) {
        if (!signature || signature === 'n/a') {
            return createTextReference('Normal 4/4 or 6/8', 'current pending', 'pending');
        }
        const commonMeter = signature === '4/4' || signature === '6/8';
        return createTextReference(
            'Normal 4/4 or 6/8',
            commonMeter ? 'current common meter' : 'current uncommon meter',
            commonMeter ? 'inside' : 'high'
        );
    }

    function getKeyReference(harmonicAnalysis) {
        if (!harmonicAnalysis || !Number.isFinite(harmonicAnalysis.confidence)) {
            return createTextReference('Normal 1 stable tonic with clear fit', 'current pending', 'pending');
        }
        if (harmonicAnalysis.confidence >= 0.25) {
            return createTextReference('Normal 1 stable tonic with clear fit', 'current firm center', 'inside');
        }
        if (harmonicAnalysis.confidence >= 0.12) {
            return createTextReference('Normal 1 stable tonic with clear fit', 'current workable center', 'inside');
        }
        return createTextReference('Normal 1 stable tonic with clear fit', 'current loose center', 'high');
    }

    function getHarmonyWeirdnessReference(harmonicAnalysis) {
        if (!harmonicAnalysis) {
            return createTextReference('Normal mostly diatonic, 0-2 borrowed moves', 'current pending', 'pending');
        }
        if (harmonicAnalysis.weirdnessScore <= 2.5) {
            return createTextReference('Normal mostly diatonic, 0-2 borrowed moves', 'current stable', 'inside');
        }
        if (harmonicAnalysis.weirdnessScore <= 6) {
            return createTextReference('Normal mostly diatonic, 0-2 borrowed moves', 'current colorful but inside band', 'inside');
        }
        return createTextReference('Normal mostly diatonic, 0-2 borrowed moves', 'current beyond common detour band', 'high');
    }

    function getHookReference(lyricsAnalysis) {
        return getRangeReference(lyricsAnalysis?.topWordShare, 4, 14, value => formatPercentFixed(value, 1), {
            lowText: 'current dispersed vocabulary',
            highText: 'current extra-sticky hook'
        });
    }

    function getStanzaReference(lyricsAnalysis) {
        if (!lyricsAnalysis || !Number.isFinite(lyricsAnalysis.avgStanzaLines)) {
            return createTextReference('Normal 3-8 lines / 18-60 words', 'current pending', 'pending');
        }
        if (lyricsAnalysis.avgStanzaLines < 3) {
            return createTextReference('Normal 3-8 lines / 18-60 words', 'current terse blocks', 'low');
        }
        if (lyricsAnalysis.avgStanzaLines > 8) {
            return createTextReference('Normal 3-8 lines / 18-60 words', 'current long-form blocks', 'high');
        }
        return createTextReference('Normal 3-8 lines / 18-60 words', 'current inside stanza band', 'inside');
    }

    function getFormatReference(analysis) {
        if (!analysis) {
            return createTextReference('Normal 44.1-48 kHz stereo master', 'current pending', 'pending');
        }
        const standardRate = analysis.sampleRate === 44100 || analysis.sampleRate === 48000;
        const standardLayout = analysis.channelCount === 2;
        if (standardRate && standardLayout) {
            return createTextReference('Normal 44.1-48 kHz stereo master', 'current standard delivery', 'inside');
        }
        return createTextReference('Normal 44.1-48 kHz stereo master', `current ${analysis.channelLabel} / non-standard rate`, 'high');
    }

    function setLiveReferenceText(element, referenceInfo) {
        if (!element) return;
        const card = element.closest('.telemetry-live-card');
        if (card) {
            card.classList.remove('telemetry-tone--inside', 'telemetry-tone--low', 'telemetry-tone--high', 'telemetry-tone--pending');
            card.classList.add(`telemetry-tone--${getReferenceTone(referenceInfo)}`);
        }
        element.textContent = `${referenceInfo.rangeText} • ${referenceInfo.positionText}`;
    }

    function groupConsecutiveIndexes(indexes) {
        if (!indexes.length) return [];

        const groups = [];
        let start = indexes[0];
        let end = indexes[0];

        for (let i = 1; i < indexes.length; i++) {
            if (indexes[i] === end + 1) {
                end = indexes[i];
                continue;
            }
            groups.push({ start, end });
            start = indexes[i];
            end = indexes[i];
        }

        groups.push({ start, end });
        return groups;
    }

    function getSectionLabelForTime(metric, startTime, endTime) {
        if (!metric.sectionTimeline?.length || !metric.totalBars || !metric.audioAnalysis?.duration) {
            return 'song body';
        }

        const midpointRatio = ((startTime + endTime) * 0.5) / metric.audioAnalysis.duration;
        const midpointBar = midpointRatio * metric.totalBars;
        const section = metric.sectionTimeline.find(entry => midpointBar >= entry.startBar && midpointBar < entry.endBar + 0.001);
        return section ? section.label : 'transition';
    }

    function getWaveformActionRegions(metric, mode = 'hot') {
        const analysis = metric.audioAnalysis;
        if (!analysis || !Array.isArray(analysis.waveformBins) || !analysis.waveformBins.length || !Number.isFinite(analysis.duration) || analysis.duration <= 0) {
            return [];
        }

        const bins = analysis.waveformBins;
        const hotBins = new Set(analysis.hotBinIndexes || []);
        const bodyStart = analysis.leadingSilence / analysis.duration;
        const bodyEnd = 1 - (analysis.trailingSilence / analysis.duration);
        const candidateIndexes = [];

        for (let index = 0; index < bins.length; index++) {
            const ratio = (index + 0.5) / bins.length;
            const isBody = ratio >= bodyStart && ratio <= bodyEnd;
            if (!isBody) continue;

            if (mode === 'hot') {
                if (bins[index] >= 0.9 || hotBins.has(index)) {
                    candidateIndexes.push(index);
                }
            } else if (mode === 'quiet') {
                const safelyInsideBody = ratio >= bodyStart + 0.04 && ratio <= bodyEnd - 0.04;
                if (safelyInsideBody && bins[index] <= 0.2 && !hotBins.has(index)) {
                    candidateIndexes.push(index);
                }
            }
        }

        return groupConsecutiveIndexes(candidateIndexes)
            .map(group => {
                const slice = bins.slice(group.start, group.end + 1);
                const startTime = (group.start / bins.length) * analysis.duration;
                const endTime = ((group.end + 1) / bins.length) * analysis.duration;
                const avgValue = average(slice) || 0;
                const peakValue = slice.length ? Math.max(...slice) : 0;
                return {
                    startIndex: group.start,
                    endIndex: group.end,
                    startTime,
                    endTime,
                    avgValue,
                    peakValue,
                    duration: endTime - startTime,
                    sectionLabel: getSectionLabelForTime(metric, startTime, endTime)
                };
            })
            .filter(region => region.duration >= (mode === 'hot' ? 0.8 : 1.2))
            .sort((a, b) => {
                if (mode === 'hot') {
                    return (b.peakValue - a.peakValue) || (b.avgValue - a.avgValue) || (b.duration - a.duration);
                }
                return (a.avgValue - b.avgValue) || (b.duration - a.duration);
            });
    }

    function renderRecommendationList(items) {
        if (!items.length) return '';
        return `<ul class="telemetry-recommendation-list">${items.map(item => `<li class="telemetry-recommendation-item">${item}</li>`).join('')}</ul>`;
    }

    function getAlbumMasteringContext(metrics) {
        const scannedMetrics = metrics.filter(metric => metric.audioAnalysis && Number.isFinite(metric.audioAnalysis.rmsDb));

        return {
            scannedMetrics,
            targetRms: scannedMetrics.length
                ? median(scannedMetrics.map(metric => metric.audioAnalysis.rmsDb).filter(value => Number.isFinite(value)))
                : null,
            targetCrest: scannedMetrics.length
                ? median(scannedMetrics.map(metric => metric.audioAnalysis.crestFactorDb).filter(value => Number.isFinite(value)))
                : null,
            targetHeadroom: scannedMetrics.length
                ? median(scannedMetrics.map(metric => metric.audioAnalysis.headroomDb).filter(value => Number.isFinite(value)))
                : null
        };
    }

    function buildTrackMasteringAdvice(metric, masteringContext) {
        if (!metric.audioAnalysis || !Number.isFinite(masteringContext.targetRms)) {
            return [
                {
                    tone: 'steady',
                    text: 'Open telemetry once to finish the master scan for this song.'
                }
            ];
        }

        const advice = [];
        const analysis = metric.audioAnalysis;
        const loudnessDelta = analysis.rmsDb - masteringContext.targetRms;
        const crestDelta = Number.isFinite(masteringContext.targetCrest)
            ? analysis.crestFactorDb - masteringContext.targetCrest
            : null;
        const hotRegion = getWaveformActionRegions(metric, 'hot')[0] || null;
        const quietRegion = getWaveformActionRegions(metric, 'quiet')[0] || null;

        if (loudnessDelta > 0.75 || (analysis.headroomDb || 0) < 0.8) {
            const trimDb = -Math.min(3.0, Math.max(0.4, (loudnessDelta * 0.9) + Math.max(0, 0.8 - (analysis.headroomDb || 0))));
            advice.push({
                tone: 'trim',
                text: `Trim overall level ${formatGainAdjustment(trimDb)}`
            });
        } else if (loudnessDelta < -0.75 && (analysis.headroomDb || 0) > 1.1) {
            const liftDb = Math.min(2.4, Math.max(0.4, Math.min(-loudnessDelta, (analysis.headroomDb || 0) - 0.6)));
            advice.push({
                tone: 'lift',
                text: `Lift overall level ${formatGainAdjustment(liftDb)}`
            });
        } else {
            advice.push({
                tone: 'steady',
                text: 'Whole-song gain is close to the album target.'
            });
        }

        if (hotRegion) {
            const pullDb = -Math.min(1.8, Math.max(0.5, ((hotRegion.peakValue - 0.88) * 6) + ((analysis.clipBinCount || 0) * 0.05)));
            advice.push({
                tone: 'trim',
                text: `${hotRegion.sectionLabel} ${formatTimeRange(hotRegion.startTime, hotRegion.endTime)} • normalize down ${formatGainAdjustment(pullDb)}`
            });
        }

        if (quietRegion && loudnessDelta < 0.25) {
            const liftDb = Math.min(1.5, Math.max(0.4, (0.22 - quietRegion.avgValue) * 6));
            advice.push({
                tone: 'lift',
                text: `${quietRegion.sectionLabel} ${formatTimeRange(quietRegion.startTime, quietRegion.endTime)} • support with ${formatGainAdjustment(liftDb)}`
            });
        }

        if ((Number.isFinite(analysis.monoCorrelation) && analysis.monoCorrelation < 0.92) || (Number.isFinite(analysis.stereoBalanceDb) && Math.abs(analysis.stereoBalanceDb) > 0.8)) {
            advice.push({
                tone: 'watch',
                text: `Check mono fold (${formatRatio(analysis.monoCorrelation)}) / balance (${formatStereoBalance(analysis.stereoBalanceDb)})`
            });
        }

        if ((Number.isFinite(crestDelta) && crestDelta < -0.7) || ((analysis.clipBinCount || 0) > 4 && analysis.rmsDb > masteringContext.targetRms - 0.2)) {
            advice.push({
                tone: 'watch',
                text: `Back off bus compression or limiting before pushing louder (${formatDb(analysis.crestFactorDb)} crest)`
            });
        }

        return advice.slice(0, 4);
    }

    function renderSongInfoPanel(metric) {
        const stats = [
            { label: 'Tempo', value: metric.bpm ? `${metric.bpm} BPM` : 'tempo n/a' },
            { label: 'Signature', value: metric.timeSignature || 'n/a' },
            { label: 'Key', value: metric.harmonicAnalysis.keyLabel || 'n/a' },
            { label: 'Capo', value: metric.capo > 0 ? `${metric.capo}` : 'None' },
            { label: 'Bars', value: `${formatBars(metric.totalBars)} bars` },
            { label: 'Sections', value: `${metric.sectionCount}` }
        ];

        return `
            <div class="song-info-panel">
                <div class="song-info-grid">
                    ${stats.map(stat => `
                        <div class="song-info-stat">
                            <span class="song-info-label">${stat.label}</span>
                            <span class="song-info-value">${stat.htmlValue ?? escapeHtml(stat.value)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function refreshCurrentSongInfoPanel() {
        if (!songInfoHost) return;
        if (!currentTrack || selectedTrackIndex < 0) {
            songInfoHost.innerHTML = '';
            return;
        }

        songInfoHost.innerHTML = renderSongInfoPanel(getTrackMetrics(currentTrack, selectedTrackIndex));
    }

    function renderMasteringRecommendations(metrics, waveformDetail) {
        const masteringContext = getAlbumMasteringContext(metrics);
        const { scannedMetrics, targetRms, targetCrest } = masteringContext;
        if (!scannedMetrics.length) {
            return `
                <section class="telemetry-recommendations">
                    <div class="telemetry-recommendations-head">
                        <strong class="telemetry-recommendations-title">Mastering Recommendations</strong>
                        <span class="telemetry-recommendations-note">${escapeHtml(waveformDetail)}</span>
                    </div>
                </section>
            `;
        }

        const trimSongs = scannedMetrics
            .map(metric => {
                const loudnessDelta = metric.audioAnalysis.rmsDb - targetRms;
                const ceilingPenalty = Math.max(0, 0.8 - (metric.audioAnalysis.headroomDb || 0));
                const score = loudnessDelta + ceilingPenalty + ((metric.audioAnalysis.clipBinCount || 0) * 0.08);
                if (score <= 0.45) return null;
                return {
                    metric,
                    score,
                    adjustmentDb: -Math.min(3.0, Math.max(0.5, (loudnessDelta * 0.9) + ceilingPenalty)),
                    loudnessDelta,
                    headroom: metric.audioAnalysis.headroomDb || 0
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || b.loudnessDelta - a.loudnessDelta);

        const liftSongs = scannedMetrics
            .map(metric => {
                const headroom = metric.audioAnalysis.headroomDb || 0;
                const loudnessGap = targetRms - metric.audioAnalysis.rmsDb;
                const availableLift = Math.max(0, headroom - 0.6);
                const score = Math.min(loudnessGap, availableLift);
                if (score <= 0.35) return null;
                return {
                    metric,
                    score,
                    adjustmentDb: Math.min(2.5, Math.max(0.4, score)),
                    loudnessGap,
                    headroom
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || b.loudnessGap - a.loudnessGap);

        const hotRegions = scannedMetrics
            .flatMap(metric => getWaveformActionRegions(metric, 'hot').map(region => ({
                metric,
                region,
                severity: region.peakValue + ((metric.audioAnalysis.clipBinCount || 0) * 0.03)
            })))
            .sort((a, b) => b.severity - a.severity || (b.region.duration - a.region.duration));

        const quietRegions = scannedMetrics
            .flatMap(metric => getWaveformActionRegions(metric, 'quiet').map(region => ({
                metric,
                region,
                severity: (0.24 - region.avgValue) + Math.max(0, targetRms - metric.audioAnalysis.rmsDb) * 0.04
            })))
            .sort((a, b) => b.severity - a.severity || (b.region.duration - a.region.duration));

        const monoWatchSongs = scannedMetrics
            .map(metric => {
                const monoCorrelation = metric.audioAnalysis.monoCorrelation;
                const stereoBalanceDb = metric.audioAnalysis.stereoBalanceDb;
                const correlationRisk = Number.isFinite(monoCorrelation) ? (0.92 - monoCorrelation) : 0;
                const balanceRisk = Number.isFinite(stereoBalanceDb) ? (Math.abs(stereoBalanceDb) - 0.8) * 0.4 : 0;
                const score = Math.max(correlationRisk, 0) + Math.max(balanceRisk, 0);
                if (score <= 0) return null;
                return {
                    metric,
                    score,
                    monoCorrelation,
                    stereoBalanceDb
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || a.monoCorrelation - b.monoCorrelation);

        const compressionWatchSongs = scannedMetrics
            .map(metric => {
                const crest = metric.audioAnalysis.crestFactorDb || 0;
                const rms = metric.audioAnalysis.rmsDb || -Infinity;
                const crestGap = Number.isFinite(targetCrest) ? (targetCrest - crest) : 0;
                const clipRisk = (metric.audioAnalysis.clipBinCount || 0) > 4 && rms > targetRms - 0.2 ? ((metric.audioAnalysis.clipBinCount || 0) * 0.08) : 0;
                const score = Math.max(0, crestGap - 0.7) + clipRisk;
                if (score <= 0) return null;
                return {
                    metric,
                    score,
                    crest,
                    rms
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || a.crest - b.crest);

        const cards = [
            {
                label: 'Trim',
                value: trimSongs.length ? `${trimSongs.length} song${trimSongs.length === 1 ? '' : 's'}` : 'No overall trims queued',
                detail: trimSongs.length
                    ? 'Songs above the album target that should come down before final limiting.'
                    : 'No song is far enough above the album loudness target to need a whole-song trim.',
                reference: createTextReference('Normal within ±0.75 dB of album median and ≥ 0.8 dB headroom', trimSongs.length ? 'current trim queue populated' : 'current album inside trim band', trimSongs.length ? 'high' : 'inside'),
                items: trimSongs.map(({ metric, adjustmentDb, loudnessDelta, headroom }) => `${escapeHtml(metric.title)} • trim ${Math.abs(adjustmentDb).toFixed(1)} dB • ${loudnessDelta.toFixed(1)} dB above median • ${formatHeadroom(headroom)} headroom`)
            },
            {
                label: 'Lift',
                value: liftSongs.length ? `${liftSongs.length} song${liftSongs.length === 1 ? '' : 's'}` : 'No overall lifts queued',
                detail: liftSongs.length
                    ? 'Songs below the album target that can be lifted without spending all remaining ceiling.'
                    : 'No song sits far enough below the album center to justify a blanket lift.',
                reference: createTextReference('Normal no more than 0.75 dB below album median unless headroom > 1.1 dB', liftSongs.length ? 'current lift queue populated' : 'current album inside lift band', liftSongs.length ? 'high' : 'inside'),
                items: liftSongs.map(({ metric, adjustmentDb, loudnessGap, headroom }) => `${escapeHtml(metric.title)} • add ${adjustmentDb.toFixed(1)} dB • ${loudnessGap.toFixed(1)} dB below median • ${formatHeadroom(headroom)} headroom`)
            },
            {
                label: 'Hot passages',
                value: hotRegions.length ? `${hotRegions.length} passage${hotRegions.length === 1 ? '' : 's'}` : 'No hot passages found',
                detail: hotRegions.length
                    ? 'All flagged near-ceiling sections across the album, sorted from most urgent.'
                    : 'No persistent near-ceiling passages were detected in the scanned masters.',
                reference: createTextReference('Normal body bins stay under 0.90 with isolated edge peaks only', hotRegions.length ? 'current hot-passage queue populated' : 'current waveform bodies sit inside band', hotRegions.length ? 'high' : 'inside'),
                items: hotRegions.map(({ metric, region }) => {
                    const pullDb = -Math.min(1.8, Math.max(0.5, ((region.peakValue - 0.88) * 6) + ((metric.audioAnalysis.clipBinCount || 0) * 0.05)));
                    return `${escapeHtml(metric.title)} • ${escapeHtml(region.sectionLabel)} • ${formatTimeRange(region.startTime, region.endTime)} • trim ${Math.abs(pullDb).toFixed(1)} dB`;
                })
            },
            {
                label: 'Quiet body',
                value: quietRegions.length ? `${quietRegions.length} passage${quietRegions.length === 1 ? '' : 's'}` : 'No quiet passages found',
                detail: quietRegions.length
                    ? 'All body sections that read buried enough to need section-level lift instead of full-song gain.'
                    : 'No buried body sections were detected once intros and outros were trimmed.',
                reference: createTextReference('Normal body bins stay around 0.20 to 0.24 after intros/outros are removed', quietRegions.length ? 'current quiet-passage queue populated' : 'current body levels sit inside band', quietRegions.length ? 'high' : 'inside'),
                items: quietRegions.map(({ metric, region }) => {
                    const liftDb = Math.min(1.6, Math.max(0.4, (0.22 - region.avgValue) * 6));
                    return `${escapeHtml(metric.title)} • ${escapeHtml(region.sectionLabel)} • ${formatTimeRange(region.startTime, region.endTime)} • add ${liftDb.toFixed(1)} dB`;
                })
            },
            {
                label: 'Mono / stereo watch',
                value: monoWatchSongs.length ? `${monoWatchSongs.length} song${monoWatchSongs.length === 1 ? '' : 's'}` : 'No stereo issues queued',
                detail: monoWatchSongs.length
                    ? 'Songs with mono-fold risk or left/right bias worth checking in mid/side.'
                    : 'Stereo image looks stable across the scanned masters.',
                reference: createTextReference('Normal mono correlation 0.92-1.00 and balance within ±0.8 dB', monoWatchSongs.length ? 'current stereo watch queue populated' : 'current stereo image inside band', monoWatchSongs.length ? 'high' : 'inside'),
                items: monoWatchSongs.map(({ metric, monoCorrelation, stereoBalanceDb }) => `${escapeHtml(metric.title)} • mono ${formatRatio(monoCorrelation)} • balance ${formatStereoBalance(stereoBalanceDb)}`)
            },
            {
                label: 'Compression watch',
                value: compressionWatchSongs.length ? `${compressionWatchSongs.length} song${compressionWatchSongs.length === 1 ? '' : 's'}` : 'No squeeze risks queued',
                detail: compressionWatchSongs.length
                    ? 'Songs whose crest or clip pressure suggest backing off bus compression or limiting.'
                    : 'No song stands out as unusually squeezed from the current metrics.',
                reference: createTextReference('Normal crest stays within 0.7 dB of the album median or higher', compressionWatchSongs.length ? 'current compression watch queue populated' : 'current crest spread inside band', compressionWatchSongs.length ? 'high' : 'inside'),
                items: compressionWatchSongs.map(({ metric, crest, rms }) => `${escapeHtml(metric.title)} • crest ${formatDb(crest)} • RMS ${formatDb(rms, 'dBFS')}`)
            }
        ];

        return `
            <section class="telemetry-recommendations" aria-labelledby="telemetry-recommendations-title">
                <div class="telemetry-recommendations-head">
                    <strong class="telemetry-recommendations-title" id="telemetry-recommendations-title">Mastering Recommendations</strong>
                    <span class="telemetry-recommendations-note">Derived from album-median loudness, headroom, clip bins, mono fold safety, and section-aware waveform regions.</span>
                </div>
                <div class="telemetry-recommendation-grid">
                    ${cards.map(card => `
                        <article class="telemetry-recommendation-card telemetry-tone--${getReferenceTone(card.reference)}">
                            <span class="telemetry-recommendation-label">${card.label}</span>
                            <strong class="telemetry-recommendation-value">${card.value}</strong>
                            <p class="telemetry-recommendation-detail">${card.detail}</p>
                            ${renderReferenceNote(card.reference, 'telemetry-recommendation-reference')}
                            ${renderRecommendationList(card.items || [])}
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function updateTelemetryLiveReferences(analysis, rollingStats) {
        setLiveReferenceText(telemetryLiveReferences.peak, getRangeReference(analysis?.peakDb, -6, -0.8, value => formatDb(value, 'dBFS'), {
            lowText: 'current conservative peak margin',
            highText: 'current near ceiling'
        }));
        setLiveReferenceText(telemetryLiveReferences.rms, getRangeReference(analysis?.rmsDb, -24, -12, value => formatDb(value, 'dBFS'), {
            lowText: 'current restrained body',
            highText: 'current hot body'
        }));
        setLiveReferenceText(telemetryLiveReferences.crest, getRangeReference(analysis?.crestFactorDb, 8, 18, formatDb, {
            lowText: 'current compressed swing',
            highText: 'current very punchy swing'
        }));
        setLiveReferenceText(telemetryLiveReferences.centroid, getRangeReference(analysis?.spectralCentroidHz, 900, 4000, formatFrequency, {
            lowText: 'current dark center',
            highText: 'current bright center'
        }));
        setLiveReferenceText(telemetryLiveReferences.low, getRangeReference(analysis?.lowEnergyPct, 20, 55, formatPercent, {
            lowText: 'current light low-end share',
            highText: 'current bass-heavy share'
        }));
        setLiveReferenceText(telemetryLiveReferences.high, getRangeReference(analysis?.highEnergyPct, 8, 30, formatPercent, {
            lowText: 'current soft top-end share',
            highText: 'current airy top-end share'
        }));
        setLiveReferenceText(telemetryLiveReferences.peakHold, getRangeReference(rollingStats?.peakHoldDb, -6, -0.8, value => formatDb(value, 'dBFS'), {
            lowText: 'current safe peak-hold margin',
            highText: 'current near-ceiling hold'
        }));
        setLiveReferenceText(telemetryLiveReferences.rmsAvg, getRangeReference(rollingStats?.avgRmsDb, -22, -12, value => formatDb(value, 'dBFS'), {
            lowText: 'current restrained window body',
            highText: 'current hot window body'
        }));
        setLiveReferenceText(telemetryLiveReferences.crestAvg, getRangeReference(rollingStats?.avgCrestDb, 8, 18, formatDb, {
            lowText: 'current compressed window swing',
            highText: 'current very punchy window swing'
        }));
        setLiveReferenceText(telemetryLiveReferences.centroidAvg, getRangeReference(rollingStats?.avgCentroidHz, 1200, 3500, formatFrequency, {
            lowText: 'current darker window',
            highText: 'current brighter window'
        }));
        setLiveReferenceText(telemetryLiveReferences.clipPressure, getRangeReference(rollingStats?.avgClipShare, 0, 0.2, value => formatPercentFixed(value, 2), {
            highText: 'current elevated clip pressure',
            insideResolver: value => value === 0 ? 'current clean window' : 'current inside clip band'
        }));
        setLiveReferenceText(telemetryLiveReferences.bassTilt, getRangeReference(rollingStats?.bassTiltPts, -10, 10, formatSignedPoints, {
            lowText: 'current top-leaning tilt',
            highText: 'current bass-leaning tilt'
        }));
        setLiveReferenceText(telemetryLiveReferences.rmsSwing, getRangeReference(rollingStats?.rmsSwingDb, 4, 12, formatDb, {
            lowText: 'current very even window',
            highText: 'current wide loudness swing'
        }));
        setLiveReferenceText(telemetryLiveReferences.brightnessDrift, getRangeReference(rollingStats?.brightnessDriftHz, 500, 2500, formatFrequencySpread, {
            lowText: 'current steady tone color',
            highText: 'current wide tonal drift'
        }));
    }

    function updateTelemetryPlaybackIndicators(activeTrackIndex, currentTime = 0, duration = 0) {
        const rows = telemetrySongs.querySelectorAll('.telemetry-song-table tbody tr[data-track-index]');
        rows.forEach(row => {
            const rowTrackIndex = parseInt(row.dataset.trackIndex, 10);
            const isActive = rowTrackIndex === activeTrackIndex;
            row.classList.toggle('is-live', isActive);

            const playhead = row.querySelector('.telemetry-wave-playhead');
            if (!playhead) return;

            if (!isActive || !Number.isFinite(duration) || duration <= 0) {
                playhead.setAttribute('opacity', '0');
                return;
            }

            const viewBoxWidth = playhead.ownerSVGElement?.viewBox?.baseVal?.width || 272;
            const width = viewBoxWidth;
            const x = Math.max(0, Math.min(width, (currentTime / duration) * width));
            playhead.setAttribute('x1', x.toFixed(2));
            playhead.setAttribute('x2', x.toFixed(2));
            playhead.setAttribute('opacity', '1');
        });
    }

    function resetLiveTelemetryHistory(trackIndex = -1) {
        liveTelemetryHistory.length = 0;
        liveTelemetryTrackIndex = trackIndex;
        liveTelemetryLastSampleAt = 0;
        lastLiveAnalysisSnapshot = null;
    }

    function recordLiveTelemetrySample(trackIndex, analysis) {
        if (!analysis || isPlaybackPaused()) return;

        const now = performance.now();
        if (liveTelemetryTrackIndex !== trackIndex) {
            resetLiveTelemetryHistory(trackIndex);
        }

        if (liveTelemetryLastSampleAt && now - liveTelemetryLastSampleAt < 180) {
            return;
        }

        liveTelemetryHistory.push({
            time: now,
            peakDb: analysis.peakDb,
            rmsDb: analysis.rmsDb,
            crestFactorDb: analysis.crestFactorDb,
            spectralCentroidHz: analysis.spectralCentroidHz,
            clipShare: analysis.clipShare,
            lowEnergyPct: analysis.lowEnergyPct,
            highEnergyPct: analysis.highEnergyPct
        });
        liveTelemetryLastSampleAt = now;

        const cutoff = now - LIVE_TELEMETRY_WINDOW_MS;
        while (liveTelemetryHistory.length && liveTelemetryHistory[0].time < cutoff) {
            liveTelemetryHistory.shift();
        }
    }

    function getLiveTelemetryWindowStats() {
        if (!liveTelemetryHistory.length) {
            return null;
        }

        const peaks = liveTelemetryHistory.map(sample => sample.peakDb).filter(value => Number.isFinite(value));
        const rmsValues = liveTelemetryHistory.map(sample => sample.rmsDb).filter(value => Number.isFinite(value));
        const crestValues = liveTelemetryHistory.map(sample => sample.crestFactorDb).filter(value => Number.isFinite(value));
        const centroidValues = liveTelemetryHistory.map(sample => sample.spectralCentroidHz).filter(value => Number.isFinite(value));
        const clipValues = liveTelemetryHistory.map(sample => sample.clipShare).filter(value => Number.isFinite(value));
        const lowValues = liveTelemetryHistory.map(sample => sample.lowEnergyPct).filter(value => Number.isFinite(value));
        const highValues = liveTelemetryHistory.map(sample => sample.highEnergyPct).filter(value => Number.isFinite(value));

        return {
            peakHoldDb: peaks.length ? Math.max(...peaks) : null,
            avgRmsDb: average(rmsValues),
            avgCrestDb: average(crestValues),
            avgCentroidHz: average(centroidValues),
            avgClipShare: average(clipValues),
            bassTiltPts: average(lowValues) !== null && average(highValues) !== null
                ? average(lowValues) - average(highValues)
                : null,
            rmsSwingDb: rmsValues.length ? Math.max(...rmsValues) - Math.min(...rmsValues) : null,
            brightnessDriftHz: centroidValues.length ? Math.max(...centroidValues) - Math.min(...centroidValues) : null
        };
    }

    function setTelemetryLiveIdle(message = 'Start a song or click a waveform to arm the live meters.') {
        if (!telemetryLiveTitle) return;

        if (!currentTrack || selectedTrackIndex < 0) {
            resetLiveTelemetryHistory(-1);
        }

        const fallbackDuration = selectedTrackIndex >= 0
            ? trackAudioAnalysis.get(selectedTrackIndex)?.duration || trackDurations.get(selectedTrackIndex) || 0
            : 0;

        telemetryLiveTitle.textContent = selectedTrackIndex >= 0 && data.tracks[selectedTrackIndex]
            ? `${selectedTrackIndex + 1} ${data.tracks[selectedTrackIndex].title}`
            : 'Telemetry standing by';
        telemetryLiveMeta.textContent = message;
        const playbackTime = getPlaybackCurrentTime();
        telemetryLiveTime.textContent = `${formatTime(playbackTime)} / ${formatTime(fallbackDuration || 0)}`;
        telemetryLiveProgressFill.style.transform = `scaleX(${fallbackDuration > 0 ? Math.max(0, Math.min(1, playbackTime / fallbackDuration)) : 0})`;
        telemetryLivePeak.textContent = '--';
        telemetryLiveRms.textContent = '--';
        telemetryLiveCrest.textContent = '--';
        telemetryLiveCentroid.textContent = '--';
        telemetryLiveLow.textContent = '--';
        telemetryLiveHigh.textContent = '--';
        telemetryLivePeakHold.textContent = '--';
        telemetryLiveRmsAvg.textContent = '--';
        telemetryLiveCrestAvg.textContent = '--';
        telemetryLiveCentroidAvg.textContent = '--';
        telemetryLiveClipPressure.textContent = '--';
        telemetryLiveBassTilt.textContent = '--';
        telemetryLiveRmsSwing.textContent = '--';
        telemetryLiveBrightnessDrift.textContent = '--';
        telemetryLiveSpectrumBars.forEach(bar => {
            bar.style.transform = 'scaleY(0.08)';
            bar.style.opacity = '0.45';
        });
        updateTelemetryLiveReferences(null, null);
        updateTelemetryPlaybackIndicators(selectedTrackIndex, playbackTime, fallbackDuration || 0);
    }

    function updateLiveTelemetryAnalysis(force = false) {
        if (!telemetryEnabled) return;
        const telemetryPanel = document.getElementById('tab-telemetry');
        if (!force && (!telemetryPanel || !telemetryPanel.classList.contains('active'))) return;
        if (!telemetryLiveTitle) return;

        if (!currentTrack || selectedTrackIndex < 0) {
            setTelemetryLiveIdle();
            return;
        }

        const fallbackDuration = trackAudioAnalysis.get(selectedTrackIndex)?.duration || trackDurations.get(selectedTrackIndex) || 0;
        const duration = getPlaybackDuration() || fallbackDuration;
        const currentTime = getPlaybackCurrentTime();
        const rawAnalysis = audioEngine.getLiveAnalysis();
        if (rawAnalysis && !isPlaybackPaused()) {
            lastLiveAnalysisSnapshot = rawAnalysis;
            recordLiveTelemetrySample(selectedTrackIndex, rawAnalysis);
        }
        const analysis = (!isPlaybackPaused() && rawAnalysis) ? rawAnalysis : lastLiveAnalysisSnapshot;
        const rollingStats = getLiveTelemetryWindowStats();
        const songGridTime = getSongGridTime(currentTrack, currentTime);
        const { beatDuration, beatsPerBar } = getTrackTiming(currentTrack);
        const currentBar = Math.max(1, Math.floor(songGridTime / (beatDuration * beatsPerBar)) + 1);

        let currentSection = 'between sections';
        let beatCursor = 0;
        let totalBars = 0;
        currentTrack.structure.sections.forEach(section => {
            totalBars += section.chords.length / beatsPerBar;
            if (currentSection !== 'between sections') return;
            const sectionBeats = section.chords.length;
            const currentBeat = Math.floor(songGridTime / beatDuration);
            if (currentBeat >= beatCursor && currentBeat < beatCursor + sectionBeats) {
                currentSection = section.label;
            }
            beatCursor += sectionBeats;
        });

        telemetryLiveTitle.textContent = `${selectedTrackIndex + 1} ${currentTrack.title}`;
        telemetryLiveMeta.textContent = `${isPlaybackPaused() ? 'paused' : 'playing'} • ${currentSection} • bar ${currentBar}/${Math.max(1, Math.round(totalBars))} • ${currentTrack.timeSignature}`;
        telemetryLiveTime.textContent = `${formatTime(currentTime)} / ${formatTime(duration || 0)}`;
        telemetryLiveProgressFill.style.transform = `scaleX(${duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0})`;

        if (!analysis) {
            telemetryLivePeak.textContent = '--';
            telemetryLiveRms.textContent = '--';
            telemetryLiveCrest.textContent = '--';
            telemetryLiveCentroid.textContent = '--';
            telemetryLiveLow.textContent = '--';
            telemetryLiveHigh.textContent = '--';
            telemetryLiveSpectrumBars.forEach(bar => {
                bar.style.transform = 'scaleY(0.08)';
                bar.style.opacity = '0.45';
            });
        } else {
            telemetryLivePeak.textContent = Number.isFinite(analysis.peakDb) ? `${analysis.peakDb.toFixed(1)} dBFS` : '--';
            telemetryLiveRms.textContent = Number.isFinite(analysis.rmsDb) ? `${analysis.rmsDb.toFixed(1)} dBFS` : '--';
            telemetryLiveCrest.textContent = Number.isFinite(analysis.crestFactorDb) ? `${analysis.crestFactorDb.toFixed(1)} dB` : '--';
            telemetryLiveCentroid.textContent = formatFrequency(analysis.spectralCentroidHz);
            telemetryLiveLow.textContent = formatPercent(analysis.lowEnergyPct);
            telemetryLiveHigh.textContent = formatPercent(analysis.highEnergyPct);
            telemetryLiveSpectrumBars.forEach((bar, index) => {
                const level = analysis.spectrumBins[index] ?? 0;
                bar.style.transform = `scaleY(${Math.max(0.08, level)})`;
                bar.style.opacity = `${0.45 + Math.min(0.5, level * 0.7)}`;
            });
        }

        if (!rollingStats) {
            telemetryLivePeakHold.textContent = '--';
            telemetryLiveRmsAvg.textContent = '--';
            telemetryLiveCrestAvg.textContent = '--';
            telemetryLiveCentroidAvg.textContent = '--';
            telemetryLiveClipPressure.textContent = '--';
            telemetryLiveBassTilt.textContent = '--';
            telemetryLiveRmsSwing.textContent = '--';
            telemetryLiveBrightnessDrift.textContent = '--';
        } else {
            telemetryLivePeakHold.textContent = Number.isFinite(rollingStats.peakHoldDb) ? `${rollingStats.peakHoldDb.toFixed(1)} dBFS` : '--';
            telemetryLiveRmsAvg.textContent = Number.isFinite(rollingStats.avgRmsDb) ? `${rollingStats.avgRmsDb.toFixed(1)} dBFS` : '--';
            telemetryLiveCrestAvg.textContent = Number.isFinite(rollingStats.avgCrestDb) ? `${rollingStats.avgCrestDb.toFixed(1)} dB` : '--';
            telemetryLiveCentroidAvg.textContent = formatFrequency(rollingStats.avgCentroidHz);
            telemetryLiveClipPressure.textContent = Number.isFinite(rollingStats.avgClipShare) ? `${rollingStats.avgClipShare.toFixed(2)}%` : '--';
            telemetryLiveBassTilt.textContent = formatSignedPoints(rollingStats.bassTiltPts);
            telemetryLiveRmsSwing.textContent = Number.isFinite(rollingStats.rmsSwingDb) ? `${rollingStats.rmsSwingDb.toFixed(1)} dB` : '--';
            telemetryLiveBrightnessDrift.textContent = formatFrequencySpread(rollingStats.brightnessDriftHz);
        }

        updateTelemetryLiveReferences(analysis, rollingStats);

        updateTelemetryPlaybackIndicators(selectedTrackIndex, currentTime, duration || 0);
    }

    function getTelemetryScanPlaceholder(trackIndex) {
        if (audioAnalysisFailures.has(trackIndex)) return 'scan failed';
        return telemetryAudioScanStarted ? 'scan pending' : 'scan on open';
    }

    function formatMasterFormat(analysis, trackIndex) {
        if (!analysis) return getTelemetryScanPlaceholder(trackIndex);
        const sampleRateKHz = analysis.sampleRate / 1000;
        const sampleRateLabel = Number.isInteger(sampleRateKHz)
            ? sampleRateKHz.toFixed(0)
            : sampleRateKHz.toFixed(1);
        return `${sampleRateLabel} kHz • ${analysis.channelLabel}`;
    }

    function formatTrimmedDuration(metric) {
        if (!metric.audioAnalysis) return getTelemetryScanPlaceholder(metric.trackIndex);
        const trimmedDuration = Math.max(0, metric.audioAnalysis.duration - metric.audioAnalysis.leadingSilence - metric.audioAnalysis.trailingSilence);
        return formatTime(trimmedDuration);
    }

    function formatPeakDisplay(metric) {
        if (!metric.audioAnalysis) return getTelemetryScanPlaceholder(metric.trackIndex);
        const peakPercent = Number.isFinite(metric.audioAnalysis.duration) && metric.audioAnalysis.duration > 0
            ? Math.round((metric.audioAnalysis.peakTime / metric.audioAnalysis.duration) * 100)
            : null;
        const peakDb = Number.isFinite(metric.audioAnalysis.peakDb)
            ? `${metric.audioAnalysis.peakDb.toFixed(1)} dBFS`
            : '--';
        return peakPercent === null
            ? `${formatTime(metric.audioAnalysis.peakTime)} • ${peakDb}`
            : `${formatTime(metric.audioAnalysis.peakTime)} • ${peakPercent}% • ${peakDb}`;
    }

    function formatCeilingFlags(metric) {
        if (!metric.audioAnalysis) return getTelemetryScanPlaceholder(metric.trackIndex);
        if (!metric.audioAnalysis.clipBinCount) return 'clean';
        return `${metric.audioAnalysis.clipBinCount} hot bins`;
    }

    function renderWaveformSvg(metric) {
        if (!metric.audioAnalysis || !Array.isArray(metric.audioAnalysis.waveformBins) || !metric.audioAnalysis.waveformBins.length) {
            return `<div class="telemetry-wave-empty">${escapeHtml(getTelemetryScanPlaceholder(metric.trackIndex))}</div>`;
        }

        const analysis = metric.audioAnalysis;
        const width = 272;
        const height = 52;
        const midY = height / 2;
        const binCount = analysis.waveformBins.length;
        const barWidth = width / binCount;
        const safeDuration = analysis.duration > 0 ? analysis.duration : 1;
        const leadWidth = Math.max(0, Math.min(width, (analysis.leadingSilence / safeDuration) * width));
        const tailWidth = Math.max(0, Math.min(width, (analysis.trailingSilence / safeDuration) * width));
        const peakX = Math.max(0, Math.min(width, (analysis.peakTime / safeDuration) * width));
        const hotBins = new Set(analysis.hotBinIndexes || []);
        const markerStep = metric.totalBars > 96 ? 16 : metric.totalBars > 48 ? 8 : metric.totalBars > 24 ? 4 : 2;
        const barMarkers = [];
        if (metric.totalBars > 0) {
            for (let bar = markerStep; bar < metric.totalBars; bar += markerStep) {
                const x = Math.max(0, Math.min(width, (bar / metric.totalBars) * width));
                barMarkers.push(`<line x1="${x.toFixed(2)}" y1="4" x2="${x.toFixed(2)}" y2="${height - 4}" stroke="rgba(19, 37, 109, 0.12)" stroke-width="1"></line>`);
            }

            (metric.sectionBoundaries || []).forEach(boundaryBar => {
                const x = Math.max(0, Math.min(width, (boundaryBar / metric.totalBars) * width));
                barMarkers.push(`<line x1="${x.toFixed(2)}" y1="2" x2="${x.toFixed(2)}" y2="${height - 2}" stroke="rgba(245, 158, 11, 0.5)" stroke-width="1.5"></line>`);
            });
        }
        const bars = analysis.waveformBins.map((value, index) => {
            const amplitude = Math.max(0.04, Math.min(1, value));
            const barHeight = amplitude * (height - 8);
            const y = (height - barHeight) / 2;
            const x = index * barWidth;
            const fill = hotBins.has(index) ? '#b22137' : '#13256d';
            return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(1, barWidth - 0.9).toFixed(2)}" height="${barHeight.toFixed(2)}" rx="1" fill="${fill}" opacity="${hotBins.has(index) ? '0.9' : '0.72'}"></rect>`;
        }).join('');

        return `
            <svg class="telemetry-wave" data-track-index="${metric.trackIndex}" data-duration="${safeDuration.toFixed(3)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Waveform for ${escapeHtml(metric.title)}">
                <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(19, 37, 109, 0.04)"></rect>
                <rect x="0" y="0" width="${leadWidth.toFixed(2)}" height="${height}" fill="rgba(178, 33, 55, 0.08)"></rect>
                <rect x="${Math.max(0, width - tailWidth).toFixed(2)}" y="0" width="${tailWidth.toFixed(2)}" height="${height}" fill="rgba(178, 33, 55, 0.08)"></rect>
                <line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="rgba(19, 37, 109, 0.12)" stroke-width="1"></line>
                ${barMarkers.join('')}
                ${bars}
                <line x1="${peakX.toFixed(2)}" y1="2" x2="${peakX.toFixed(2)}" y2="${height - 2}" stroke="#f59e0b" stroke-width="2"></line>
                <line class="telemetry-wave-playhead" x1="0" y1="2" x2="0" y2="${height - 2}" opacity="0"></line>
            </svg>
        `;
    }

    function detectSilenceDuration(channelData, sampleRate, fromEnd = false) {
        if (!channelData.length || !channelData[0]?.length) return 0;
        const threshold = 0.003;
        const frameCount = channelData[0].length;
        const step = 128;

        if (fromEnd) {
            for (let frame = frameCount - 1; frame >= 0; frame -= step) {
                let blockPeak = 0;
                for (const channel of channelData) {
                    blockPeak = Math.max(blockPeak, Math.abs(channel[frame] || 0));
                }
                if (blockPeak > threshold) {
                    return (frameCount - frame) / sampleRate;
                }
            }
            return frameCount / sampleRate;
        }

        for (let frame = 0; frame < frameCount; frame += step) {
            let blockPeak = 0;
            for (const channel of channelData) {
                blockPeak = Math.max(blockPeak, Math.abs(channel[frame] || 0));
            }
            if (blockPeak > threshold) {
                return frame / sampleRate;
            }
        }

        return frameCount / sampleRate;
    }

    function analyzeAudioBuffer(audioBuffer, byteLength) {
        const channelCount = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const frameCount = audioBuffer.length;
        const channels = Array.from({ length: channelCount }, (_, channelIndex) => audioBuffer.getChannelData(channelIndex));
        const analysisStep = Math.max(1, Math.floor(sampleRate / 12000));
        const waveformBinCount = 96;
        const waveformBins = new Array(waveformBinCount).fill(0);
        const hotBinIndexes = [];
        let peak = 0;
        let peakFrame = 0;
        let energy = 0;
        let samplesRead = 0;
        let midEnergy = 0;
        let sideEnergy = 0;
        let leftEnergy = 0;
        let rightEnergy = 0;
        let crossEnergy = 0;

        for (let frame = 0; frame < frameCount; frame += analysisStep) {
            let framePeak = 0;
            let frameEnergy = 0;

            for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
                const sample = channels[channelIndex][frame] || 0;
                const magnitude = Math.abs(sample);
                frameEnergy += sample * sample;
                if (magnitude > framePeak) {
                    framePeak = magnitude;
                }
            }

            if (framePeak > peak) {
                peak = framePeak;
                peakFrame = frame;
            }

            energy += frameEnergy / Math.max(channelCount, 1);
            samplesRead++;

            if (channelCount >= 2) {
                const left = channels[0][frame] || 0;
                const right = channels[1][frame] || 0;
                const mid = (left + right) * 0.5;
                const side = (left - right) * 0.5;
                midEnergy += mid * mid;
                sideEnergy += side * side;
                leftEnergy += left * left;
                rightEnergy += right * right;
                crossEnergy += left * right;
            }
        }

        const rms = samplesRead > 0 ? Math.sqrt(energy / samplesRead) : 0;
        const crestFactorDb = peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : null;
        const rmsDb = rms > 0 ? 20 * Math.log10(rms) : null;
        const peakDb = peak > 0 ? 20 * Math.log10(peak) : null;
        const headroomDb = Number.isFinite(peakDb) ? Math.max(0, -peakDb) : null;
        const stereoWidthPct = channelCount >= 2 && (midEnergy + sideEnergy) > 0
            ? (sideEnergy / (midEnergy + sideEnergy)) * 100
            : 0;
        const monoCorrelation = channelCount >= 2 && leftEnergy > 0 && rightEnergy > 0
            ? Math.max(-1, Math.min(1, crossEnergy / Math.sqrt(leftEnergy * rightEnergy)))
            : null;
        const stereoBalanceDb = channelCount >= 2 && leftEnergy > 0 && rightEnergy > 0
            ? 10 * Math.log10((leftEnergy + Number.EPSILON) / (rightEnergy + Number.EPSILON))
            : null;
        const duration = audioBuffer.duration || 0;
        const bitrateKbps = duration > 0 ? (byteLength * 8) / (duration * 1000) : null;
        const leadingSilence = Math.min(detectSilenceDuration(channels, sampleRate, false), duration);
        const trailingSilence = Math.min(detectSilenceDuration(channels, sampleRate, true), duration);

        for (let binIndex = 0; binIndex < waveformBinCount; binIndex++) {
            const startFrame = Math.floor((binIndex / waveformBinCount) * frameCount);
            const endFrame = Math.min(frameCount, Math.floor(((binIndex + 1) / waveformBinCount) * frameCount));
            let binPeak = 0;

            for (let frame = startFrame; frame < endFrame; frame += analysisStep) {
                for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
                    const magnitude = Math.abs(channels[channelIndex][frame] || 0);
                    if (magnitude > binPeak) {
                        binPeak = magnitude;
                    }
                }
            }

            waveformBins[binIndex] = Number(binPeak.toFixed(4));
            if (binPeak >= 0.985) {
                hotBinIndexes.push(binIndex);
            }
        }

        let transientBins = 0;
        for (let binIndex = 1; binIndex < waveformBins.length - 1; binIndex++) {
            const current = waveformBins[binIndex];
            if (
                current >= 0.58 &&
                current > waveformBins[binIndex - 1] * 1.08 &&
                current > waveformBins[binIndex + 1] * 1.08
            ) {
                transientBins++;
            }
        }

        const transientDensity = duration > 0 ? transientBins / (duration / 60) : null;

        return {
            duration,
            sampleRate,
            channelCount,
            channelLabel: channelCount === 1 ? 'mono' : channelCount === 2 ? 'stereo' : `${channelCount}ch`,
            leadingSilence,
            trailingSilence,
            peakTime: peakFrame / sampleRate,
            peak,
            peakDb,
            headroomDb,
            rms,
            rmsDb,
            crestFactorDb,
            monoCorrelation,
            stereoBalanceDb,
            stereoWidthPct,
            bitrateKbps,
            transientDensity,
            waveformBins,
            hotBinIndexes,
            clipBinCount: hotBinIndexes.length
        };
    }

    async function analyzeTrackAudio(track, trackIndex) {
        const analysisSource = getVersionedAudioSrc(track, 'martin');
        if (!analysisSource) {
            audioAnalysisFailures.add(trackIndex);
            return;
        }

        const preloadedAudio = preloadedTrackAudio.get(trackIndex);
        if (preloadedAudio?.audioBuffer) {
            const analysis = analyzeAudioBuffer(
                preloadedAudio.audioBuffer,
                preloadedTrackByteLengths.get(trackIndex) || 0
            );
            setTrackPlaybackAnalysis(trackIndex, analysis);
            audioAnalysisFailures.delete(trackIndex);
            if (!trackDurations.has(trackIndex) && Number.isFinite(analysis.duration) && analysis.duration > 0) {
                trackDurations.set(trackIndex, analysis.duration);
            }
            return;
        }

        if (!telemetryAudioContext) {
            audioAnalysisFailures.add(trackIndex);
            return;
        }

        let audioBytes = await readCachedAudioBytes(analysisSource);
        if (!audioBytes) {
            const response = await fetch(analysisSource);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${analysisSource}: ${response.status}`);
            }
            audioBytes = await response.arrayBuffer();
            await storeCachedAudioBytes(analysisSource, audioBytes);
        }

        const decodedBuffer = await telemetryAudioContext.decodeAudioData(audioBytes.slice(0));
        const analysis = analyzeAudioBuffer(decodedBuffer, audioBytes.byteLength);
        setTrackPlaybackAnalysis(trackIndex, analysis);
        audioAnalysisFailures.delete(trackIndex);

        if (!trackDurations.has(trackIndex) && Number.isFinite(analysis.duration) && analysis.duration > 0) {
            trackDurations.set(trackIndex, analysis.duration);
        }
    }

    async function ensureTelemetryAudioAnalysis() {
        if (telemetryAudioScanStarted) return;
        telemetryAudioScanStarted = true;
        renderTelemetry();

        if (!AudioContextCtor) {
            telemetryAudioScanComplete = true;
            renderTelemetry();
            return;
        }

        telemetryAudioContext = new AudioContextCtor();
        try {
            await telemetryAudioContext.resume();
        } catch {
            // decodeAudioData can still work while suspended in most browsers
        }

        for (let trackIndex = 0; trackIndex < data.tracks.length; trackIndex++) {
            const track = data.tracks[trackIndex];
            try {
                await analyzeTrackAudio(track, trackIndex);
            } catch (error) {
                console.warn(`Telemetry scan failed for ${track.title}:`, error);
                audioAnalysisFailures.add(trackIndex);
            }
            renderTelemetry();
        }

        telemetryAudioScanComplete = true;
        if (telemetryAudioContext && typeof telemetryAudioContext.close === 'function') {
            telemetryAudioContext.close().catch(() => {});
        }
        telemetryAudioContext = null;
        renderTelemetry();
    }

    function getTrackMetrics(track, trackIndex) {
        const sections = getTrackSections(track);
        const chordNames = new Set();
        const chordSequence = [];
        let totalBeats = 0;
        let chordChanges = 0;
        let previousChord = null;
        let runningBars = 0;
        const sectionBoundaries = [];
        const sectionTimeline = [];
        const beatsPerBar = getBeatsPerBar(track);

        sections.forEach(section => {
            const chords = Array.isArray(section.chords) ? section.chords : [];
            totalBeats += chords.length;
            const sectionBars = chords.length > 0 ? chords.length / beatsPerBar : 0;
            const startBar = runningBars;
            if (runningBars > 0) {
                sectionBoundaries.push(runningBars);
            }
            sectionTimeline.push({
                label: section.label,
                startBar,
                endBar: startBar + sectionBars
            });
            runningBars += sectionBars;
            chords.forEach(chord => {
                if (chord) chordSequence.push(chord);
                if (chord) chordNames.add(chord);
                if (chord && previousChord && chord !== previousChord) {
                    chordChanges++;
                }
                if (chord) {
                    previousChord = chord;
                }
            });
        });

        const totalBars = totalBeats > 0 ? totalBeats / beatsPerBar : 0;
        const lyricLines = Array.isArray(track.lyrics)
            ? track.lyrics.filter(line => (line.line || '').trim()).length
            : 0;
        const bpm = Number.parseInt(track.tempo, 10);
        const estimatedDuration = Number.isFinite(bpm) && bpm > 0
            ? totalBeats * (track.timeSignature === '6/8' ? (60 / bpm) * 1.5 : 60 / bpm)
            : null;
        const measuredDuration = trackDurations.get(trackIndex);
        const effectiveDuration = Number.isFinite(measuredDuration) ? measuredDuration : estimatedDuration;
        const audioAnalysis = trackAudioAnalysis.get(trackIndex) || null;
        const harmonicAnalysis = analyzeHarmony(chordSequence);
        const lyricsAnalysis = analyzeLyrics(track.lyrics);
        const lyricDensity = Number.isFinite(effectiveDuration) && effectiveDuration > 0
            ? lyricLines / (effectiveDuration / 60)
            : null;
        const sectionChurn = Number.isFinite(effectiveDuration) && effectiveDuration > 0
            ? sections.length / (effectiveDuration / 60)
            : null;
        const harmonicTurnover = totalBars > 0 ? chordChanges / totalBars : null;
        const barsPerSection = sections.length > 0 ? totalBars / sections.length : null;

        return {
            trackIndex,
            title: track.title || `Track ${trackIndex + 1}`,
            bpm: Number.isFinite(bpm) ? bpm : null,
            timeSignature: track.timeSignature || 'n/a',
            capo: Math.max(0, Math.min(11, Number.parseInt(track.capo, 10) || 0)),
            moment: track.moment || '',
            worldCoordinates: normalizeWorldCoordinates(track.worldCoordinates),
            lyricLines,
            sectionCount: sections.length,
            totalBars,
            sectionBoundaries,
            sectionTimeline,
            totalBeats,
            chordChanges,
            harmonicTurnover,
            barsPerSection,
            lyricDensity,
            sectionChurn,
            uniqueChordCount: chordNames.size,
            chordNames: Array.from(chordNames),
            measuredDuration,
            estimatedDuration,
            effectiveDuration,
            hasMeasuredDuration: Number.isFinite(measuredDuration),
            audioAnalysis,
            harmonicAnalysis,
            lyricsAnalysis
        };
    }

    function formatDurationForTelemetry(metric) {
        if (metric.hasMeasuredDuration) return formatTime(metric.measuredDuration);
        if (Number.isFinite(metric.estimatedDuration)) return `${formatTime(metric.estimatedDuration)} est.`;
        return 'unavailable';
    }

    function renderTelemetry() {
        if (!telemetryEnabled) return;
        const metrics = data.tracks.map(getTrackMetrics);
        const measuredCount = metrics.filter(metric => metric.hasMeasuredDuration).length;
        const deepScanCount = metrics.filter(metric => metric.audioAnalysis).length;
        const effectiveDurations = metrics.filter(metric => Number.isFinite(metric.effectiveDuration));
        const medianRuntime = median(effectiveDurations.map(metric => metric.effectiveDuration));
        const longestTrack = effectiveDurations.reduce((best, metric) => {
            if (!best || metric.effectiveDuration > best.effectiveDuration) return metric;
            return best;
        }, null);
        const shortestTrack = effectiveDurations.reduce((best, metric) => {
            if (!best || metric.effectiveDuration < best.effectiveDuration) return metric;
            return best;
        }, null);
        const audioMetrics = metrics.filter(metric => metric.audioAnalysis);
        const totalMasterRuntime = metrics.reduce((sum, metric) => {
            const runtime = metric.audioAnalysis?.duration ?? metric.measuredDuration ?? metric.effectiveDuration;
            return sum + (Number.isFinite(runtime) ? runtime : 0);
        }, 0);
        const totalTrimmedRuntime = metrics.reduce((sum, metric) => {
            if (metric.audioAnalysis) {
                return sum + Math.max(0, metric.audioAnalysis.duration - metric.audioAnalysis.leadingSilence - metric.audioAnalysis.trailingSilence);
            }
            const fallbackRuntime = metric.measuredDuration ?? metric.effectiveDuration;
            return sum + (Number.isFinite(fallbackRuntime) ? fallbackRuntime : 0);
        }, 0);
        const runtimeSpread = longestTrack && shortestTrack
            ? longestTrack.effectiveDuration - shortestTrack.effectiveDuration
            : null;
        const totalDeadAir = audioMetrics.reduce((sum, metric) => {
            return sum + metric.audioAnalysis.leadingSilence + metric.audioAnalysis.trailingSilence;
        }, 0);
        const longestColdOpen = getExtremeMetric(audioMetrics, metric => metric.audioAnalysis.leadingSilence, true);
        const averageTailFade = average(audioMetrics.map(metric => metric.audioAnalysis.trailingSilence));
        const averageStereoWidth = average(audioMetrics.map(metric => metric.audioAnalysis.stereoWidthPct));
        const averageBitrate = average(audioMetrics.map(metric => metric.audioAnalysis.bitrateKbps));
        const averageMonoFold = average(audioMetrics.map(metric => metric.audioAnalysis.monoCorrelation).filter(value => Number.isFinite(value)));
        const medianHeadroom = median(audioMetrics.map(metric => metric.audioAnalysis.headroomDb).filter(value => Number.isFinite(value)));
        const widestStereo = getExtremeMetric(audioMetrics, metric => metric.audioAnalysis.stereoWidthPct, true);
        const highestCrestFactor = getExtremeMetric(audioMetrics, metric => metric.audioAnalysis.crestFactorDb, true);
        const hottestMaster = getExtremeMetric(audioMetrics, metric => metric.audioAnalysis.rmsDb, true);
        const safestMonoFold = getExtremeMetric(audioMetrics, metric => metric.audioAnalysis.monoCorrelation, true);
        const tightestHeadroom = getExtremeMetric(audioMetrics, metric => metric.audioAnalysis.headroomDb, false);
        const densestTransients = getExtremeMetric(audioMetrics, metric => metric.audioAnalysis.transientDensity, true);
        const hardestPanBias = audioMetrics.reduce((best, metric) => {
            if (!Number.isFinite(metric.audioAnalysis.stereoBalanceDb)) return best;
            if (!best || Math.abs(metric.audioAnalysis.stereoBalanceDb) > Math.abs(best.audioAnalysis.stereoBalanceDb)) {
                return metric;
            }
            return best;
        }, null);
        const averageHarmonicTurnover = average(metrics
            .map(metric => metric.harmonicTurnover)
            .filter(value => Number.isFinite(value))
        );
        const borrowedChordBudget = metrics.reduce((sum, metric) => sum + (metric.harmonicAnalysis.borrowedCount || 0), 0);
        const densestLyricFlow = getExtremeMetric(metrics, metric => metric.lyricDensity, true);
        const fastestSectionChurn = getExtremeMetric(metrics, metric => metric.sectionChurn, true);
        const wildestHarmony = getExtremeMetric(metrics, metric => metric.harmonicAnalysis.weirdnessScore, true);
        const stickiestHook = getExtremeMetric(metrics, metric => metric.lyricsAnalysis.topWordShare, true);
        const longestStanzaTrack = getExtremeMetric(metrics, metric => metric.lyricsAnalysis.maxStanzaLines, true);
        const richestLexicon = getExtremeMetric(metrics, metric => metric.lyricsAnalysis.uniqueWords, true);
        const averageStanzaSpan = average(metrics.map(metric => metric.lyricsAnalysis.avgStanzaLines).filter(value => Number.isFinite(value)));
        const waveformDetail = !AudioContextCtor
            ? 'waveform scan unavailable in this browser'
            : telemetryAudioScanStarted
                ? telemetryAudioScanComplete
                    ? 'waveform scan complete'
                    : 'waveform scan in progress'
                : 'waveform scan starts when telemetry opens';

        const statusParts = [
            `${measuredCount}/${metrics.length} headers`
        ];
        if (AudioContextCtor) {
            statusParts.push(`${deepScanCount}/${metrics.length} waveform scans`);
        } else {
            statusParts.push('waveform scan unavailable');
        }
        if (durationFailures.size > 0) {
            statusParts.push(`${durationFailures.size} header misses`);
        }
        if (audioAnalysisFailures.size > 0) {
            statusParts.push(`${audioAnalysisFailures.size} waveform misses`);
        }
        telemetryStatus.textContent = statusParts.join(' • ');

        const summaryCards = [
            {
                label: 'Album runtime',
                value: totalMasterRuntime ? formatTime(totalMasterRuntime) : '--:--',
                detail: measuredCount === metrics.length
                    ? 'sum of raw file durations across all masters'
                    : `${measuredCount}/${metrics.length} files resolved from headers`,
                reference: getRangeReference(totalMasterRuntime || null, 35 * 60, 50 * 60, formatTime, {
                    lowText: 'current album is short-form',
                    highText: 'current album is long-form'
                })
            },
            {
                label: 'Trimmed runtime',
                value: totalTrimmedRuntime ? formatTime(totalTrimmedRuntime) : '--:--',
                detail: deepScanCount === metrics.length
                    ? 'after removing detected cold opens and tail fades'
                    : deepScanCount > 0
                        ? `${deepScanCount}/${metrics.length} songs trimmed, raw fallback for the rest`
                        : waveformDetail,
                reference: getRangeReference(totalTrimmedRuntime || null, 32 * 60, 48 * 60, formatTime, {
                    lowText: 'current trimmed album is concise',
                    highText: 'current trimmed album is expansive'
                })
            },
            {
                label: 'Median runtime',
                value: medianRuntime ? formatTime(medianRuntime) : '--:--',
                detail: effectiveDurations.length ? 'center of the album runtime spread' : 'waiting for duration data',
                reference: getRangeReference(medianRuntime, 180, 270, formatTime, {
                    lowText: 'current song center is concise',
                    highText: 'current song center is extended'
                })
            },
            {
                label: 'Runtime spread',
                value: runtimeSpread ? formatTime(runtimeSpread) : '--:--',
                detail: longestTrack && shortestTrack
                    ? `${escapeHtml(shortestTrack.title)} to ${escapeHtml(longestTrack.title)}`
                    : 'waiting for duration data',
                reference: getRangeReference(runtimeSpread, 45, 150, formatTime, {
                    lowText: 'current set is tightly clustered',
                    highText: 'current set has wide runtime variance'
                })
            },
            {
                label: 'Dead air budget',
                value: audioMetrics.length ? formatSecondsMetric(totalDeadAir) : '--',
                detail: audioMetrics.length
                    ? 'combined lead-in and tail fade across scanned masters'
                    : waveformDetail,
                reference: getRangeReference(audioMetrics.length ? totalDeadAir : null, 0, 18, formatSecondsMetric, {
                    highText: 'current album carries extra dead air',
                    insideResolver: value => value <= 4 ? 'current very lean edges' : 'current inside dead-air band'
                })
            },
            {
                label: 'Longest cold open',
                value: longestColdOpen ? formatSecondsMetric(longestColdOpen.audioAnalysis.leadingSilence) : '--',
                detail: longestColdOpen
                    ? `${escapeHtml(longestColdOpen.title)} before first audible hit`
                    : waveformDetail,
                reference: getRangeReference(longestColdOpen?.audioAnalysis?.leadingSilence, 0, 2.5, formatSecondsMetric, {
                    highText: 'current cold open is long'
                })
            },
            {
                label: 'Average tail fade',
                value: averageTailFade ? formatSecondsMetric(averageTailFade) : '--',
                detail: audioMetrics.length
                    ? 'time spent dissolving into silence'
                    : waveformDetail,
                reference: getRangeReference(averageTailFade, 0.4, 4.0, formatSecondsMetric, {
                    lowText: 'current fades are abrupt',
                    highText: 'current fades are extended'
                })
            },
            {
                label: 'Average stereo width',
                value: averageStereoWidth !== null ? formatPercent(averageStereoWidth) : '--',
                detail: audioMetrics.length
                    ? 'side energy as share of scanned masters'
                    : waveformDetail,
                reference: getRangeReference(averageStereoWidth, 25, 65, formatPercent, {
                    lowText: 'current average field is narrow',
                    highText: 'current average field is wide'
                })
            },
            {
                label: 'Average mono fold',
                value: averageMonoFold !== null ? formatRatio(averageMonoFold) : '--',
                detail: audioMetrics.length
                    ? 'mean left/right correlation across masters'
                    : waveformDetail,
                reference: getRangeReference(averageMonoFold, 0.92, 1.0, formatRatio, {
                    lowText: 'current mono fold is risky',
                    highText: 'current mono fold is very tight'
                })
            },
            {
                label: 'Widest stereo field',
                value: widestStereo ? formatPercent(widestStereo.audioAnalysis.stereoWidthPct) : '--',
                detail: widestStereo
                    ? escapeHtml(widestStereo.title)
                    : waveformDetail,
                reference: getRangeReference(widestStereo?.audioAnalysis?.stereoWidthPct, 35, 80, formatPercent, {
                    lowText: 'current widest song is modest',
                    highText: 'current widest song is very wide'
                })
            },
            {
                label: 'Highest crest factor',
                value: highestCrestFactor ? formatDb(highestCrestFactor.audioAnalysis.crestFactorDb) : '--',
                detail: highestCrestFactor
                    ? `${escapeHtml(highestCrestFactor.title)} peak-to-body swing`
                    : waveformDetail,
                reference: getRangeReference(highestCrestFactor?.audioAnalysis?.crestFactorDb, 8, 14, formatDb, {
                    lowText: 'current album punch ceiling is restrained',
                    highText: 'current album punch ceiling is very dynamic'
                })
            },
            {
                label: 'Hottest master',
                value: hottestMaster ? formatDb(hottestMaster.audioAnalysis.rmsDb, 'dBFS') : '--',
                detail: hottestMaster
                    ? `${escapeHtml(hottestMaster.title)} average RMS floor`
                    : waveformDetail,
                reference: getRangeReference(hottestMaster?.audioAnalysis?.rmsDb, -16, -11, value => formatDb(value, 'dBFS'), {
                    lowText: 'current loudest master is still restrained',
                    highText: 'current loudest master is above common band'
                })
            },
            {
                label: 'Tightest headroom',
                value: tightestHeadroom ? formatHeadroom(tightestHeadroom.audioAnalysis.headroomDb) : '--',
                detail: tightestHeadroom
                    ? `${escapeHtml(tightestHeadroom.title)} below digital ceiling`
                    : waveformDetail,
                reference: getRangeReference(tightestHeadroom?.audioAnalysis?.headroomDb, 0.8, 2.0, formatHeadroom, {
                    lowText: 'current ceiling margin is very tight',
                    highText: 'current ceiling margin is generous'
                })
            },
            {
                label: 'Median headroom',
                value: medianHeadroom !== null ? formatHeadroom(medianHeadroom) : '--',
                detail: audioMetrics.length
                    ? 'center of the album ceiling margin'
                    : waveformDetail,
                reference: getRangeReference(medianHeadroom, 1.0, 3.0, formatHeadroom, {
                    lowText: 'current album runs close to ceiling',
                    highText: 'current album keeps extra ceiling'
                })
            },
            {
                label: 'Safest mono fold',
                value: safestMonoFold ? formatRatio(safestMonoFold.audioAnalysis.monoCorrelation) : '--',
                detail: safestMonoFold
                    ? `${escapeHtml(safestMonoFold.title)} left/right coherence`
                    : waveformDetail,
                reference: getRangeReference(safestMonoFold?.audioAnalysis?.monoCorrelation, 0.95, 1.0, formatRatio, {
                    lowText: 'current best mono fold is still only moderate',
                    highText: 'current best mono fold is very tight'
                })
            },
            {
                label: 'Hardest L/R bias',
                value: hardestPanBias ? formatStereoBalance(hardestPanBias.audioAnalysis.stereoBalanceDb) : '--',
                detail: hardestPanBias
                    ? escapeHtml(hardestPanBias.title)
                    : waveformDetail,
                reference: getRangeReference(hardestPanBias?.audioAnalysis?.stereoBalanceDb, 0, 0.6, value => `${value.toFixed(1)} dB`, {
                    absolute: true,
                    highText: 'current balance offset is outside common band',
                    insideResolver: value => value < 0.1 ? 'current nearly centered' : 'current inside balance band'
                })
            },
            {
                label: 'Most transient dense',
                value: densestTransients ? formatDensity(densestTransients.audioAnalysis.transientDensity) : '--',
                detail: densestTransients
                    ? `${escapeHtml(densestTransients.title)} impact spikes per minute`
                    : waveformDetail,
                reference: getRangeReference(densestTransients?.audioAnalysis?.transientDensity, 20, 75, formatDensity, {
                    lowText: 'current densest master is still sparse',
                    highText: 'current densest master is very busy'
                })
            },
            {
                label: 'Average bitrate',
                value: averageBitrate !== null ? formatBitrate(averageBitrate) : '--',
                detail: audioMetrics.length
                    ? 'derived from scanned master payload size'
                    : waveformDetail,
                reference: getRangeReference(averageBitrate, 192, 320, formatBitrate, {
                    lowText: 'current average bitrate is lean',
                    highText: 'current average bitrate is above common delivery'
                })
            },
            {
                label: 'Harmonic turnover',
                value: averageHarmonicTurnover !== null ? `${averageHarmonicTurnover.toFixed(2)}/bar` : '--',
                detail: averageHarmonicTurnover !== null ? 'mean chord changes per bar' : 'no arrangement data',
                reference: getRangeReference(averageHarmonicTurnover, 0.25, 0.8, value => `${value.toFixed(2)}/bar`, {
                    lowText: 'current harmony pace is slow-moving',
                    highText: 'current harmony pace is busy'
                })
            },
            {
                label: 'Borrowed chord budget',
                value: `${borrowedChordBudget}`,
                detail: 'non-diatonic detours across inferred song keys',
                reference: getRangeReference(borrowedChordBudget, 0, 8, formatCount, {
                    highText: 'current album borrows heavily',
                    insideResolver: value => value === 0 ? 'current fully diatonic set' : 'current inside borrowed-chord band'
                })
            },
            {
                label: 'Densest lyric flow',
                value: densestLyricFlow ? `${densestLyricFlow.lyricDensity.toFixed(1)}/min` : '--',
                detail: densestLyricFlow
                    ? escapeHtml(densestLyricFlow.title)
                    : 'waiting for lyric and duration data',
                reference: getRangeReference(densestLyricFlow?.lyricDensity, 8, 24, value => `${value.toFixed(1)}/min`, {
                    lowText: 'current lyric flow peak is sparse',
                    highText: 'current lyric flow peak is dense'
                })
            },
            {
                label: 'Fastest section churn',
                value: fastestSectionChurn ? `${fastestSectionChurn.sectionChurn.toFixed(2)}/min` : '--',
                detail: fastestSectionChurn
                    ? escapeHtml(fastestSectionChurn.title)
                    : 'waiting for arrangement and duration data',
                reference: getRangeReference(fastestSectionChurn?.sectionChurn, 1.0, 3.5, value => `${value.toFixed(2)}/min`, {
                    lowText: 'current arrangement pace is patient',
                    highText: 'current arrangement pace is rapid'
                })
            },
            {
                label: 'Wildest harmony',
                value: wildestHarmony ? escapeHtml(wildestHarmony.harmonicAnalysis.keyLabel) : '--',
                detail: wildestHarmony
                    ? `${escapeHtml(wildestHarmony.title)} • ${escapeHtml(wildestHarmony.harmonicAnalysis.weirdSummary)}`
                    : 'waiting for harmonic analysis',
                reference: getHarmonyWeirdnessReference(wildestHarmony?.harmonicAnalysis)
            },
            {
                label: 'Stickiest hook',
                value: stickiestHook ? formatPercent(stickiestHook.lyricsAnalysis.topWordShare) : '--',
                detail: stickiestHook
                    ? `${escapeHtml(stickiestHook.title)} • ${escapeHtml(stickiestHook.lyricsAnalysis.topWordsLabel)}`
                    : 'waiting for lyric analysis',
                reference: getHookReference(stickiestHook?.lyricsAnalysis)
            },
            {
                label: 'Longest stanza',
                value: longestStanzaTrack && Number.isFinite(longestStanzaTrack.lyricsAnalysis.maxStanzaLines)
                    ? `${longestStanzaTrack.lyricsAnalysis.maxStanzaLines} lines`
                    : '--',
                detail: longestStanzaTrack
                    ? escapeHtml(longestStanzaTrack.title)
                    : 'waiting for lyric analysis',
                reference: getRangeReference(longestStanzaTrack?.lyricsAnalysis?.maxStanzaLines, 4, 12, value => `${Math.round(value)} lines`, {
                    lowText: 'current longest stanza is compact',
                    highText: 'current longest stanza is extended'
                })
            },
            {
                label: 'Average stanza span',
                value: averageStanzaSpan !== null ? `${averageStanzaSpan.toFixed(1)} lines` : '--',
                detail: averageStanzaSpan !== null
                    ? 'mean stanza length across all songs'
                    : 'waiting for lyric analysis',
                reference: getRangeReference(averageStanzaSpan, 3, 8, value => `${value.toFixed(1)} lines`, {
                    lowText: 'current stanza average is terse',
                    highText: 'current stanza average is extended'
                })
            },
            {
                label: 'Richest lexicon',
                value: richestLexicon ? `${richestLexicon.lyricsAnalysis.uniqueWords}` : '--',
                detail: richestLexicon
                    ? `${escapeHtml(richestLexicon.title)} content words`
                    : 'waiting for lyric analysis',
                reference: getRangeReference(richestLexicon?.lyricsAnalysis?.uniqueWords, 30, 120, formatCount, {
                    lowText: 'current richest lexicon is still tight',
                    highText: 'current richest lexicon is expansive'
                })
            }
        ];

        telemetryGrid.innerHTML = summaryCards.map(card => `
            <article class="telemetry-card">
                <span class="telemetry-label">${card.label}</span>
                <strong class="telemetry-value">${card.value}</strong>
                <span class="telemetry-detail">${card.detail}</span>
            </article>
        `).join('');

        telemetryRecommendations.innerHTML = renderMasteringRecommendations(metrics, waveformDetail);
        refreshCurrentSongInfoPanel();

        telemetrySongs.innerHTML = `
            <p class="telemetry-table-note">Waveform guide: click anywhere on a waveform to play from that moment. Pink edge bands mark detected cold opens and tail fades, amber lines mark section changes plus the strongest transient, and red waveform bars flag near-ceiling bins that may deserve a mastering pass. Header notes show broad normal bands; each row now states where the current value sits against them.</p>
            <div class="telemetry-song-table-wrap">
                <table class="telemetry-song-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Song</th>
                            <th>Waveform<span class="telemetry-head-ref">normal balanced body, isolated hot peaks</span></th>
                            <th>Raw<span class="telemetry-head-ref">normal 3:00 to 5:00</span></th>
                            <th>Trimmed<span class="telemetry-head-ref">normal 2:45 to 4:45</span></th>
                            <th>Entry<span class="telemetry-head-ref">normal 0.00s to 1.50s</span></th>
                            <th>Tail<span class="telemetry-head-ref">normal 0.30s to 4.00s</span></th>
                            <th>Peak<span class="telemetry-head-ref">normal -6.0 dBFS to -0.8 dBFS</span></th>
                            <th>Ceiling<span class="telemetry-head-ref">normal 0 to 2 hot bins</span></th>
                            <th>Headroom<span class="telemetry-head-ref">normal 0.8 dB to 3.0 dB</span></th>
                            <th>Hotness<span class="telemetry-head-ref">normal -16.0 dBFS to -11.0 dBFS</span></th>
                            <th>Crest<span class="telemetry-head-ref">normal 8.0 dB to 14.0 dB</span></th>
                            <th>Mono<span class="telemetry-head-ref">normal 0.92 to 1.00</span></th>
                            <th>Balance<span class="telemetry-head-ref">normal within ±0.6 dB</span></th>
                            <th>Width<span class="telemetry-head-ref">normal 25% to 65%</span></th>
                            <th>Format<span class="telemetry-head-ref">normal 44.1-48 kHz stereo</span></th>
                            <th>Bitrate<span class="telemetry-head-ref">normal 192 to 320 kbps</span></th>
                            <th>Transients<span class="telemetry-head-ref">normal 20.0/min to 75.0/min</span></th>
                            <th>Key<span class="telemetry-head-ref">normal one stable tonic</span></th>
                            <th>Odd moves<span class="telemetry-head-ref">normal mostly diatonic, 0-2 detours</span></th>
                            <th>Turnover<span class="telemetry-head-ref">normal 0.25/bar to 0.80/bar</span></th>
                            <th>Hook words<span class="telemetry-head-ref">normal top word 4.0% to 14.0%</span></th>
                            <th>Stanzas<span class="telemetry-head-ref">normal 3-8 lines / 18-60 words</span></th>
                            <th>Lyric flow<span class="telemetry-head-ref">normal 8.0/min to 24.0/min</span></th>
                            <th>Section churn<span class="telemetry-head-ref">normal 1.00/min to 3.50/min</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${metrics.map(metric => {
                            const ceilingFlagClass = metric.audioAnalysis && metric.audioAnalysis.clipBinCount > 0
                                ? 'telemetry-mastering-flag telemetry-mastering-flag--hot'
                                : 'telemetry-mastering-flag telemetry-mastering-flag--clean';
                            const trimmedDuration = metric.audioAnalysis
                                ? Math.max(0, metric.audioAnalysis.duration - metric.audioAnalysis.leadingSilence - metric.audioAnalysis.trailingSilence)
                                : null;
                            const rawRuntimeReference = getRangeReference(metric.effectiveDuration, 180, 300, formatTime, {
                                lowText: 'current concise runtime',
                                highText: 'current extended runtime'
                            });
                            const trimmedRuntimeReference = getRangeReference(trimmedDuration, 165, 285, formatTime, {
                                lowText: 'current concise body',
                                highText: 'current extended body'
                            });
                            const entryReference = getRangeReference(metric.audioAnalysis?.leadingSilence, 0, 1.5, formatSecondsMetric, {
                                highText: 'current long cold open',
                                insideResolver: value => value <= 0.1 ? 'current punch-in start' : 'current inside entry band'
                            });
                            const tailReference = getRangeReference(metric.audioAnalysis?.trailingSilence, 0.3, 4.0, formatSecondsMetric, {
                                lowText: 'current abrupt tail',
                                highText: 'current long tail'
                            });
                            const peakReference = getRangeReference(metric.audioAnalysis?.peakDb, -6, -0.8, value => formatDb(value, 'dBFS'), {
                                lowText: 'current conservative peak',
                                highText: 'current near ceiling'
                            });
                            const ceilingReference = getRangeReference(metric.audioAnalysis?.clipBinCount, 0, 2, value => `${Math.round(value)} bins`, {
                                highText: 'current hot-bin heavy',
                                insideResolver: value => value === 0 ? 'current clean ceiling' : 'current controlled hot spots'
                            });
                            const headroomReference = getRangeReference(metric.audioAnalysis?.headroomDb, 0.8, 3.0, formatHeadroom, {
                                lowText: 'current tight ceiling margin',
                                highText: 'current generous ceiling margin'
                            });
                            const rmsReference = getRangeReference(metric.audioAnalysis?.rmsDb, -16, -11, value => formatDb(value, 'dBFS'), {
                                lowText: 'current restrained body',
                                highText: 'current hot body'
                            });
                            const crestReference = getRangeReference(metric.audioAnalysis?.crestFactorDb, 8, 14, formatDb, {
                                lowText: 'current compressed swing',
                                highText: 'current punchy swing'
                            });
                            const monoReference = getRangeReference(metric.audioAnalysis?.monoCorrelation, 0.92, 1.0, formatRatio, {
                                lowText: 'current mono fold risk',
                                highText: 'current very tight fold'
                            });
                            const balanceReference = getRangeReference(metric.audioAnalysis?.stereoBalanceDb, 0, 0.6, value => `${value.toFixed(1)} dB`, {
                                absolute: true,
                                highText: 'current outside common balance band',
                                insideResolver: value => value < 0.1 ? 'current centered' : 'current inside balance band'
                            });
                            const widthReference = getRangeReference(metric.audioAnalysis?.stereoWidthPct, 25, 65, formatPercent, {
                                lowText: 'current narrow field',
                                highText: 'current wide field'
                            });
                            const bitrateReference = getRangeReference(metric.audioAnalysis?.bitrateKbps, 192, 320, formatBitrate, {
                                lowText: 'current lean payload',
                                highText: 'current dense payload'
                            });
                            const transientReference = getRangeReference(metric.audioAnalysis?.transientDensity, 20, 75, formatDensity, {
                                lowText: 'current sparse attacks',
                                highText: 'current busy attack map'
                            });
                            const turnoverReference = getRangeReference(metric.harmonicTurnover, 0.25, 0.8, value => `${value.toFixed(2)}/bar`, {
                                lowText: 'current slow chord rhythm',
                                highText: 'current busy chord rhythm'
                            });
                            const lyricFlowReference = getRangeReference(metric.lyricDensity, 8, 24, value => `${value.toFixed(1)}/min`, {
                                lowText: 'current sparse lyric cadence',
                                highText: 'current dense lyric cadence'
                            });
                            const sectionChurnReference = getRangeReference(metric.sectionChurn, 1.0, 3.5, value => `${value.toFixed(2)}/min`, {
                                lowText: 'current patient arrangement pace',
                                highText: 'current rapid arrangement pace'
                            });

                            return `
                                <tr data-track-index="${metric.trackIndex}" class="${selectedTrackIndex === metric.trackIndex ? 'is-live' : ''}">
                                    <td class="telemetry-index-cell">${String(metric.trackIndex + 1).padStart(2, '0')}</td>
                                    <td class="telemetry-track-cell">
                                        <span class="telemetry-song-cell-title">${escapeHtml(metric.title)}</span>
                                        <span class="telemetry-song-cell-subtitle">${metric.bpm ? `${metric.bpm} BPM` : 'tempo n/a'} • ${escapeHtml(metric.timeSignature)} • ${formatBars(metric.totalBars)} bars</span>
                                    </td>
                                    <td class="telemetry-wave-cell">${renderWaveformSvg(metric)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(formatDurationForTelemetry(metric), rawRuntimeReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(formatTrimmedDuration(metric), trimmedRuntimeReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatSecondsMetric(metric.audioAnalysis.leadingSilence) : getTelemetryScanPlaceholder(metric.trackIndex), entryReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatSecondsMetric(metric.audioAnalysis.trailingSilence) : getTelemetryScanPlaceholder(metric.trackIndex), tailReference)}</td>
                                    <td class="telemetry-cell-medium">${renderTelemetryCell(formatPeakDisplay(metric), peakReference)}</td>
                                    <td class="telemetry-cell-medium">${renderTelemetryCell(`<span class="${ceilingFlagClass}">${formatCeilingFlags(metric)}</span>`, ceilingReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatHeadroom(metric.audioAnalysis.headroomDb) : getTelemetryScanPlaceholder(metric.trackIndex), headroomReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatDb(metric.audioAnalysis.rmsDb, 'dBFS') : getTelemetryScanPlaceholder(metric.trackIndex), rmsReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatDb(metric.audioAnalysis.crestFactorDb) : getTelemetryScanPlaceholder(metric.trackIndex), crestReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatRatio(metric.audioAnalysis.monoCorrelation) : getTelemetryScanPlaceholder(metric.trackIndex), monoReference)}</td>
                                    <td class="telemetry-cell-medium">${renderTelemetryCell(metric.audioAnalysis ? formatStereoBalance(metric.audioAnalysis.stereoBalanceDb) : getTelemetryScanPlaceholder(metric.trackIndex), balanceReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatPercent(metric.audioAnalysis.stereoWidthPct) : getTelemetryScanPlaceholder(metric.trackIndex), widthReference)}</td>
                                    <td class="telemetry-cell-medium">${renderTelemetryCell(formatMasterFormat(metric.audioAnalysis, metric.trackIndex), getFormatReference(metric.audioAnalysis))}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatBitrate(metric.audioAnalysis.bitrateKbps) : getTelemetryScanPlaceholder(metric.trackIndex), bitrateReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(metric.audioAnalysis ? formatDensity(metric.audioAnalysis.transientDensity) : getTelemetryScanPlaceholder(metric.trackIndex), transientReference)}</td>
                                    <td class="telemetry-cell-medium">${renderTelemetryCell(escapeHtml(metric.harmonicAnalysis.keyLabel), getKeyReference(metric.harmonicAnalysis))}</td>
                                    <td class="telemetry-cell-wide">${renderTelemetryCell(`${escapeHtml(metric.harmonicAnalysis.weirdSummary)}${metric.harmonicAnalysis.borrowedNames.length ? ` • ${escapeHtml(metric.harmonicAnalysis.borrowedNames.join(', '))}` : ''}`, getHarmonyWeirdnessReference(metric.harmonicAnalysis))}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(Number.isFinite(metric.harmonicTurnover) ? `${metric.harmonicTurnover.toFixed(2)}/bar` : 'n/a', turnoverReference)}</td>
                                    <td class="telemetry-cell-wide">${renderTelemetryCell(`${escapeHtml(metric.lyricsAnalysis.topWordsLabel)}${metric.lyricsAnalysis.uniqueWords ? ` • ${metric.lyricsAnalysis.uniqueWords} unique` : ''}`, getHookReference(metric.lyricsAnalysis))}</td>
                                    <td class="telemetry-cell-wide">${renderTelemetryCell(`${escapeHtml(metric.lyricsAnalysis.stanzaProfile)}${Number.isFinite(metric.lyricsAnalysis.avgStanzaWords) ? ` • ${metric.lyricsAnalysis.avgStanzaWords.toFixed(1)}W avg` : ''}`, getStanzaReference(metric.lyricsAnalysis))}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(Number.isFinite(metric.lyricDensity) ? `${metric.lyricDensity.toFixed(1)}/min` : 'n/a', lyricFlowReference)}</td>
                                    <td class="telemetry-cell-compact">${renderTelemetryCell(Number.isFinite(metric.sectionChurn) ? `${metric.sectionChurn.toFixed(2)}/min` : 'n/a', sectionChurnReference)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        updateLiveTelemetryAnalysis(true);
    }

    // Tab switching logic
    const tabNav = document.getElementById('tab-nav');
    tabNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        switchToTab(btn.dataset.tab);
    });

    function switchToTab(tabId) {
        const currentBtn = tabNav.querySelector('.tab-btn.active');
        if (currentBtn && currentBtn.dataset.tab === tabId) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const btn = tabNav.querySelector(`[data-tab="${tabId}"]`);
        if (btn) btn.classList.add('active');
        document.getElementById('tab-' + tabId).classList.add('active');
        if (appContainer) {
            appContainer.classList.toggle('telemetry-expanded', tabId === 'telemetry');
        }
        if (tabId === 'lyrics') {
            requestAnimationFrame(() => {
                recomputeChordLayout();
                updateProgressBars({ forceTimedContent: true });
            });
        }
        if (tabId === 'telemetry') {
            ensureTelemetryAudioAnalysis();
            updateLiveTelemetryAnalysis(true);
        }
    }

    if (appContainer) {
        appContainer.classList.toggle('telemetry-expanded', tabNav.querySelector('.tab-btn.active')?.dataset.tab === 'telemetry');
    }

    const tabContent = document.querySelector('.tab-content');
    const playerCover = document.querySelector('.player-cover');

    function syncMobileScrollLayout() {
        if (!appContainer || !playerBasic || !playerCover || !tabContent) return;
        if (window.matchMedia('(max-width: 768px)').matches) {
            if (playerCover.parentElement !== tabContent || tabNav.parentElement !== tabContent) {
                tabContent.prepend(playerCover, tabNav);
            }
            return;
        }

        if (playerCover.parentElement !== playerBasic) playerBasic.prepend(playerCover);
        if (tabNav.parentElement !== appContainer || tabNav.nextElementSibling !== tabContent) {
            appContainer.insertBefore(tabNav, tabContent);
        }
    }

    syncMobileScrollLayout();
    window.addEventListener('resize', syncMobileScrollLayout);

    telemetrySongs.addEventListener('click', (e) => {
        const waveform = e.target.closest('.telemetry-wave');
        if (!waveform) return;

        const trackIndex = parseInt(waveform.dataset.trackIndex, 10);
        if (!Number.isFinite(trackIndex) || trackIndex < 0 || trackIndex >= data.tracks.length) return;

        const rect = waveform.getBoundingClientRect();
        if (!rect.width) return;

        const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const metric = getTrackMetrics(data.tracks[trackIndex], trackIndex);
        const referenceDuration = Number.isFinite(metric.audioAnalysis?.duration)
            ? metric.audioAnalysis.duration
            : Number.parseFloat(waveform.dataset.duration);

        if (!Number.isFinite(referenceDuration) || referenceDuration <= 0) return;

        const startTime = clickRatio * referenceDuration;
        const track = data.tracks[trackIndex];

        if (currentTrack === track && preloadedTrackAudio.has(trackIndex)) {
            seekPlayback(startTime).catch(err => {
                console.error('Audio play error:', err);
                toggleBtn.disabled = false;
                setToggleIcon(true);
            });
            setToggleIcon(false);
            return;
        }

        selectSong(track, trackIndex, startTime, true);
    });

        function setAnimatedText(el, nextText) {
            if (el.textContent === nextText) return;
            el.textContent = nextText;
        }

        // Remove marquee behavior per request
        function updateLyricMarquee() {
        currentLyricDisplay?.classList.remove('marquee');
        }
    const contextMenu = document.getElementById('context-menu');
    let currentTrack = null;
    let currentSeekSections = [];
    let selectedTrackIndex = -1;
    let trackChangeAnimationTimer = 0;
    let activeSongVersion = 'martin';
    let currentVersionSource = '';
    let currentDaniSource = '';
    let versionAnalysisAudioContext = null;
    let lastUpdateTime = 0;
    let contextTarget = null;
    let immediateAutoplayRetryTimer = 0;
    let immediateAutoplayRetryCount = 0;
    let immediateAutoplayPending = false;
    let mediaSessionPositionTimer = 0;
    let playbackWakeLock = null;
    let audioContextLifecycleBound = false;
    let loopMode = 'none';
    let playerVolume = 1;
    let lastAudibleVolume = 1;
    const IMMEDIATE_AUTOPLAY_RETRY_MS = 700;
    const IMMEDIATE_AUTOPLAY_MAX_RETRIES = 240;

    try {
        const storedLoopMode = localStorage.getItem('sioto-loop-mode');
        if (['none', 'track', 'album'].includes(storedLoopMode)) loopMode = storedLoopMode;
        const storedVolume = Number.parseFloat(localStorage.getItem('sioto-volume'));
        if (Number.isFinite(storedVolume)) playerVolume = Math.max(0, Math.min(1, storedVolume));
        const storedInstrument = localStorage.getItem('sioto-chord-instrument');
        if (['guitar', 'ukulele', 'bass', 'violin', 'cello', 'piano'].includes(storedInstrument)) {
            selectedChordInstrument = storedInstrument;
        }
        const storedCapoFret = Number.parseInt(localStorage.getItem('sioto-chord-capo'), 10);
        if (Number.isFinite(storedCapoFret) && storedCapoFret >= 0 && storedCapoFret <= 11) {
            selectedCapoFret = storedCapoFret;
        }
    } catch {
        // Player preferences are optional when storage is unavailable.
    }
    if (playerVolume > 0) lastAudibleVolume = playerVolume;

    function updateVolumeControl() {
        const percent = Math.round(playerVolume * 100);
        if (volumeSlider) volumeSlider.value = String(percent);
        if (!volumeBtn) return;
        volumeBtn.setAttribute('aria-label', `Volume: ${percent}%. Open volume control`);
        volumeBtn.removeAttribute('aria-pressed');
        volumeBtn.title = `Volume: ${percent}%`;
        const icon = volumeBtn.querySelector('i');
        if (!icon) return;
        icon.className = `fa-solid ${percent === 0 ? 'fa-volume-xmark' : percent < 50 ? 'fa-volume-low' : 'fa-volume-high'}`;
    }

    function setPlayerVolume(value) {
        playerVolume = Math.max(0, Math.min(1, Number.parseFloat(value) || 0));
        if (playerVolume > 0) lastAudibleVolume = playerVolume;
        audioEngine.setVolume(playerVolume);
        updateVolumeControl();
        try { localStorage.setItem('sioto-volume', String(playerVolume)); } catch {}
    }

    function positionVolumePopover() {
        if (!volumeControl || !volumeBtn) return;
        const popover = document.getElementById('volume-popover');
        if (!popover) return;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const inset = 8;
        volumeControl.classList.remove('popover-above');
        volumeControl.style.setProperty('--volume-popover-shift-x', '0px');

        let buttonRect = volumeBtn.getBoundingClientRect();
        let popoverRect = popover.getBoundingClientRect();
        if (popoverRect.bottom > viewportHeight - inset && buttonRect.top - popoverRect.height - 8 >= inset) {
            volumeControl.classList.add('popover-above');
            popoverRect = popover.getBoundingClientRect();
        }

        let shiftX = 0;
        if (popoverRect.left < inset) shiftX += inset - popoverRect.left;
        if (popoverRect.right + shiftX > viewportWidth - inset) {
            shiftX -= popoverRect.right + shiftX - (viewportWidth - inset);
        }
        volumeControl.style.setProperty('--volume-popover-shift-x', `${Math.round(shiftX)}px`);
    }

    function queueVolumePopoverPosition() {
        requestAnimationFrame(() => requestAnimationFrame(positionVolumePopover));
    }

    function updateLoopModeControl() {
        if (!loopModeBtn) return;
        const labels = {
            none: 'Looping: off',
            track: 'Looping: current song',
            album: 'Looping: whole album'
        };
        loopModeBtn.dataset.loopMode = loopMode;
        loopModeBtn.setAttribute('aria-label', labels[loopMode]);
        loopModeBtn.title = `${labels[loopMode]}. Click to change.`;
        const icon = loopModeBtn.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-repeat';
    }

    function setLoopMode(nextMode) {
        if (!['none', 'track', 'album'].includes(nextMode) || nextMode === loopMode) return;
        const wasPlaying = webAudioPlayback.playing;
        const resumeAlbumTime = getCurrentAlbumTime();
        loopMode = nextMode;
        try { localStorage.setItem('sioto-loop-mode', loopMode); } catch {}
        updateLoopModeControl();
        if (wasPlaying) scheduleStitchedAlbumFrom(resumeAlbumTime);
    }

    function getCurrentSeekSectionIndex(
        currentTime = getPlaybackCurrentTime(),
        duration = getPlaybackDuration()
    ) {
        if (!currentTrack || !currentSeekSections.length) return -1;
        if (!duration) return -1;
        const ratio = Math.max(0, Math.min(1, currentTime / duration));
        const containingIndex = currentSeekSections.findIndex(section => ratio >= section.start && ratio < section.end);
        if (containingIndex >= 0) return containingIndex;
        for (let index = currentSeekSections.length - 1; index >= 0; index -= 1) {
            if (ratio >= currentSeekSections[index].start) return index;
        }
        return -1;
    }

    function updateSectionNavButtons(
        currentTime = getPlaybackCurrentTime(),
        duration = getPlaybackDuration()
    ) {
        const sectionIndex = getCurrentSeekSectionIndex(currentTime, duration);
        const hasSections = currentSeekSections.length > 0;
        const currentSection = currentSeekSections[sectionIndex];
        const currentSectionStart = currentSection && duration > 0 ? currentSection.start * duration : 0;
        const canRestartCurrentSection = Boolean(currentSection) && currentTime > currentSectionStart + 0.75;
        const prevDisabled = !hasSections || (sectionIndex <= 0 && !canRestartCurrentSection);
        const nextDisabled = !hasSections || sectionIndex >= currentSeekSections.length - 1;
        if (prevSectionBtn && prevSectionBtn.disabled !== prevDisabled) prevSectionBtn.disabled = prevDisabled;
        if (nextSectionBtn && nextSectionBtn.disabled !== nextDisabled) nextSectionBtn.disabled = nextDisabled;
    }

    function goToAdjacentSection(direction) {
        const currentIndex = getCurrentSeekSectionIndex();
        const duration = getPlaybackDuration();
        const currentSection = currentSeekSections[currentIndex];
        const currentSectionStart = currentSection && duration > 0 ? currentSection.start * duration : 0;
        const shouldRestartCurrentSection = direction < 0
            && Boolean(currentSection)
            && getPlaybackCurrentTime() > currentSectionStart + 0.75;
        const nextIndex = shouldRestartCurrentSection ? currentIndex : currentIndex + direction;
        const section = currentSeekSections[nextIndex];
        if (!section) return;
        const shouldAutoPlay = !isPlaybackPaused();
        void seekPlayback(section.start * duration, { autoPlay: shouldAutoPlay }).then(() => {
            setToggleIcon(!shouldAutoPlay);
            updateSectionNavButtons();
        });
    }

    function updateTrackNavButtons() {
        const hasSelection = selectedTrackIndex >= 0 && selectedTrackIndex < data.tracks.length;
        if (prevTrackBtn) prevTrackBtn.disabled = !hasSelection || selectedTrackIndex <= 0;
        if (nextTrackBtn) nextTrackBtn.disabled = !hasSelection || selectedTrackIndex >= data.tracks.length - 1;
    }

    function goToAdjacentTrack(direction) {
        if (selectedTrackIndex < 0) return;
        const nextIndex = selectedTrackIndex + direction;
        if (nextIndex < 0 || nextIndex >= data.tracks.length) return;
        const shouldAutoPlay = currentTrack ? !isPlaybackPaused() : false;
        selectSong(data.tracks[nextIndex], nextIndex, 0, shouldAutoPlay);
    }

    function getMediaSessionTitle(track, trackIndex) {
        if (!track) return '';
        const titleParts = [`${trackIndex + 1} ${track.title}`];
        if (track.feature) {
            titleParts.push(track.feature);
        }
        return titleParts.join(' / ');
    }

    function getMediaSessionPositionState() {
        const duration = getPlaybackDuration();
        const position = getPlaybackCurrentTime();
        if (!currentTrack || !Number.isFinite(duration) || duration <= 0) return null;

        return {
            duration,
            playbackRate: 1,
            position: Math.max(0, Math.min(duration, Number.isFinite(position) ? position : 0))
        };
    }

    function updateMediaSessionPositionState() {
        if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;

        try {
            const positionState = getMediaSessionPositionState();
            if (positionState) {
                navigator.mediaSession.setPositionState(positionState);
            }
        } catch {
            // Position state support is browser-specific and stricter on invalid values.
        }
    }

    function startMediaSessionPositionUpdates() {
        if (mediaSessionPositionTimer) return;
        mediaSessionPositionTimer = window.setInterval(updateMediaSessionPositionState, MEDIA_SESSION_POSITION_UPDATE_MS);
    }

    function stopMediaSessionPositionUpdates() {
        window.clearInterval(mediaSessionPositionTimer);
        mediaSessionPositionTimer = 0;
    }

    async function requestPlaybackWakeLock() {
        if (playbackWakeLock || isPlaybackPaused() || document.visibilityState !== 'visible') return;
        if (!('wakeLock' in navigator) || typeof navigator.wakeLock?.request !== 'function') return;

        try {
            playbackWakeLock = await navigator.wakeLock.request('screen');
            playbackWakeLock.addEventListener('release', () => {
                playbackWakeLock = null;
            }, { once: true });
        } catch {
            playbackWakeLock = null;
        }
    }

    function releasePlaybackWakeLock() {
        const lock = playbackWakeLock;
        playbackWakeLock = null;
        if (lock && typeof lock.release === 'function') {
            lock.release().catch(() => {});
        }
    }

    function syncMediaPlayerLifecycle() {
        updateMediaSessionPositionState();
        if (!currentTrack || isPlaybackPaused()) {
            stopMediaSessionPositionUpdates();
            releasePlaybackWakeLock();
            setMediaSessionPlaybackState('paused');
            return;
        }

        startMediaSessionPositionUpdates();
        void requestPlaybackWakeLock();
        setMediaSessionPlaybackState('playing');
    }

    function updateMediaSessionMetadata(track = currentTrack, trackIndex = selectedTrackIndex) {
        if (!('mediaSession' in navigator)) return;

        try {
            if (track && 'MediaMetadata' in window) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: getMediaSessionTitle(track, trackIndex),
                    artist: 'Sioto Jazz',
                    album: data.title || 'In a Race Against Time',
                    artwork: [
                        { src: 'album_cover_500x500.png', sizes: '500x500', type: 'image/png' },
                        { src: 'album_cover_1000x1000.png', sizes: '1000x1000', type: 'image/png' }
                    ]
                });
            }
            navigator.mediaSession.playbackState = track && !isPlaybackPaused() ? 'playing' : 'paused';
            updateMediaSessionPositionState();
        } catch {
            // Media Session is optional and varies across browsers.
        }
    }

    function setMediaSessionPlaybackState(state = null) {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.playbackState = state || (currentTrack && !isPlaybackPaused() ? 'playing' : 'paused');
            updateMediaSessionPositionState();
        } catch {
            // Ignore browsers with partial Media Session implementations.
        }
    }

    function playFromMediaSession() {
        if (!currentTrack) return;
        playPlayback().then(() => {
            setToggleIcon(false);
            setMediaSessionPlaybackState('playing');
        }).catch(err => {
            console.error('Audio play error:', err);
            toggleBtn.disabled = false;
            setToggleIcon(true);
            setMediaSessionPlaybackState('paused');
        });
    }

    function pauseFromMediaSession() {
        pausePlayback().finally(() => {
            setToggleIcon(true);
            setMediaSessionPlaybackState('paused');
        });
    }

    function stopFromMediaSession() {
        pausePlayback().finally(() => {
            if (currentTrack && selectedTrackIndex >= 0) {
                void seekPlayback(0, { autoPlay: false });
            }
            setToggleIcon(true);
            setMediaSessionPlaybackState('paused');
        });
    }

    function seekFromMediaSession(time) {
        if (!currentTrack || !Number.isFinite(time)) return;
        const duration = getPlaybackDuration();
        const nextTime = Math.max(0, Math.min(duration || time, time));
        void seekPlayback(nextTime, { autoPlay: !isPlaybackPaused() }).finally(updateMediaSessionPositionState);
    }

    function configureMediaSessionActions() {
        if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setActionHandler !== 'function') return;

        const handlers = {
            play: playFromMediaSession,
            pause: pauseFromMediaSession,
            previoustrack: () => goToAdjacentTrack(-1),
            nexttrack: () => goToAdjacentTrack(1),
            seekbackward: details => seekFromMediaSession(getPlaybackCurrentTime() - (details.seekOffset || MEDIA_SESSION_SEEK_SECONDS)),
            seekforward: details => seekFromMediaSession(getPlaybackCurrentTime() + (details.seekOffset || MEDIA_SESSION_SEEK_SECONDS)),
            seekto: details => seekFromMediaSession(details.seekTime),
            stop: stopFromMediaSession
        };

        Object.entries(handlers).forEach(([action, handler]) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch {
                // Some browsers support only a subset of actions.
            }
        });
    }

    function getTrackStartOffset(track) {
        const offset = Number.parseFloat(track?.startOffset);
        return Number.isFinite(offset) ? offset : 0;
    }

    function getTrackTiming(track) {
        const bpm = parseInt(track?.tempo, 10) || 120;
        const isSixEight = track?.timeSignature === '6/8';
        return {
            beatDuration: isSixEight ? (60 / bpm) * 1.5 : 60 / bpm,
            beatsPerBar: isSixEight ? 2 : 4,
            startOffset: getTrackStartOffset(track)
        };
    }

    function updateTempoDinosaur(track) {
        if (!tempoDino) return;

        const bpm = Number.parseInt(track?.tempo, 10);
        const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
        const beatSeconds = 60 / safeBpm;
        const energy = Math.max(0.82, Math.min(1.42, safeBpm / 120));
        const lift = 4.2 + energy * 1.6;
        const wag = 10 + energy * 5.4;

        tempoDino.classList.toggle('is-ready', Boolean(track));
        tempoDino.dataset.bpm = String(safeBpm);
        tempoDino.style.setProperty('--tempo-dino-beat', `${beatSeconds.toFixed(3)}s`);
        tempoDino.style.setProperty('--tempo-dino-step', `${(beatSeconds * 2).toFixed(3)}s`);
        tempoDino.style.setProperty('--tempo-dino-rise', `${(lift * -1).toFixed(2)}px`);
        tempoDino.style.setProperty('--tempo-dino-wag', `${wag.toFixed(2)}deg`);
        tempoDino.style.setProperty('--tempo-dino-tail-back', `${(wag * -0.7).toFixed(2)}deg`);
    }

    function getSongGridTime(track, audioTime) {
        const trackIndex = data.tracks.indexOf(track);
        const sourceTime = trackIndex >= 0
            ? getSourceTimeForPlaybackTime(trackIndex, audioTime)
            : (Number.parseFloat(audioTime) || 0);
        return sourceTime - getTrackStartOffset(track);
    }

    function buildSeekSectionRanges(track, duration) {
        const safeDuration = Number.parseFloat(duration);
        const sections = Array.isArray(track?.structure?.sections)
            ? track.structure.sections
            : [];
        if (!Number.isFinite(safeDuration) || safeDuration <= 0 || !sections.length) {
            return [];
        }

        const { beatDuration, startOffset } = getTrackTiming(track);
        let beatIndex = 0;
        return sections.map((section, sectionIndex) => {
            const beatCount = Array.isArray(section.chords) ? section.chords.length : 0;
            const startTime = startOffset + beatIndex * beatDuration;
            const endTime = startTime + beatCount * beatDuration;
            beatIndex += beatCount;

            const trackIndex = data.tracks.indexOf(track);
            const playbackStartTime = trackIndex >= 0 ? getPlaybackTimeForSourceTime(trackIndex, startTime) : startTime;
            const playbackEndTime = sectionIndex === sections.length - 1
                ? safeDuration
                : (trackIndex >= 0 ? getPlaybackTimeForSourceTime(trackIndex, endTime) : endTime);
            const start = Math.max(0, Math.min(1, playbackStartTime / safeDuration));
            const end = Math.max(0, Math.min(1, playbackEndTime / safeDuration));
            return {
                label: section.label || `Section ${sectionIndex + 1}`,
                start,
                end,
                index: sectionIndex
            };
        }).filter(section => section.end > section.start);
    }

    function refreshSeekSections(track = currentTrack, duration = getPlaybackDuration()) {
        currentSeekSections = buildSeekSectionRanges(track, duration);
        if (typeof glSeek.setSections === 'function') {
            glSeek.setSections(currentSeekSections);
        }
        updateSectionNavButtons();
    }

    function getSeekSectionAtRatio(ratio) {
        if (!currentSeekSections.length) return null;
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        return currentSeekSections.find(section => clampedRatio >= section.start && clampedRatio <= section.end) || null;
    }

    function hideSeekSectionTooltip() {
        if (!seekSectionTooltip) return;
        if (seekSectionTooltipHideTimer) {
            window.clearTimeout(seekSectionTooltipHideTimer);
            seekSectionTooltipHideTimer = 0;
        }
        seekSectionTooltip.classList.remove('is-visible');
    }

    function scheduleSeekSectionTooltipHide(delay = 1600) {
        if (!seekSectionTooltip) return;
        if (seekSectionTooltipHideTimer) window.clearTimeout(seekSectionTooltipHideTimer);
        seekSectionTooltipHideTimer = window.setTimeout(() => {
            seekSectionTooltipHideTimer = 0;
            seekSectionTooltip.classList.remove('is-visible');
        }, delay);
    }

    function updateSeekSectionTooltip(event) {
        if (!currentTrack || !seekSectionTooltip) return;
        const rect = seekCanvas.getBoundingClientRect();
        if (!rect.width) return;

        const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
        const section = getSeekSectionAtRatio(x / rect.width);
        if (!section) {
            hideSeekSectionTooltip();
            return;
        }

        seekSectionTooltip.textContent = section.label;
        seekSectionTooltip.style.left = `${x}px`;
        seekSectionTooltip.style.setProperty('--tooltip-shift', '0px');
        seekSectionTooltip.classList.add('is-visible');

        const tooltipRect = seekSectionTooltip.getBoundingClientRect();
        const containerRect = seekSectionTooltip.parentElement.getBoundingClientRect();
        const inset = 4;
        let shift = 0;
        if (tooltipRect.left < containerRect.left + inset) {
            shift = containerRect.left + inset - tooltipRect.left;
        } else if (tooltipRect.right > containerRect.right - inset) {
            shift = containerRect.right - inset - tooltipRect.right;
        }
        seekSectionTooltip.style.setProperty('--tooltip-shift', `${shift}px`);
    }

    function configureManagedAudioElement(element, { standby = false } = {}) {
        if (!element) return element;
        element.id = standby ? 'audio-player-standby' : 'audio-player';
        element.preload = useMobileMediaSessionAnchor && !standby ? 'auto' : 'none';
        element.playsInline = true;
        element.setAttribute('playsinline', '');
        element.setAttribute('webkit-playsinline', '');
        if (!standby) {
            element.dataset.transport = useMobileMediaSessionAnchor
                ? 'web-audio+media-session-anchor'
                : 'web-audio';
            if (useMobileMediaSessionAnchor) initializeMobileMediaSessionAnchor(element);
        }
        element.hidden = true;
        element.setAttribute('aria-hidden', 'true');
        return element;
    }

    function createSilentMediaSessionAnchorUrl() {
        const sampleRate = 8000;
        const sampleCount = sampleRate;
        const buffer = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(buffer);
        const writeText = (offset, text) => {
            for (let index = 0; index < text.length; index += 1) {
                view.setUint8(offset + index, text.charCodeAt(index));
            }
        };
        writeText(0, 'RIFF');
        view.setUint32(4, buffer.byteLength - 8, true);
        writeText(8, 'WAVE');
        writeText(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeText(36, 'data');
        view.setUint32(40, sampleCount * 2, true);
        return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    }

    function initializeMobileMediaSessionAnchor(element = audio) {
        if (!useMobileMediaSessionAnchor || !element) return;
        if (!mediaSessionAnchorUrl) mediaSessionAnchorUrl = createSilentMediaSessionAnchorUrl();
        element.loop = true;
        element.src = mediaSessionAnchorUrl;
        element.load();
    }

    function startMobileMediaSessionAnchor() {
        if (!useMobileMediaSessionAnchor) return Promise.resolve();
        if (!audio.src) initializeMobileMediaSessionAnchor(audio);
        if (!audio.paused) return Promise.resolve();
        const playPromise = audio.play();
        return playPromise?.then(() => {
            mediaSessionAnchorStartedAt = Date.now();
        }).catch(error => {
            // Web Audio can still play; a later user/media-session action retries the anchor.
            console.warn('Mobile media-session anchor could not start:', error);
        }) || Promise.resolve();
    }

    function pauseMobileMediaSessionAnchor() {
        if (!useMobileMediaSessionAnchor || audio.paused) return;
        mediaSessionAnchorExpectedPause = true;
        audio.pause();
        window.setTimeout(() => {
            mediaSessionAnchorExpectedPause = false;
        }, 100);
    }

    async function readAudioOutputDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) return new Map();
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return new Map(devices
                .filter(device => device.kind === 'audiooutput')
                .map(device => [device.deviceId, device.label || '']));
        } catch {
            return new Map();
        }
    }

    async function handleAudioDeviceChange() {
        const nextOutputs = await readAudioOutputDevices();
        if (
            !useMobileMediaSessionAnchor
            || isPlaybackPaused()
            || Date.now() - mediaSessionAnchorStartedAt < 3000
            || !knownAudioOutputDevices.size
        ) {
            knownAudioOutputDevices = nextOutputs;
            return;
        }

        const removedOutputs = [...knownAudioOutputDevices]
            .filter(([deviceId]) => deviceId && deviceId !== 'default' && !nextOutputs.has(deviceId));
        const removedPersonalAudio = removedOutputs.some(([, label]) =>
            /bluetooth|head(phone|set)|ear(phone|bud)|airpods?|wireless/i.test(label)
        );

        knownAudioOutputDevices = nextOutputs;
        if (removedPersonalAudio) {
            audio.dataset.lastInterruption = 'output-device-removed';
            await pausePlayback();
            setToggleIcon(true);
        }
    }

    function configureMobileAudioInterruptionHandling() {
        if (!useMobileMediaSessionAnchor) return;

        // Safari's Audio Session API reports phone-call and route interruptions.
        if ('audioSession' in navigator) {
            try {
                navigator.audioSession.type = 'playback';
                navigator.audioSession.addEventListener?.('statechange', () => {
                    if (navigator.audioSession.state === 'interrupted' && !isPlaybackPaused()) {
                        audio.dataset.lastInterruption = 'audio-session-interrupted';
                        void pausePlayback();
                        setToggleIcon(true);
                    }
                });
            } catch {
                // Audio Session is still implemented differently across browser versions.
            }
        }

        void readAudioOutputDevices().then(devices => {
            knownAudioOutputDevices = devices;
        });
        navigator.mediaDevices?.addEventListener?.('devicechange', () => {
            void handleAudioDeviceChange();
        });
    }

    function createGaplessAudioElement() {
        const element = configureManagedAudioElement(document.createElement('audio'), { standby: true });
        playerBasic.appendChild(element);
        return element;
    }

    function resetAudioElementSource(element) {
        if (!element) return;
        element.pause();
        element.removeAttribute('src');
        element.load();
    }

    function getResolvedAudioUrl(source) {
        if (!source) return '';
        try {
            return new URL(source, window.location.href).href;
        } catch {
            return source;
        }
    }

    function getTrackAudioEntry(trackIndex) {
        return preloadedTrackAudio.get(trackIndex) || null;
    }

    function getTrackPlaybackTrim(trackIndex) {
        if (trackPlaybackTrims.has(trackIndex)) {
            return trackPlaybackTrims.get(trackIndex);
        }

        const entry = getTrackAudioEntry(trackIndex);
        const rawDuration = entry?.audioBuffer?.duration || trackDurations.get(trackIndex) || 0;
        const analysis = trackAudioAnalysis.get(trackIndex);
        const leadingSilence = Number.isFinite(analysis?.leadingSilence) ? analysis.leadingSilence : 0;
        const trailingSilence = Number.isFinite(analysis?.trailingSilence) ? analysis.trailingSilence : 0;
        const sourceStart = Math.max(0, Math.min(rawDuration, leadingSilence));
        const sourceEnd = Math.max(sourceStart, rawDuration - Math.max(0, trailingSilence));
        const audibleDuration = Math.max(0, sourceEnd - sourceStart);
        const trim = audibleDuration > 0.05
            ? { rawDuration, sourceStart, sourceEnd, duration: audibleDuration }
            : { rawDuration, sourceStart: 0, sourceEnd: rawDuration, duration: rawDuration };
        trackPlaybackTrims.set(trackIndex, trim);
        return trim;
    }

    function setTrackPlaybackAnalysis(trackIndex, analysis) {
        trackAudioAnalysis.set(trackIndex, analysis);
        trackPlaybackTrims.delete(trackIndex);
    }

    function getSourceTimeForPlaybackTime(trackIndex, playbackTime = 0) {
        const trim = getTrackPlaybackTrim(trackIndex);
        const safeTime = Math.max(0, Math.min(trim.duration || 0, Number.parseFloat(playbackTime) || 0));
        return Math.max(0, Math.min(trim.rawDuration || 0, trim.sourceStart + safeTime));
    }

    function getPlaybackTimeForSourceTime(trackIndex, sourceTime = 0) {
        const trim = getTrackPlaybackTrim(trackIndex);
        return Math.max(0, Math.min(trim.duration || 0, (Number.parseFloat(sourceTime) || 0) - trim.sourceStart));
    }

    function getTrackAudioDuration(trackIndex) {
        const duration = getTrackPlaybackTrim(trackIndex).duration || 0;
        return Number.isFinite(duration) && duration > 0 ? duration : 0;
    }

    function rebuildStitchedAlbumTimeline({ preservePlayback = false } = {}) {
        const shouldPreserve = preservePlayback && selectedTrackIndex >= 0;
        const preservedTrackTime = shouldPreserve ? getPlaybackCurrentTime() : 0;
        const wasPlaying = shouldPreserve && webAudioPlayback.playing;
        const contextTime = wasPlaying ? audioEngine.getCurrentTime() : 0;
        const elapsed = wasPlaying ? Math.max(0, contextTime - webAudioPlayback.startContextTime) : 0;

        let cursor = 0;
        data.tracks.forEach((track, trackIndex) => {
            stitchedTrackStarts[trackIndex] = cursor;
            cursor += getTrackAudioDuration(trackIndex);
        });
        stitchedAlbumDuration = cursor;
        albumTotalTime.textContent = formatTime(stitchedAlbumDuration);

        if (shouldPreserve) {
            const rebasedAlbumTime = getAlbumTimeForTrackTime(selectedTrackIndex, preservedTrackTime);
            if (wasPlaying) {
                webAudioPlayback.startAlbumTime = Math.max(0, rebasedAlbumTime - elapsed);
            }
            webAudioPlayback.pausedAlbumTime = rebasedAlbumTime;
        }
    }

    function getAlbumTimeForTrackTime(trackIndex, trackTime = 0) {
        const safeIndex = Math.max(0, Math.min(data.tracks.length - 1, trackIndex));
        const duration = getTrackAudioDuration(safeIndex);
        const start = stitchedTrackStarts[safeIndex] || 0;
        const safeTime = Math.max(0, Math.min(duration || 0, Number.parseFloat(trackTime) || 0));
        return Math.max(0, Math.min(stitchedAlbumDuration || start + safeTime, start + safeTime));
    }

    function getTrackPositionFromAlbumTime(albumTime) {
        if (!data.tracks.length) {
            return { trackIndex: -1, trackTime: 0, duration: 0 };
        }

        const safeAlbumTime = Math.max(0, Math.min(stitchedAlbumDuration || 0, Number.parseFloat(albumTime) || 0));
        for (let trackIndex = data.tracks.length - 1; trackIndex >= 0; trackIndex -= 1) {
            const trackStart = stitchedTrackStarts[trackIndex] || 0;
            if (safeAlbumTime >= trackStart || trackIndex === 0) {
                const duration = getTrackAudioDuration(trackIndex);
                return {
                    trackIndex,
                    trackTime: Math.max(0, Math.min(duration, safeAlbumTime - trackStart)),
                    duration
                };
            }
        }

        return { trackIndex: 0, trackTime: 0, duration: getTrackAudioDuration(0) };
    }

    function getCurrentAlbumTime() {
        if (!webAudioPlayback.playing) {
            return Math.max(0, Math.min(stitchedAlbumDuration || 0, webAudioPlayback.pausedAlbumTime || 0));
        }

        const contextTime = audioEngine.getCurrentTime();
        const elapsed = Math.max(0, contextTime - webAudioPlayback.startContextTime);
        if (loopMode === 'track' && selectedTrackIndex >= 0) {
            const trackStart = stitchedTrackStarts[selectedTrackIndex] || 0;
            const trackDuration = getTrackAudioDuration(selectedTrackIndex);
            const initialTrackTime = Math.max(0, webAudioPlayback.startAlbumTime - trackStart);
            if (trackDuration > 0) return trackStart + ((initialTrackTime + elapsed) % trackDuration);
        }
        return Math.max(0, Math.min(stitchedAlbumDuration || 0, webAudioPlayback.startAlbumTime + elapsed));
    }

    function stopScheduledWebAudioSources() {
        const sources = webAudioPlayback.scheduledSources.splice(0);
        webAudioPlayback.scheduleToken += 1;
        sources.forEach(sourceNode => {
            try {
                sourceNode.onended = null;
                sourceNode.stop(0);
            } catch {
                // The source may already have finished naturally.
            }
        });
    }

    function scheduleStitchedAlbumFrom(albumTime) {
        let safeAlbumTime = Math.max(0, Math.min(stitchedAlbumDuration || 0, Number.parseFloat(albumTime) || 0));
        if (loopMode === 'track' && selectedTrackIndex >= 0) {
            const selectedTrackStart = stitchedTrackStarts[selectedTrackIndex] || 0;
            const selectedTrackDuration = getTrackAudioDuration(selectedTrackIndex);
            const requestedTrackTime = safeAlbumTime - selectedTrackStart;
            safeAlbumTime = selectedTrackStart + (
                requestedTrackTime >= 0 && requestedTrackTime < selectedTrackDuration
                    ? requestedTrackTime
                    : 0
            );
        }
        const position = getTrackPositionFromAlbumTime(safeAlbumTime);
        if (position.trackIndex < 0 || safeAlbumTime >= stitchedAlbumDuration) {
            finishPlaybackAtAlbumEnd(data.tracks.length - 1);
            return;
        }

        stopScheduledWebAudioSources();
        const token = webAudioPlayback.scheduleToken;
        const startAt = audioEngine.getCurrentTime() + WEB_AUDIO_START_DELAY_SECONDS;
        let nextStartAt = startAt;

        const lastScheduledTrackIndex = loopMode === 'track' ? position.trackIndex : data.tracks.length - 1;
        for (let trackIndex = position.trackIndex; trackIndex <= lastScheduledTrackIndex; trackIndex += 1) {
            const entry = getTrackAudioEntry(trackIndex);
            const audioBuffer = entry?.audioBuffer;
            if (!audioBuffer) break;

            const trim = getTrackPlaybackTrim(trackIndex);
            const playbackOffset = trackIndex === position.trackIndex ? position.trackTime : 0;
            const sourceOffset = getSourceTimeForPlaybackTime(trackIndex, playbackOffset);
            const sourceDuration = Math.max(0, trim.sourceEnd - sourceOffset);
            if (sourceDuration <= 0) continue;

            const sourceNode = audioEngine.createBufferSource(audioBuffer);
            if (!sourceNode) continue;
            sourceNode._siotoTrackIndex = trackIndex;

            if (loopMode === 'track') {
                sourceNode.loop = true;
                sourceNode.loopStart = trim.sourceStart;
                sourceNode.loopEnd = trim.sourceEnd;
            } else if (trackIndex === data.tracks.length - 1) {
                sourceNode.onended = () => {
                    if (webAudioPlayback.scheduleToken === token && webAudioPlayback.playing) {
                        if (loopMode === 'album') {
                            scheduleStitchedAlbumFrom(0);
                            return;
                        }
                        webAudioPlayback.playing = false;
                        webAudioPlayback.pausedAlbumTime = stitchedAlbumDuration;
                        webAudioPlayback.scheduledSources = [];
                        finishPlaybackAtAlbumEnd(trackIndex);
                    }
                };
            }

            if (loopMode === 'track') sourceNode.start(nextStartAt, sourceOffset);
            else sourceNode.start(nextStartAt, sourceOffset, sourceDuration);
            webAudioPlayback.scheduledSources.push(sourceNode);
            nextStartAt += sourceDuration;
        }

        webAudioPlayback.playing = true;
        webAudioPlayback.startContextTime = startAt;
        webAudioPlayback.startAlbumTime = safeAlbumTime;
        webAudioPlayback.pausedAlbumTime = safeAlbumTime;
        syncActiveTrackToPlaybackTime({ force: true });
    }

    function isTrackSourceScheduled(trackIndex) {
        return webAudioPlayback.scheduledSources.some(sourceNode => sourceNode?._siotoTrackIndex === trackIndex);
    }

    function scheduleLoadedFutureTracks() {
        if (!webAudioPlayback.playing || loopMode === 'track') return;

        const token = webAudioPlayback.scheduleToken;
        const now = audioEngine.getCurrentTime();
        const currentAlbumTime = getCurrentAlbumTime();

        for (let trackIndex = selectedTrackIndex; trackIndex < data.tracks.length; trackIndex += 1) {
            if (isTrackSourceScheduled(trackIndex)) continue;

            const entry = getTrackAudioEntry(trackIndex);
            const audioBuffer = entry?.audioBuffer;
            if (!audioBuffer) break;

            const trackStart = stitchedTrackStarts[trackIndex] || 0;
            const trackDuration = getTrackAudioDuration(trackIndex);
            const playbackOffset = Math.max(0, currentAlbumTime - trackStart);
            if (trackDuration <= 0 || playbackOffset >= trackDuration) continue;

            const startAt = webAudioPlayback.startContextTime + (trackStart - webAudioPlayback.startAlbumTime);
            if (startAt <= now + 0.02) continue;

            const trim = getTrackPlaybackTrim(trackIndex);
            const sourceDuration = Math.max(0, trim.sourceEnd - trim.sourceStart);
            if (sourceDuration <= 0) continue;

            const sourceNode = audioEngine.createBufferSource(audioBuffer);
            if (!sourceNode) continue;
            sourceNode._siotoTrackIndex = trackIndex;

            if (trackIndex === data.tracks.length - 1) {
                sourceNode.onended = () => {
                    if (webAudioPlayback.scheduleToken === token && webAudioPlayback.playing) {
                        if (loopMode === 'album') {
                            scheduleStitchedAlbumFrom(0);
                            return;
                        }
                        webAudioPlayback.playing = false;
                        webAudioPlayback.pausedAlbumTime = stitchedAlbumDuration;
                        webAudioPlayback.scheduledSources = [];
                        finishPlaybackAtAlbumEnd(trackIndex);
                    }
                };
            }

            sourceNode.start(startAt, trim.sourceStart, sourceDuration);
            webAudioPlayback.scheduledSources.push(sourceNode);
        }
    }

    function getPlaybackCurrentTime() {
        const position = getTrackPositionFromAlbumTime(getCurrentAlbumTime());
        return position.trackTime || 0;
    }

    function getPlaybackDuration() {
        return getTrackAudioDuration(selectedTrackIndex);
    }

    function isPlaybackPaused() {
        return !webAudioPlayback.playing;
    }

    function isAudioContextRunning() {
        return audioEngine.context?.state === 'running';
    }

    function bindAudioContextLifecycle() {
        if (audioContextLifecycleBound || !audioEngine.context) return;
        audioContextLifecycleBound = true;
        audioEngine.context.addEventListener('statechange', () => {
            if (webAudioPlayback.playing && audioEngine.context?.state === 'suspended' && document.visibilityState === 'visible') {
                audioEngine.resumeContext().catch(() => {});
            }
            syncMediaPlayerLifecycle();
        });
    }

    function clearImmediateAutoplayRetry() {
        window.clearTimeout(immediateAutoplayRetryTimer);
        immediateAutoplayRetryTimer = 0;
        immediateAutoplayRetryCount = 0;
        immediateAutoplayPending = false;
    }

    function scheduleImmediateAutoplayRetry() {
        window.clearTimeout(immediateAutoplayRetryTimer);
        immediateAutoplayRetryTimer = window.setTimeout(() => {
            void attemptImmediateAutoplay();
        }, IMMEDIATE_AUTOPLAY_RETRY_MS);
    }

    function dispatchSyntheticStartupActivation() {
        try {
            const eventInit = { bubbles: true, cancelable: true, view: window };
            const activationEvent = typeof PointerEvent === 'function'
                ? new PointerEvent('pointerdown', eventInit)
                : new MouseEvent('pointerdown', eventInit);
            document.dispatchEvent(activationEvent);
            document.body?.click();
        } catch {
            // Synthetic events do not create browser user activation, but this keeps startup paths unified.
        }
    }

    async function attemptImmediateAutoplay() {
        window.clearTimeout(immediateAutoplayRetryTimer);
        immediateAutoplayRetryTimer = 0;
        if (!currentTrack) return;

        immediateAutoplayPending = true;
        try {
            await playPlayback();
            if (isAudioContextRunning()) {
                clearImmediateAutoplayRetry();
                setToggleIcon(false);
                return;
            }
        } catch (err) {
            console.error('Audio play error:', err);
            toggleBtn.disabled = false;
        }

        if (immediateAutoplayRetryCount >= IMMEDIATE_AUTOPLAY_MAX_RETRIES) {
            immediateAutoplayPending = !isAudioContextRunning();
            return;
        }

        immediateAutoplayRetryCount += 1;
        scheduleImmediateAutoplayRetry();
    }

    function startImmediateAutoplayAttempts() {
        immediateAutoplayRetryCount = 0;
        immediateAutoplayPending = true;
        dispatchSyntheticStartupActivation();
        void attemptImmediateAutoplay();
    }

    async function playPlayback() {
        if (!currentTrack && data.tracks[0]) {
            selectSong(data.tracks[0], 0, 0, false);
        }
        if (!currentTrack) return;

        // Start the native anchor in the original interaction task, then let the
        // Web Audio scheduler remain the sole audible, sample-accurate transport.
        void startMobileMediaSessionAnchor();

        audioEngine.ensureContext();
        bindAudioContextLifecycle();
        const resumePromise = audioEngine.resumeContext();
        await Promise.race([
            resumePromise,
            new Promise(resolve => window.setTimeout(resolve, 250))
        ]);

        if (webAudioPlayback.playing) {
            if (!animationFrameId) {
                smoothUpdateLoop();
            }
            syncMediaPlayerLifecycle();
            return Promise.resolve();
        }

        scheduleStitchedAlbumFrom(webAudioPlayback.pausedAlbumTime || getAlbumTimeForTrackTime(selectedTrackIndex, getPlaybackCurrentTime()));
        if (!animationFrameId) {
            smoothUpdateLoop();
        }
        syncMediaPlayerLifecycle();
    }

    function pausePlayback() {
        if (webAudioPlayback.playing) {
            webAudioPlayback.pausedAlbumTime = getCurrentAlbumTime();
        }
        webAudioPlayback.playing = false;
        clearImmediateAutoplayRetry();
        stopScheduledWebAudioSources();
        pauseMobileMediaSessionAnchor();
        syncMediaPlayerLifecycle();
        updateLiveTelemetryAnalysis(true);
        updateSectionNavButtons();
        renderLyricsWaveform(getPlaybackCurrentTime(), { force: true });
        return Promise.resolve();
    }

    function seekPlayback(time, { autoPlay = true } = {}) {
        const targetAlbumTime = getAlbumTimeForTrackTime(selectedTrackIndex, time);
        const wasPlaying = webAudioPlayback.playing;
        webAudioPlayback.pausedAlbumTime = targetAlbumTime;
        webAudioPlayback.playing = false;
        stopScheduledWebAudioSources();

        const position = getTrackPositionFromAlbumTime(targetAlbumTime);
        if (position.trackIndex !== selectedTrackIndex && data.tracks[position.trackIndex]) {
            selectSong(data.tracks[position.trackIndex], position.trackIndex, position.trackTime, false, {
                preservePlayback: true
            });
        }

        glSeek.render(getPlaybackDuration() ? getPlaybackCurrentTime() / getPlaybackDuration() : 0);
        updateSectionNavButtons();
        renderLyricsWaveform(getPlaybackCurrentTime(), { force: true });
        updateLiveTelemetryAnalysis(true);
        updateMediaSessionPositionState();

        if (autoPlay || wasPlaying) {
            return playPlayback();
        }
        return Promise.resolve();
    }

    function syncActiveTrackToPlaybackTime({ force = false } = {}) {
        if (!force && !webAudioPlayback.playing) return;
        const position = getTrackPositionFromAlbumTime(getCurrentAlbumTime());
        if (position.trackIndex < 0 || position.trackIndex === selectedTrackIndex) return;
        const track = data.tracks[position.trackIndex];
        if (!track) return;
        selectSong(track, position.trackIndex, position.trackTime, false, {
            preservePlayback: true
        });
    }

    function getBeatStartTime(track, beatNumber) {
        const { beatDuration, startOffset } = getTrackTiming(track);
        const sourceTime = startOffset + Math.max(0, (parseInt(beatNumber, 10) || 1) - 1) * beatDuration;
        const trackIndex = data.tracks.indexOf(track);
        return trackIndex >= 0 ? getPlaybackTimeForSourceTime(trackIndex, sourceTime) : sourceTime;
    }

    function getBarStartTime(track, barNumber, lineOffset = 0) {
        const { beatDuration, beatsPerBar, startOffset } = getTrackTiming(track);
        const barIndex = Math.max(0, Number.parseFloat(barNumber) || 0);
        const offset = Number.parseFloat(lineOffset);
        const sourceTime = startOffset + (barIndex * beatsPerBar * beatDuration) + (Number.isFinite(offset) ? offset : 0);
        const trackIndex = data.tracks.indexOf(track);
        return trackIndex >= 0 ? getPlaybackTimeForSourceTime(trackIndex, sourceTime) : sourceTime;
    }

    function buildLyricTimingEntries(track, lyricLines) {
        const { beatDuration, beatsPerBar } = getTrackTiming(track);
        const entries = lyricLines.map((line, order) => {
            const length = Number.parseFloat(line.dataset.length) || 1;
            const parsedBarNumber = Number.parseFloat(line.dataset.bar);
            const barNumber = Number.isFinite(parsedBarNumber) ? parsedBarNumber : 1;
            const offset = Number.parseFloat(line.dataset.offset) || 0;
            const startTime = getBarStartTime(track, barNumber, offset);
            const naturalEndTime = startTime + (length * beatsPerBar * beatDuration);

            return {
                line,
                order,
                barNumber,
                offset,
                startTime,
                endTime: naturalEndTime,
                naturalEndTime
            };
        }).sort((a, b) => (a.startTime - b.startTime) || (a.order - b.order));

        entries.forEach((entry, entryIndex) => {
            for (let nextIndex = entryIndex + 1; nextIndex < entries.length; nextIndex += 1) {
                const nextEntry = entries[nextIndex];
                if (nextEntry.startTime >= entry.endTime) break;
                if (nextEntry.barNumber === entry.barNumber) continue;

                if (entry.offset !== 0 || nextEntry.offset !== 0) {
                    entry.endTime = Math.min(entry.endTime, nextEntry.startTime);
                    break;
                }
            }
        });

        return entries.sort((a, b) => a.order - b.order);
    }

    function formatTimeParam(seconds) {
        const time = Number.parseFloat(seconds);
        if (!Number.isFinite(time)) return '0';
        return time.toFixed(3).replace(/\.?0+$/, '');
    }

    function generateSongLink(trackIndex) {
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('song', String(trackIndex));
        return url.href;
    }

    function updateURL(trackIndex) {
        const url = generateSongLink(trackIndex);
        history.replaceState({ song: trackIndex }, '', url);
    }

    function getVersionedAudioSrc(track, version = activeSongVersion) {
        return getVersionedAudioSources(track, version)[0] || '';
    }

    function getVersionedAudioSources(track, version = activeSongVersion) {
        const baseSrc = String(track?.mp3 || '').trim();
        if (!baseSrc || version !== 'dani') return baseSrc ? [baseSrc] : [];

        const queryIndex = baseSrc.search(/[?#]/);
        const cleanSrc = queryIndex === -1 ? baseSrc : baseSrc.slice(0, queryIndex);
        const suffix = queryIndex === -1 ? '' : baseSrc.slice(queryIndex);
        const slashIndex = Math.max(cleanSrc.lastIndexOf('/'), cleanSrc.lastIndexOf('\\'));
        const directory = slashIndex === -1 ? '' : cleanSrc.slice(0, slashIndex + 1);
        const fileName = slashIndex === -1 ? cleanSrc : cleanSrc.slice(slashIndex + 1);
        const extensionIndex = fileName.lastIndexOf('.');
        const fileBase = extensionIndex === -1 ? fileName : fileName.slice(0, extensionIndex);
        const extension = extensionIndex === -1 ? '' : fileName.slice(extensionIndex);
        const primary = `${directory}dani_${fileName}${suffix}`;
        const sources = [primary];

        if (extension.toLowerCase() !== '.wav') {
            sources.push(`${directory}dani_${fileBase}.wav${suffix}`);
        }

        return sources;
    }

    function setAudioSourceForCurrentVersion(track) {
        currentVersionSource = activeSongVersion === 'dani' && selectedTrackIndex >= 0
            ? trackDaniSources.get(selectedTrackIndex) || ''
            : getVersionedAudioSrc(track, 'martin');
    }

    function setVersionToggleMessage(message = '') {
        if (!versionToggleMessage) return;
        versionToggleMessage.textContent = message;
    }

    function canLoadAudioMetadata(source) {
        return new Promise(resolve => {
            if (!source) {
                resolve(false);
                return;
            }

            const probe = new Audio();
            let settled = false;
            const settle = value => {
                if (settled) return;
                settled = true;
                probe.removeAttribute('src');
                probe.load();
                resolve(value);
            };

            probe.preload = 'metadata';
            probe.addEventListener('loadedmetadata', () => settle(true), { once: true });
            probe.addEventListener('error', () => settle(false), { once: true });
            probe.src = source;
            probe.load();
            window.setTimeout(() => settle(false), 4500);
        });
    }

    async function canLoadAudioSource(source) {
        if (!source) return false;
        if (versionAvailability.has(source)) {
            return versionAvailability.get(source);
        }

        let available = false;
        try {
            const response = await fetch(source, { method: 'HEAD' });
            available = response.ok;
        } catch {
            available = false;
        }

        if (!available) {
            available = await canLoadAudioMetadata(source);
        }

        versionAvailability.set(source, available);
        return available;
    }

    async function findAvailableAudioSource(sources) {
        for (const source of sources) {
            if (await canLoadAudioSource(source)) {
                return source;
            }
        }

        return '';
    }

    function updateTrackVersionRows() {
        const isDaniMode = activeSongVersion === 'dani';
        songList.querySelectorAll('.song-item').forEach((songItem, trackIndex) => {
            const unavailable = isDaniMode && !trackDaniSources.has(trackIndex);
            songItem.classList.toggle('version-unavailable', unavailable);
            songItem.setAttribute(
                'aria-disabled',
                unavailable ? 'true' : 'false'
            );
        });
    }

    async function updateTrackDaniAvailability(track, trackIndex) {
        const daniSource = await findAvailableAudioSource(getVersionedAudioSources(track, 'dani'));
        if (daniSource) {
            trackDaniSources.set(trackIndex, daniSource);
        } else {
            trackDaniSources.delete(trackIndex);
        }
        updateTrackVersionRows();
        return daniSource;
    }

    function updateVersionToggleState() {
        const isDaniMode = activeSongVersion === 'dani';
        if (versionToggle) {
            versionToggle.classList.toggle('is-dani', isDaniMode);
            versionToggle.dataset.version = activeSongVersion;
            versionToggle.setAttribute('aria-pressed', String(isDaniMode));
            versionToggle.disabled = !data.tracks.length;
            versionToggle.setAttribute('aria-label', `Switch to ${isDaniMode ? 'Martin' : 'Dani'} versions`);
        }
        if (versionToggleLabel) {
            versionToggleLabel.textContent = isDaniMode ? 'Dani' : 'Martin';
        }
        updateTrackVersionRows();
    }

    async function updateCurrentVersionAvailability(track, trackIndex) {
        currentDaniSource = '';
        updateVersionToggleState();
        const daniSource = await updateTrackDaniAvailability(track, trackIndex);

        if (currentTrack !== track || selectedTrackIndex !== trackIndex) {
            return;
        }

        currentDaniSource = daniSource;
        updateVersionToggleState();
    }

    async function scanDaniVersionAvailability() {
        await Promise.all(data.tracks.map((track, trackIndex) => updateTrackDaniAvailability(track, trackIndex)));
        if (currentTrack && selectedTrackIndex >= 0) {
            currentDaniSource = trackDaniSources.get(selectedTrackIndex) || '';
        }
        updateVersionToggleState();
    }

    function detectFirstNonSilentSampleTime(channelData, sampleRate) {
        if (!channelData.length || !channelData[0]?.length || !sampleRate) return 0;
        const threshold = 0.003;
        const frameCount = channelData[0].length;

        for (let frame = 0; frame < frameCount; frame += 1) {
            for (const channel of channelData) {
                if (Math.abs(channel[frame] || 0) > threshold) {
                    return frame / sampleRate;
                }
            }
        }

        return frameCount / sampleRate;
    }

    function getVersionAnalysisContext() {
        if (!AudioContextCtor) return null;
        if (!versionAnalysisAudioContext) {
            versionAnalysisAudioContext = new AudioContextCtor();
        }
        return versionAnalysisAudioContext;
    }

    async function getLeadingSilenceForSource(source, track, version) {
        if (!source) return 0;
        if (version === 'martin' && selectedTrackIndex >= 0) {
            const existingAnalysis = trackAudioAnalysis.get(selectedTrackIndex);
            if (Number.isFinite(existingAnalysis?.leadingSilence)) {
                return existingAnalysis.leadingSilence;
            }
        }
        if (versionLeadingSilence.has(source)) {
            return versionLeadingSilence.get(source);
        }

        const context = getVersionAnalysisContext();
        if (!context) return 0;

        try {
            const response = await fetch(source);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${source}: ${response.status}`);
            }

            const audioBytes = await response.arrayBuffer();
            const decodedBuffer = await context.decodeAudioData(audioBytes.slice(0));
            const channels = Array.from(
                { length: decodedBuffer.numberOfChannels },
                (_, channelIndex) => decodedBuffer.getChannelData(channelIndex)
            );
            const leadingSilence = Math.min(detectFirstNonSilentSampleTime(channels, decodedBuffer.sampleRate), decodedBuffer.duration || 0);
            versionLeadingSilence.set(source, leadingSilence);
            return leadingSilence;
        } catch (err) {
            console.warn('Could not measure version leading silence:', err);
            versionLeadingSilence.set(source, 0);
            return 0;
        }
    }

    async function getSyncedVersionTime(track, resumeTime, previousVersion, nextVersion, targetSource) {
        const previousSource = currentVersionSource || getVersionedAudioSrc(track, previousVersion);
        const [previousLead, nextLead] = await Promise.all([
            getLeadingSilenceForSource(previousSource, track, previousVersion),
            getLeadingSilenceForSource(targetSource, track, nextVersion)
        ]);
        const musicalTime = Math.max(0, resumeTime - previousLead);
        return Math.max(0, nextLead + musicalTime);
    }

    function primeNextTrackPreload() {}

    function clearGaplessPreparedTrack() {
        gaplessPreparedTrack = null;
        scheduledGaplessBuffer = null;
    }

    function scheduleGaplessBufferIfPossible() {}

    function maybePrepareNextTrack() {}

    function buildTrackMetaText(track) {
        if (!track) return '';

        const metaParts = [];
        const tempo = Number.parseInt(track.tempo, 10);
        if (Number.isFinite(tempo) && tempo > 0) {
            metaParts.push(`${tempo} BPM`);
        }
        if (track.timeSignature) {
            metaParts.push(track.timeSignature);
        }
        const sectionCount = Array.isArray(track.structure?.sections)
            ? track.structure.sections.length
            : 0;
        if (sectionCount > 0) {
            metaParts.push(`${sectionCount} sections`);
        }
        const status = getTrackStatusLabel(track.status);
        if (status) {
            metaParts.push(status);
        }

        return metaParts.join(' · ');
    }

    function finishPlaybackAtAlbumEnd(trackIndex) {
        webAudioPlayback.playing = false;
        pauseMobileMediaSessionAnchor();
        stopMediaSessionPositionUpdates();
        releasePlaybackWakeLock();
        toggleBtn.disabled = false;
        setToggleIcon(true);
        glSeek.render(0);
        if (currentLyricDisplay) currentLyricDisplay.textContent = '';
        updateLiveLyricsStack([], -1, true);
        lyricsContent.querySelectorAll('.lyrics-line').forEach(line => {
            line.classList.remove('active');
            line.classList.add('passed');
        });
        structureContent.querySelectorAll('.structure-chord').forEach(chord => {
            chord.classList.remove('active');
            chord.classList.add('passed');
        });
        structureContent.querySelectorAll('.chord-progress').forEach(progress => progress.style.setProperty('--progress', 0));
        updateURL(trackIndex);
        setMediaSessionPlaybackState('none');
    }

    async function startGaplessTransition() {
        if (selectedTrackIndex < 0 || selectedTrackIndex >= data.tracks.length - 1) {
            finishPlaybackAtAlbumEnd(selectedTrackIndex);
            return;
        }
        selectSong(data.tracks[selectedTrackIndex + 1], selectedTrackIndex + 1, 0, true);
    }

    async function switchSongVersion(nextVersion) {
        if (nextVersion === activeSongVersion) return;
        if (nextVersion !== 'martin') {
            setVersionToggleMessage('Only the preloaded album version is available in this player');
            updateVersionToggleState();
            return;
        }
        activeSongVersion = 'martin';
        currentDaniSource = '';
        setVersionToggleMessage('');
        updateVersionToggleState();
    }

    function triggerTrackChangeAnimation(nextTrackIndex, previousTrackIndex) {
        if (!playerBasic || nextTrackIndex === previousTrackIndex) return;

        window.clearTimeout(trackChangeAnimationTimer);

        playerBasic.classList.remove('is-track-changing');
        songList.querySelectorAll('.song-item.is-track-entering').forEach(item => {
            item.classList.remove('is-track-entering');
        });

        void playerBasic.offsetWidth;
        playerBasic.classList.add('is-track-changing');

        const enteringSongItem = songList.querySelector(`.song-item[data-track-index="${nextTrackIndex}"]`);
        if (enteringSongItem) {
            enteringSongItem.classList.add('is-track-entering');
        }

        trackChangeAnimationTimer = window.setTimeout(() => {
            playerBasic.classList.remove('is-track-changing');
            enteringSongItem?.classList.remove('is-track-entering');
        }, 420);
    }

    function selectSong(track, trackIndex, startTime = 0, autoPlay = true, options = {}) {
        const songItem = songList.querySelector(`.song-item[data-track-index="${trackIndex}"]`);
        const audioEntry = getTrackAudioEntry(trackIndex);
        if (!track || !songItem) {
            console.error(`No song found for index: ${trackIndex}`);
            toggleBtn.disabled = false;
            setToggleIcon(true);
            return;
        }

        if (!audioEntry?.audioBuffer) {
            const pendingSelectionToken = ++selectSongLoadToken;
            const source = getVersionedAudioSrc(track, 'martin');
            toggleBtn.disabled = true;
            void ensureAlbumTrackPreloaded(trackIndex, source)
                .then(() => {
                    if (pendingSelectionToken !== selectSongLoadToken) return;
                    selectSong(track, trackIndex, startTime, autoPlay, {
                        ...options,
                        selectionToken: pendingSelectionToken
                    });
                })
                .catch(error => {
                    if (pendingSelectionToken !== selectSongLoadToken) return;
                    console.error(`Could not load audio for index ${trackIndex}:`, error);
                    toggleBtn.disabled = false;
                    setToggleIcon(isPlaybackPaused());
                });
            return;
        }

        const preservePlayback = options.preservePlayback === true;
        const selectToken = Number.isInteger(options.selectionToken)
            ? options.selectionToken
            : ++selectSongLoadToken;
        const previousTrackIndex = selectedTrackIndex;
        const playbackDuration = getTrackAudioDuration(trackIndex);
        const targetTime = Math.max(0, Math.min(playbackDuration, Number.parseFloat(startTime) || 0));

        if (!preservePlayback) {
            webAudioPlayback.pausedAlbumTime = getAlbumTimeForTrackTime(trackIndex, targetTime);
            webAudioPlayback.playing = false;
            stopScheduledWebAudioSources();
        }

        document.querySelectorAll('.song-item').forEach(item => item.classList.remove('active'));
        songItem.classList.add('active');
        selectedSongItem = songItem;
        triggerTrackChangeAnimation(trackIndex, previousTrackIndex);
        toggleBtn.disabled = false;
        currentTrack = track;
        selectedTrackIndex = trackIndex;
        currentDaniSource = '';
        currentVersionSource = audioEntry.source || getVersionedAudioSrc(track, 'martin');
        updateTrackNavButtons();
        updateTempoDinosaur(track);
        updateLiveWaveformDinosaur(track);
        updateVersionToggleState();
        setVersionToggleMessage('');
        updateMediaSessionMetadata(track, trackIndex);

        lyricsContent.innerHTML = '';
        structureContent.innerHTML = '';
        const chordsCanvas = document.createElement('canvas');
        chordsCanvas.id = 'chords-gl';
        chordsCanvas.style.position = 'absolute';
        chordsCanvas.style.top = '0';
        chordsCanvas.style.left = '0';
        chordsCanvas.style.width = '100%';
        chordsCanvas.style.height = '100%';
        chordsCanvas.style.pointerEvents = 'none';
        structureContent.appendChild(chordsCanvas);

        if (currentLyricDisplay) currentLyricDisplay.textContent = '';
        updateLiveLyricsStack([], -1, true);
        updatePlayerSongMotif(track, trackIndex);
        refreshCurrentSongInfoPanel();
        resetLiveTelemetryHistory(trackIndex);
        refreshSeekSections(track, playbackDuration);
        hideSeekSectionTooltip();
        updateURL(trackIndex);

        const lyrics = Array.isArray(track.lyrics) ? track.lyrics : [];
        lyrics.forEach((line, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'lyrics-line';
            lineDiv.dataset.index = index;
            lineDiv.dataset.bar = Number.isFinite(Number.parseFloat(line.barNumber)) ? line.barNumber : 1;
            lineDiv.dataset.length = line.barLength || 1;
            lineDiv.dataset.offset = line.offset || 0;
            if (line.stanzaEnd) lineDiv.classList.add('stanza-end');
            lineDiv.textContent = line.line || ' ';
            lineDiv.addEventListener('click', () => {
                if (currentTrack !== track) return;
                const lineStartTime = getBarStartTime(track, lineDiv.dataset.bar, lineDiv.dataset.offset);
                seekPlayback(lineStartTime).catch(err => {
                    console.error('Audio play error:', err);
                    toggleBtn.disabled = false;
                    setToggleIcon(true);
                });
                setToggleIcon(false);
            });
            lyricsContent.appendChild(lineDiv);
        });

        let beatIndex = 0;
        const sections = Array.isArray(track.structure?.sections) ? track.structure.sections : [];
        sections.forEach(section => {
            const sectionLabel = document.createElement('div');
            sectionLabel.className = 'section-label';
            sectionLabel.textContent = section.label;
            sectionLabel.dataset.beatStart = beatIndex + 1;
            sectionLabel.dataset.beatEnd = beatIndex + (Array.isArray(section.chords) ? section.chords.length : 0);
            structureContent.appendChild(sectionLabel);

            const sectionChords = Array.isArray(section.chords) ? section.chords : [];
            for (let i = 0; i < sectionChords.length; i += 8) {
                const blockChords = sectionChords.slice(i, i + 8);
                const blockDiv = document.createElement('div');
                blockDiv.className = 'structure-block';
                blockDiv.dataset.bar = i / 4 + 1;

                for (let barOffset = 0; barOffset < blockChords.length; barOffset += 4) {
                    const barChords = blockChords.slice(barOffset, barOffset + 4);
                    let j = 0;
                    while (j < barChords.length) {
                        const chord = barChords[j];
                        let chordSpanLength = 1;
                        while (j + chordSpanLength < barChords.length && barChords[j + chordSpanLength] === chord) {
                            chordSpanLength += 1;
                        }

                        const chordContainer = document.createElement('div');
                        chordContainer.className = 'chord-container';
                        chordContainer.style.flex = chordSpanLength;
                        const chordSpan = document.createElement('span');
                        chordSpan.className = 'structure-chord';
                        chordSpan.dataset.beat = beatIndex + 1;
                        chordSpan.dataset.span = chordSpanLength;
                        chordSpan.dataset.chord = chord || '';
                        chordSpan.tabIndex = 0;
                        chordSpan.setAttribute('role', 'button');
                        chordSpan.setAttribute('aria-label', getChordSlotAriaLabel(chord || ''));
                        const chordLabel = document.createElement('span');
                        chordLabel.className = 'chord';
                        chordSpan.appendChild(chordLabel);
                        renderChordSlotLabel(chordSpan, chord || '');
                        const chordPreview = document.createElement('span');
                        chordPreview.className = 'chord-preview';
                        const chordValue = document.createElement('span');
                        chordValue.className = 'chord-value';
                        const chordDiagram = document.createElement('span');
                        chordDiagram.className = 'chord-diagram';
                        const chordSeekAction = document.createElement('button');
                        chordSeekAction.className = 'chord-seek-action';
                        chordSeekAction.type = 'button';
                        chordSeekAction.textContent = 'Play from here';
                        chordPreview.append(chordValue, chordDiagram, chordSeekAction);
                        chordSpan.appendChild(chordPreview);
                        renderChordPresentation(chordSpan, chord || '');
                        const progressDiv = document.createElement('div');
                        progressDiv.className = 'chord-progress';
                        progressDiv.dataset.beat = beatIndex + 1;
                        progressDiv.dataset.span = chordSpanLength;

                        const seekToChord = () => {
                            if (currentTrack !== track) return;
                            const chordStartTime = getBeatStartTime(track, chordSpan.dataset.beat);
                            seekPlayback(chordStartTime).catch(err => {
                                console.error('Audio play error:', err);
                                toggleBtn.disabled = false;
                                setToggleIcon(true);
                            });
                            setToggleIcon(false);
                        };

                        chordSpan.addEventListener('click', event => {
                            if (event.target instanceof Element && event.target.closest('.chord-seek-action')) {
                                event.stopPropagation();
                                seekToChord();
                                return;
                            }
                            const touchLikePointer = window.matchMedia('(hover: none), (pointer: coarse)').matches;
                            if (touchLikePointer) {
                                const willOpen = !chordSpan.classList.contains('is-diagram-open');
                                structureContent.querySelectorAll('.structure-chord.is-diagram-open').forEach(element => {
                                    element.classList.remove('is-diagram-open');
                                });
                                chordSpan.classList.toggle('is-diagram-dismissed', !willOpen);
                                chordSpan.classList.toggle('is-diagram-open', willOpen);
                                if (willOpen) {
                                    requestAnimationFrame(() => positionMobileChordPreview(chordSpan));
                                }
                                return;
                            }
                            chordSpan.classList.remove('is-diagram-open');
                            chordSpan.classList.add('is-diagram-dismissed');
                            chordSpan.querySelector(':focus')?.blur();
                            chordSpan.blur();
                            seekToChord();
                        });
                        chordSpan.addEventListener('pointerenter', () => {
                            chordSpan.classList.remove('is-diagram-dismissed');
                        });
                        chordSpan.addEventListener('keydown', event => {
                            if (event.key === 'Enter') seekToChord();
                        });

                        chordContainer.appendChild(chordSpan);
                        chordContainer.appendChild(progressDiv);
                        blockDiv.appendChild(chordContainer);

                        beatIndex += chordSpanLength;
                        j += chordSpanLength;
                    }
                }
                structureContent.appendChild(blockDiv);
            }
        });

        if (beatIndex > 0) {
            const { beatDuration, startOffset } = getTrackTiming(track);
            const sourceEndTime = getSourceTimeForPlaybackTime(trackIndex, playbackDuration);
            const totalBeatCount = beatDuration > 0
                ? Math.max(beatIndex, Math.ceil(Math.max(0, sourceEndTime - startOffset) / beatDuration))
                : beatIndex;
            const remainingBeatCount = Math.max(0, totalBeatCount - beatIndex);
            if (remainingBeatCount > 0) {
                const renderedChords = structureContent.querySelectorAll('.structure-chord');
                const lastChord = renderedChords[renderedChords.length - 1];
                if (lastChord) {
                    const extendedSpan = (Number.parseInt(lastChord.dataset.span, 10) || 1) + remainingBeatCount;
                    lastChord.dataset.span = extendedSpan;
                    lastChord.dataset.extendsToEnd = 'true';
                    const lastProgress = lastChord.nextElementSibling;
                    if (lastProgress?.classList.contains('chord-progress')) {
                        lastProgress.dataset.span = extendedSpan;
                    }
                }
                const renderedSectionLabels = structureContent.querySelectorAll('.section-label');
                const lastSectionLabel = renderedSectionLabels[renderedSectionLabels.length - 1];
                if (lastSectionLabel) lastSectionLabel.dataset.beatEnd = totalBeatCount;
            }
        }

        cachedLyricLines = Array.from(lyricsContent.querySelectorAll('.lyrics-line'));
        cachedLyricTimings = buildLyricTimingEntries(track, cachedLyricLines);
        requestAnimationFrame(() => renderLyricsWaveform(targetTime, { force: true }));
        cachedChordElements = Array.from(structureContent.querySelectorAll('.structure-chord'));
        cachedChordStates = cachedChordElements.map(chord => {
            const startBeat = Number.parseInt(chord.dataset.beat, 10) - 1;
            const spanLength = Number.parseInt(chord.dataset.span, 10) || 1;
            const progressElement = chord.nextElementSibling;
            return {
                chord,
                progressElement: progressElement?.classList.contains('chord-progress') ? progressElement : null,
                startBeat,
                spanLength,
                endBeat: startBeat + spanLength - 1,
                extendsToEnd: chord.dataset.extendsToEnd === 'true'
            };
        });
        cachedChordContainers = [];
        cachedChordOverlay = window.getChordOverlayRenderer
            ? window.getChordOverlayRenderer(chordsCanvas)
            : null;
        lastActiveChord = null;
        activeChordState = null;
        lastRenderedChordBeat = Number.NaN;
        lastRenderedLyricState = '';
        lastRenderedSectionBeat = Number.NaN;

        lyricsContent.querySelectorAll('.lyrics-line').forEach(line => line.classList.remove('active', 'passed'));
        structureContent.querySelectorAll('.structure-chord').forEach(chord => chord.classList.remove('active', 'passed'));
        structureContent.querySelectorAll('.chord-progress').forEach(progress => progress.style.setProperty('--progress', 0));

        const playbackTime = preservePlayback ? getPlaybackCurrentTime() : targetTime;
        const initialLyricIndex = cachedLyricTimings.findIndex(timing =>
            playbackTime >= timing.startTime && playbackTime < timing.endTime
        );
        updateLiveLyricsStack(cachedLyricTimings, initialLyricIndex, true);
        timeline.textContent = `${formatTime(playbackTime)} / ${formatTime(playbackDuration)}`;
        glSeek.render(playbackDuration ? playbackTime / playbackDuration : 0);
        updateLiveTelemetryAnalysis(true);

        if (selectToken !== selectSongLoadToken || currentTrack !== track || selectedTrackIndex !== trackIndex) {
            return;
        }

        if (preservePlayback) {
            setToggleIcon(isPlaybackPaused());
            if (!isPlaybackPaused() && !animationFrameId) {
                smoothUpdateLoop();
            }
            return;
        }

        setToggleIcon(!autoPlay);
        if (autoPlay) {
            startImmediateAutoplayAttempts();
        }
    }

    function getInitialTrackSelection() {
        const params = new URLSearchParams(window.location.search);
        const songIndex = Number.parseInt(params.get('song'), 10);
        const time = parseFloat(params.get('time'));
        const trackIndex = !isNaN(songIndex) && songIndex >= 0 && songIndex < data.tracks.length
            ? songIndex
            : 0;

        return {
            track: data.tracks[trackIndex] || null,
            trackIndex,
            startTime: !isNaN(time) && time >= 0 ? time : 0
        };
    }

    function handleQueryParams() {
        const { track, trackIndex, startTime } = getInitialTrackSelection();

        if (track) {
            selectSong(track, trackIndex, startTime, false);
        }
    }

    function playTrackAtTime(track, trackIndex, startTime) {
        if (currentTrack !== track) {
            selectSong(track, trackIndex, startTime);
            return;
        }

        seekPlayback(startTime).catch(err => {
            console.error('Audio play error:', err);
            toggleBtn.disabled = false;
            setToggleIcon(true);
        });
        setToggleIcon(false);
    }

    async function unlockAudioContext() {
        audioEngine.ensureContext();
        await audioEngine.resumeContext();
        if (currentTrack && (immediateAutoplayPending || webAudioPlayback.playing)) {
            void attemptImmediateAutoplay();
        }
    }

    async function allowPreloaderAudio() {
        audioPreloaderAudioButton?.classList.add('is-armed');
        audioPreloaderAudioButton?.setAttribute('disabled', '');
        await unlockAudioContext();
        if (currentTrack) {
            startImmediateAutoplayAttempts();
        }
    }

    document.addEventListener('pointerdown', unlockAudioContext, { passive: true });
    document.addEventListener('keydown', unlockAudioContext);
    audioPreloader?.addEventListener('pointerdown', finishAudioPreloaderImmediately, { passive: true });
    audioPreloaderAudioButton?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void allowPreloaderAudio();
    });
    document.addEventListener('visibilitychange', () => {
        updateMediaSessionPositionState();
        if (document.hidden) {
            releasePlaybackWakeLock();
            return;
        }

        if (!isPlaybackPaused()) {
            void audioEngine.resumeContext();
            void requestPlaybackWakeLock();
            syncMediaPlayerLifecycle();
        }
        if (immediateAutoplayPending) {
            void attemptImmediateAutoplay();
        }
    });
    window.addEventListener('pageshow', () => {
        if (!isPlaybackPaused()) {
            void audioEngine.resumeContext();
            syncMediaPlayerLifecycle();
        }
        if (immediateAutoplayPending) {
            void attemptImmediateAutoplay();
        }
    });
    window.addEventListener('pagehide', () => {
        updateMediaSessionPositionState();
        releasePlaybackWakeLock();
    });

    function getTrackLyrics(track) {
        return Array.isArray(track?.lyrics) ? track.lyrics : [];
    }

    function getTrackSections(track) {
        return Array.isArray(track?.structure?.sections) ? track.structure.sections : [];
    }

    function hasCopyableLyrics(track) {
        return getTrackLyrics(track).some(line => String(line?.line || '').trim());
    }

    function hasCopyableChords(track) {
        return getTrackSections(track).some(section =>
            Array.isArray(section?.chords) && section.chords.length
        );
    }

    function formatLyricsWithStanzas(lyrics) {
        const safeLyrics = Array.isArray(lyrics) ? lyrics : [];
        const stanzas = [];
        let stanzaLines = [];

        safeLyrics.forEach((lineObj, index) => {
            const lineText = String(lineObj?.line || '').trimEnd();
            if (lineText.trim()) {
                stanzaLines.push(lineText);
            } else if (stanzaLines.length) {
                stanzaLines.push('');
            }

            if (lineObj?.stanzaEnd || index === safeLyrics.length - 1) {
                const stanza = stanzaLines.join('\n').trim();
                if (stanza) stanzas.push(stanza);
                stanzaLines = [];
            }
        });

        return stanzas.join('\n\n');
    }

    function formatTrackLyrics(track) {
        return formatLyricsWithStanzas(getTrackLyrics(track));
    }

    function formatTrackChords(track) {
        const sections = getTrackSections(track);
        return sections.map((section, sectionIndex) => {
            const label = section?.label || `Section ${sectionIndex + 1}`;
            const chords = Array.isArray(section?.chords) ? section.chords : [];
            const chordLines = [];

            for (let i = 0; i < chords.length; i += 4) {
                chordLines.push(chords.slice(i, i + 4).map(chord => chord || 'N/A').join(' | '));
            }

            return `${label}:\n${chordLines.join('\n')}`.trim();
        }).filter(Boolean).join('\n\n');
    }

    function getContextLyricIndex(target = contextTarget) {
        if (!target || target.type !== 'lyrics-line') return -1;
        const index = Number.parseInt(target.element?.dataset?.index, 10);
        return Number.isFinite(index) ? index : -1;
    }

    function getLyricStanzaRange(track, lineIndex) {
        const lyrics = getTrackLyrics(track);
        if (!lyrics.length || lineIndex < 0 || lineIndex >= lyrics.length) return null;

        let start = 0;
        for (let i = lineIndex - 1; i >= 0; i -= 1) {
            if (lyrics[i]?.stanzaEnd) {
                start = i + 1;
                break;
            }
        }

        let end = lyrics.length - 1;
        for (let i = lineIndex; i < lyrics.length; i += 1) {
            if (lyrics[i]?.stanzaEnd) {
                end = i;
                break;
            }
        }

        return { start, end };
    }

    function getStanzaText(track, lineIndex) {
        const range = getLyricStanzaRange(track, lineIndex);
        if (!range) return '';
        return formatLyricsWithStanzas(getTrackLyrics(track).slice(range.start, range.end + 1));
    }

    function getLyricEntryStartTime(track, lyricEntry) {
        if (!lyricEntry) return 0;
        return getBarStartTime(track, lyricEntry.barNumber ?? 1, lyricEntry.offset || 0);
    }

    function getSectionRanges(track) {
        let beatStart = 1;
        const ranges = [];

        getTrackSections(track).forEach((section, sourceIndex) => {
            const chords = Array.isArray(section?.chords) ? section.chords : [];
            const beatCount = chords.length;
            if (beatCount > 0) {
                ranges.push({
                    index: ranges.length,
                    sourceIndex,
                    startBeat: beatStart,
                    endBeat: beatStart + beatCount,
                    label: section?.label || `Section ${sourceIndex + 1}`
                });
            }
            beatStart += beatCount;
        });

        return ranges;
    }

    function getSectionRangeForBeat(track, beatNumber) {
        const beat = Number.parseInt(beatNumber, 10);
        if (!Number.isFinite(beat)) return null;
        return getSectionRanges(track).find(range => beat >= range.startBeat && beat < range.endBeat) || null;
    }

    function getContextChordSectionRange(target = contextTarget) {
        if (!target || target.type !== 'structure-chord') return null;
        return getSectionRangeForBeat(target.track, target.element?.dataset?.beat);
    }

    function getContextTargetTime(target = contextTarget) {
        if (!target?.track) return 0;

        if (target.type === 'seek-bar' && Number.isFinite(target.seekTime)) {
            return target.seekTime;
        }

        if (target.type === 'lyrics-line') {
            const lyric = getTrackLyrics(target.track)[getContextLyricIndex(target)];
            return getLyricEntryStartTime(target.track, lyric);
        }

        if (target.type === 'structure-chord') {
            return getBeatStartTime(target.track, target.element?.dataset?.beat);
        }

        return target.track === currentTrack ? getPlaybackCurrentTime() : 0;
    }

    async function copyTextToClipboard(text) {
        const value = String(text ?? '');

        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch (err) {
                console.warn('Clipboard API failed; trying fallback copy.', err);
            }
        }

        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, textArea.value.length);

        try {
            return document.execCommand('copy');
        } catch (err) {
            console.warn('Fallback copy failed.', err);
            return false;
        } finally {
            textArea.remove();
        }
    }

    function setContextMenuLabel(action, label) {
        const item = contextMenu.querySelector(`[data-action="${action}"]`);
        if (item) item.textContent = label;
    }

    function showContextMenu(e, targetType, targetElement, targetTrack = currentTrack, targetTrackIndex = data.tracks.findIndex(t => t === currentTrack)) {
        e.preventDefault();
        e.stopPropagation();
        const duration = targetTrackIndex >= 0 ? getTrackAudioDuration(targetTrackIndex) : getPlaybackDuration();
        let seekRatio = null;
        let seekTime = null;

        if (targetType === 'seek-bar' && targetElement) {
            const rect = targetElement.getBoundingClientRect();
            if (rect.width) {
                seekRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                seekTime = seekRatio * (duration || 0);
            }
        }

        contextTarget = {
            type: targetType,
            element: targetElement,
            track: targetTrack,
            trackIndex: targetTrackIndex,
            clientX: e.clientX,
            clientY: e.clientY,
            seekRatio,
            seekTime
        };
        const menuItems = contextMenu.querySelectorAll('.menu-item');
        const currentTrackIndex = currentTrack ? data.tracks.findIndex(t => t === currentTrack) : -1;
        const songActionTrackIndex = targetType === 'song-item' ? targetTrackIndex : currentTrackIndex;
        const lyrics = getTrackLyrics(targetTrack);
        const lyricIndex = getContextLyricIndex(contextTarget);
        const stanzaRange = getLyricStanzaRange(targetTrack, lyricIndex);
        const sectionRange = getContextChordSectionRange(contextTarget);
        const sectionRanges = getSectionRanges(targetTrack);
        const targetHasLyrics = hasCopyableLyrics(targetTrack);
        const targetHasChords = hasCopyableChords(targetTrack);
        const canCopyContextTimeLink = targetTrackIndex >= 0 && (
            (targetType === 'seek-bar' && Number.isFinite(seekTime)) ||
            targetType === 'structure-chord' ||
            (targetType === 'song-item' && targetTrack === currentTrack)
        );

        setContextMenuLabel('copy-time-link', 'Copy Time Link');
        if (targetType === 'seek-bar') {
            setContextMenuLabel('copy-time-link', 'Copy Position Link');
        } else if (targetType === 'structure-chord') {
            setContextMenuLabel('copy-time-link', 'Copy Chord Link');
        } else if (targetType === 'song-item' && targetTrack === currentTrack) {
            setContextMenuLabel('copy-time-link', 'Copy Current Time Link');
        }

        menuItems.forEach(item => {
            const action = item.dataset.action;
            item.style.display = 'block';
            if (
                (action === 'copy-verse' && (targetType !== 'lyrics-line' || lyricIndex < 0 || lyricIndex >= lyrics.length)) ||
                (action === 'copy-stanza' && !stanzaRange) ||
                (action === 'copy-lyrics' && !targetHasLyrics) ||
                (action === 'copy-chord' && targetType !== 'structure-chord') ||
                (action === 'copy-chords' && (!targetHasChords || !['structure-chord', 'song-item'].includes(targetType))) ||
                (action === 'play-song' && (targetType !== 'song-item' || !targetTrack)) ||
                (action === 'next-song' && (songActionTrackIndex < 0 || songActionTrackIndex >= data.tracks.length - 1)) ||
                (action === 'prev-song' && songActionTrackIndex <= 0) ||
                (action === 'seek-song' && (targetType !== 'seek-bar' || !targetTrack || targetTrackIndex < 0 || !Number.isFinite(seekTime))) ||
                (action === 'copy-song-link' && targetTrackIndex < 0) ||
                (action === 'copy-verse-link' && (targetType !== 'lyrics-line' || targetTrackIndex < 0 || lyricIndex < 0 || lyricIndex >= lyrics.length)) ||
                (action === 'copy-stanza-link' && (!stanzaRange || targetTrackIndex < 0)) ||
                (action === 'copy-time-link' && !canCopyContextTimeLink) ||
                (action === 'next-verse' && (targetType !== 'lyrics-line' || lyricIndex < 0 || lyricIndex >= lyrics.length - 1)) ||
                (action === 'prev-verse' && (targetType !== 'lyrics-line' || lyricIndex <= 0)) ||
                (action === 'next-stanza' && (!stanzaRange || stanzaRange.end >= lyrics.length - 1)) ||
                (action === 'prev-stanza' && (!stanzaRange || stanzaRange.start <= 0)) ||
                (action === 'next-section' && (!sectionRange || sectionRange.index >= sectionRanges.length - 1)) ||
                (action === 'prev-section' && (!sectionRange || sectionRange.index <= 0)) ||
                (action === 'export-song' && (!targetTrack || (!targetHasLyrics && !targetHasChords)))
            ) {
                item.style.display = 'none';
            }
        });

        // Handle separators
        let visibleCount = 0;
        let lastWasSeparator = true; // Treat start as separator to hide first one
        const allItems = contextMenu.querySelectorAll('.menu-item, .menu-divider');
        
        allItems.forEach(el => {
            if (el.classList.contains('menu-divider')) {
                if (lastWasSeparator) {
                    el.style.display = 'none';
                } else {
                    el.style.display = 'block';
                    lastWasSeparator = true;
                }
            } else {
                if (el.style.display !== 'none') {
                    visibleCount++;
                    lastWasSeparator = false;
                }
            }
        });
        
        // Hide trailing separator
        const visibleItems = Array.from(allItems).filter(el => el.style.display !== 'none');
        if (visibleItems.length > 0 && visibleItems[visibleItems.length - 1].classList.contains('menu-divider')) {
            visibleItems[visibleItems.length - 1].style.display = 'none';
        }

        // Make visible before measuring so we get real dimensions
        contextMenu.style.display = 'block';
        const menuRect = contextMenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let menuX = e.clientX;
        let menuY = e.clientY;

        if (menuX + menuRect.width > viewportWidth - 10) {
            menuX = viewportWidth - menuRect.width - 10;
        }
        if (menuY + menuRect.height > viewportHeight - 10) {
            menuY = viewportHeight - menuRect.height - 10;
        }
        if (menuX < 10) menuX = 10;
        if (menuY < 10) menuY = 10;

        contextMenu.style.top = `${menuY}px`;
        contextMenu.style.left = `${menuX}px`;
    }

    function hideContextMenu() {
        contextMenu.style.display = 'none';
        contextTarget = null;
    }

    // Only hide on left-clicks outside relevant targets
    document.addEventListener('click', (e) => {
        if (e.button !== 0) return; // ignore right/middle clicks
        if (!e.target.closest('#context-menu, .song-item, .lyrics-line, .structure-chord, #seek-gl')) {
            hideContextMenu();
        }
    });
    document.addEventListener('contextmenu', (e) => {
        const targetEl = e.target.closest('.song-item, .lyrics-line, .structure-chord, #seek-gl');
        if (targetEl) {
            e.preventDefault();
            e.stopPropagation();
            
            let type = '';
            let track = currentTrack;
            let trackIndex = currentTrack ? data.tracks.findIndex(t => t === currentTrack) : -1;

            if (targetEl.matches('.song-item')) {
                type = 'song-item';
                const idx = parseInt(targetEl.dataset.trackIndex);
                if (!isNaN(idx)) {
                    trackIndex = idx;
                    track = data.tracks[idx];
                }
            } else if (targetEl.matches('.lyrics-line')) {
                type = 'lyrics-line';
            } else if (targetEl.matches('.structure-chord')) {
                type = 'structure-chord';
            } else if (targetEl.matches('#seek-gl')) {
                type = 'seek-bar';
            }

            if (type) {
                showContextMenu(e, type, targetEl, track, trackIndex);
            }
        } else {
            // Only hide if clicking outside context menu itself
            if (!e.target.closest('#context-menu')) {
                hideContextMenu();
            }
        }
    });

    contextMenu.addEventListener('click', async (e) => {
        const menuItem = e.target.closest('.menu-item');
        if (!menuItem || menuItem.style.display === 'none') return;
        if (!contextTarget) return;

        const action = menuItem.dataset.action;
        const targetTrack = contextTarget.track;
        const targetTrackIndex = contextTarget.trackIndex;
        const currentTrackIndex = currentTrack ? data.tracks.findIndex(t => t === currentTrack) : -1;
        const songActionTrackIndex = contextTarget.type === 'song-item' ? targetTrackIndex : currentTrackIndex;

        try {
            if (action === 'copy-verse' && contextTarget.type === 'lyrics-line') {
                const lyric = getTrackLyrics(targetTrack)[getContextLyricIndex()];
                await copyTextToClipboard(lyric?.line || contextTarget.element.textContent || '');
            } else if (action === 'copy-stanza' && contextTarget.type === 'lyrics-line') {
                await copyTextToClipboard(getStanzaText(targetTrack, getContextLyricIndex()));
            } else if (action === 'copy-lyrics' && targetTrack) {
                await copyTextToClipboard(formatTrackLyrics(targetTrack));
            } else if (action === 'copy-chord' && contextTarget.type === 'structure-chord') {
                const chord = contextTarget.element.dataset.chord
                    || contextTarget.element.querySelector('.chord')?.textContent?.trim()
                    || 'N/A';
                const chordData = chordMap.get(chord) || { diagram: '' };
                await copyTextToClipboard(`${chord}\n${chordData.diagram}`.trim());
            } else if (action === 'copy-chords' && targetTrack) {
                await copyTextToClipboard(formatTrackChords(targetTrack));
            } else if (action === 'play-song' && contextTarget.type === 'song-item' && targetTrack) {
                selectSong(targetTrack, targetTrackIndex);
            } else if (action === 'next-song' && songActionTrackIndex >= 0 && songActionTrackIndex < data.tracks.length - 1) {
                selectSong(data.tracks[songActionTrackIndex + 1], songActionTrackIndex + 1);
            } else if (action === 'prev-song' && songActionTrackIndex > 0) {
                selectSong(data.tracks[songActionTrackIndex - 1], songActionTrackIndex - 1);
            } else if (action === 'seek-song' && contextTarget.type === 'seek-bar' && targetTrack && Number.isFinite(contextTarget.seekTime)) {
                playTrackAtTime(targetTrack, targetTrackIndex, contextTarget.seekTime);
            } else if (action === 'copy-song-link' && targetTrackIndex >= 0) {
                await copyTextToClipboard(generateSongLink(targetTrackIndex));
            } else if (action === 'copy-verse-link' && contextTarget.type === 'lyrics-line' && targetTrack && targetTrackIndex >= 0) {
                const startTime = getContextTargetTime(contextTarget);
                const link = generateSongLink(targetTrackIndex) + `&time=${formatTimeParam(startTime)}`;
                await copyTextToClipboard(link);
            } else if (action === 'copy-stanza-link' && contextTarget.type === 'lyrics-line' && targetTrack && targetTrackIndex >= 0) {
                const range = getLyricStanzaRange(targetTrack, getContextLyricIndex());
                const stanzaStart = range ? getTrackLyrics(targetTrack)[range.start] : null;
                const startTime = getLyricEntryStartTime(targetTrack, stanzaStart);
                const link = generateSongLink(targetTrackIndex) + `&time=${formatTimeParam(startTime)}`;
                await copyTextToClipboard(link);
            } else if (action === 'copy-time-link' && targetTrack && targetTrackIndex >= 0) {
                const link = generateSongLink(targetTrackIndex) + `&time=${formatTimeParam(getContextTargetTime(contextTarget))}`;
                await copyTextToClipboard(link);
            } else if (action === 'next-verse' && contextTarget.type === 'lyrics-line' && targetTrack) {
                const nextLine = getTrackLyrics(targetTrack)[getContextLyricIndex() + 1];
                if (nextLine) playTrackAtTime(targetTrack, targetTrackIndex, getLyricEntryStartTime(targetTrack, nextLine));
            } else if (action === 'prev-verse' && contextTarget.type === 'lyrics-line' && targetTrack) {
                const prevLine = getTrackLyrics(targetTrack)[getContextLyricIndex() - 1];
                if (prevLine) playTrackAtTime(targetTrack, targetTrackIndex, getLyricEntryStartTime(targetTrack, prevLine));
            } else if (action === 'next-stanza' && contextTarget.type === 'lyrics-line' && targetTrack) {
                const range = getLyricStanzaRange(targetTrack, getContextLyricIndex());
                const nextLine = range ? getTrackLyrics(targetTrack)[range.end + 1] : null;
                if (nextLine) playTrackAtTime(targetTrack, targetTrackIndex, getLyricEntryStartTime(targetTrack, nextLine));
            } else if (action === 'prev-stanza' && contextTarget.type === 'lyrics-line' && targetTrack) {
                const range = getLyricStanzaRange(targetTrack, getContextLyricIndex());
                const previousRange = range ? getLyricStanzaRange(targetTrack, range.start - 1) : null;
                const previousLine = previousRange ? getTrackLyrics(targetTrack)[previousRange.start] : null;
                if (previousLine) playTrackAtTime(targetTrack, targetTrackIndex, getLyricEntryStartTime(targetTrack, previousLine));
            } else if (action === 'next-section' && contextTarget.type === 'structure-chord' && targetTrack) {
                const sectionRange = getContextChordSectionRange();
                const nextSection = sectionRange ? getSectionRanges(targetTrack)[sectionRange.index + 1] : null;
                if (nextSection) playTrackAtTime(targetTrack, targetTrackIndex, getBeatStartTime(targetTrack, nextSection.startBeat));
            } else if (action === 'prev-section' && contextTarget.type === 'structure-chord' && targetTrack) {
                const sectionRange = getContextChordSectionRange();
                const previousSection = sectionRange ? getSectionRanges(targetTrack)[sectionRange.index - 1] : null;
                if (previousSection) playTrackAtTime(targetTrack, targetTrackIndex, getBeatStartTime(targetTrack, previousSection.startBeat));
            } else if (action === 'toggle-lyrics') {
                const lyrics = document.querySelector('.lyrics');
                if (lyrics) lyrics.style.display = lyrics.style.display === 'none' ? 'block' : 'none';
            } else if (action === 'toggle-structure') {
                const structure = document.querySelector('.structure');
                if (structure) structure.style.display = structure.style.display === 'none' ? 'block' : 'none';
            } else if (action === 'export-song' && targetTrack) {
                const lyrics = formatTrackLyrics(targetTrack);
                const chordsText = formatTrackChords(targetTrack);
                const exportParts = [`Title: ${targetTrack.title || 'Untitled Song'}`];
                if (lyrics) exportParts.push(`Lyrics:\n${lyrics}`);
                if (chordsText) exportParts.push(`Chords:\n${chordsText}`);
                const blob = new Blob([exportParts.join('\n\n')], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const fileTitle = String(targetTrack.title || 'song').replace(/[\\/:*?"<>|]+/g, '-');
                a.href = url;
                a.download = `${fileTitle}.txt`;
                a.click();
                URL.revokeObjectURL(url);
            }
        } finally {
            hideContextMenu();
        }
    });

    // Clicking on seek canvas performs seeking via Web Audio
    seekCanvas.addEventListener('click', (e) => {
        if (!currentTrack) return;
        updateSeekSectionTooltip(e);
        scheduleSeekSectionTooltipHide();
        const rect = seekCanvas.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        const duration = getPlaybackDuration();
        seekPlayback(pos * duration).catch(err => {
            console.error('Audio play error:', err);
            toggleBtn.disabled = false;
            setToggleIcon(true);
        });
        setToggleIcon(false);
    });
    seekCanvas.addEventListener('mousemove', updateSeekSectionTooltip);
    seekCanvas.addEventListener('mouseleave', hideSeekSectionTooltip);
    seekCanvas.addEventListener('blur', hideSeekSectionTooltip);

    // seekCanvas context menu handled by global listener

    function buildAudioPreloadSections() {
        const trackCount = data.tracks.length;
        if (!trackCount) return [];

        const byteTotals = data.tracks.map((track, trackIndex) => {
            const byteTotal = preloadTrackByteTotals.get(trackIndex) || preloadedTrackByteLengths.get(trackIndex) || 0;
            return Number.isFinite(byteTotal) && byteTotal > 0 ? byteTotal : 0;
        });
        const knownTotals = byteTotals.filter(Boolean);
        const fallbackBytes = knownTotals.length
            ? knownTotals.reduce((sum, bytes) => sum + bytes, 0) / knownTotals.length
            : 1;
        const weightedTotals = byteTotals.map(bytes => bytes || fallbackBytes);
        const albumBytes = weightedTotals.reduce((sum, bytes) => sum + bytes, 0) || trackCount;
        let cursor = 0;

        return data.tracks.map((track, trackIndex) => {
            const start = cursor / albumBytes;
            cursor += weightedTotals[trackIndex] || 1;
            return {
                label: track.title || `Song ${trackIndex + 1}`,
                start,
                end: cursor / albumBytes,
                index: trackIndex
            };
        });
    }

    function refreshAudioPreloadSections() {
        if (typeof glPreload.setSections === 'function') {
            glPreload.setSections(buildAudioPreloadSections());
        }
    }

    function getPreloadTrackByteTotal(trackIndex) {
        const byteTotal = preloadTrackByteTotals.get(trackIndex) || preloadedTrackByteLengths.get(trackIndex) || 0;
        return Number.isFinite(byteTotal) && byteTotal > 0 ? byteTotal : 0;
    }

    function getEstimatedPreloadTrackBytes(trackIndex) {
        const byteTotal = getPreloadTrackByteTotal(trackIndex);
        if (byteTotal > 0) return byteTotal;

        const knownTotals = data.tracks
            .map((track, index) => getPreloadTrackByteTotal(index))
            .filter(Boolean);
        if (!knownTotals.length) return 1;
        return knownTotals.reduce((sum, bytes) => sum + bytes, 0) / knownTotals.length;
    }

    function getPreloadTrackLoadedBytes(trackIndex) {
        const loadedBytes = preloadTrackLoadedBytes.get(trackIndex) || preloadedTrackByteLengths.get(trackIndex) || 0;
        return Number.isFinite(loadedBytes) && loadedBytes > 0 ? loadedBytes : 0;
    }

    function getAudioPreloadProgress(trackIndex = -1, currentTrackBytes = 0, fallbackPhase = 0) {
        const trackCount = data.tracks.length || 1;
        const weightedTotals = data.tracks.map((track, index) => getEstimatedPreloadTrackBytes(index));
        const albumBytes = weightedTotals.reduce((sum, bytes) => sum + bytes, 0);
        if (!Number.isFinite(albumBytes) || albumBytes <= 0) {
            const loadedTracks = data.tracks.reduce((sum, track, index) => {
                return sum + (preloadTrackLoadedBytes.has(index) || preloadedTrackAudio.has(index) ? 1 : 0);
            }, 0);
            return Math.max(0, Math.min(1, (loadedTracks + Math.max(0, fallbackPhase)) / trackCount));
        }

        const loadedBytes = weightedTotals.reduce((sum, totalBytes, index) => {
            const safeTotal = Math.max(1, totalBytes || 1);
            if (index === trackIndex) {
                const explicitBytes = Number.parseFloat(currentTrackBytes);
                const currentBytes = Number.isFinite(explicitBytes) && explicitBytes > 0
                    ? explicitBytes
                    : safeTotal * Math.max(0, fallbackPhase);
                return sum + Math.max(0, Math.min(safeTotal, currentBytes));
            }

            return sum + Math.max(0, Math.min(safeTotal, getPreloadTrackLoadedBytes(index)));
        }, 0);

        return loadedBytes / albumBytes;
    }

    function setAudioPreloadProgress(progress, message = '') {
        if (!document.body.classList.contains('is-audio-preloading')) return;
        const safeProgress = Math.max(0, Math.min(1, Number.parseFloat(progress) || 0));
        const percent = Math.round(safeProgress * 100);
        glPreload.render(safeProgress);
        if (audioPreloaderBar) {
            audioPreloaderBar.setAttribute('aria-valuenow', String(percent));
        }
        if (audioPreloaderPercent) {
            audioPreloaderPercent.textContent = `${percent}%`;
        }
        if (audioPreloaderRacingDino) {
            setRacingDinoTargetProgress(safeProgress);
        }
        if (message && audioPreloaderMeta) {
            audioPreloaderMeta.textContent = message;
        }
    }

    function getAudioContentType(source) {
        return String(source).split(/[?#]/, 1)[0].toLowerCase().endsWith('.wav')
            ? 'audio/wav'
            : 'audio/mpeg';
    }

    async function readCachedAudioBytes(source) {
        const cache = await audioCacheReady;
        if (!cache || !source) return null;
        const cacheKey = getResolvedAudioUrl(source);
        try {
            const cachedResponse = await cache.match(cacheKey);
            if (!cachedResponse) return null;
            return await cachedResponse.arrayBuffer();
        } catch (error) {
            console.warn(`Could not read cached audio ${source}:`, error);
            return null;
        }
    }

    async function storeCachedAudioBytes(source, audioBytes) {
        const cache = await audioCacheReady;
        if (!cache || !source || !audioBytes?.byteLength) return;
        const cacheKey = getResolvedAudioUrl(source);
        try {
            await cache.put(cacheKey, new Response(audioBytes.slice(0), {
                headers: {
                    'Content-Type': getAudioContentType(source),
                    'Content-Length': String(audioBytes.byteLength)
                }
            }));
        } catch (error) {
            // Quota varies by browser; playback should continue even if persistence is refused.
            console.warn(`Could not persist audio ${source}:`, error);
        }
    }

    async function fetchAudioArrayBuffer(source, track, trackIndex) {
        const cachedBytes = await readCachedAudioBytes(source);
        if (cachedBytes?.byteLength) {
            preloadTrackByteTotals.set(trackIndex, cachedBytes.byteLength);
            preloadedTrackByteLengths.set(trackIndex, cachedBytes.byteLength);
            preloadTrackLoadedBytes.set(trackIndex, cachedBytes.byteLength * 0.98);
            refreshAudioPreloadSections();
            updateSongPreloadIndicator(trackIndex);
            setAudioPreloadProgress(
                getAudioPreloadProgress(trackIndex, cachedBytes.byteLength * 0.98, 0.98),
                `Decoding cached ${trackIndex + 1}/${data.tracks.length}: ${track.title}`
            );
            return cachedBytes;
        }

        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${source}: ${response.status}`);
        }

        const totalBytes = Number.parseInt(response.headers.get('content-length') || '', 10);
        if (Number.isFinite(totalBytes) && totalBytes > 0) {
            preloadTrackByteTotals.set(trackIndex, totalBytes);
            refreshAudioPreloadSections();
            updateSongPreloadIndicator(trackIndex);
        }

        if (!response.body || typeof response.body.getReader !== 'function') {
            const audioBytes = await response.arrayBuffer();
            const byteTotal = audioBytes.byteLength || getEstimatedPreloadTrackBytes(trackIndex);
            preloadedTrackByteLengths.set(trackIndex, audioBytes.byteLength || 0);
            preloadTrackLoadedBytes.set(trackIndex, byteTotal * 0.98);
            updateSongPreloadIndicator(trackIndex);
            setAudioPreloadProgress(
                getAudioPreloadProgress(trackIndex, byteTotal * 0.98, 0.98),
                `Decoding ${trackIndex + 1}/${data.tracks.length}: ${track.title}`
            );
            void storeCachedAudioBytes(source, audioBytes);
            return audioBytes;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let receivedBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedBytes += value.byteLength;
            preloadTrackLoadedBytes.set(trackIndex, receivedBytes);
            updateSongPreloadIndicator(trackIndex);
            setAudioPreloadProgress(
                getAudioPreloadProgress(trackIndex, receivedBytes, 0.42),
                `Loading ${trackIndex + 1}/${data.tracks.length}: ${track.title}`
            );
        }

        const bytes = new Uint8Array(receivedBytes);
        let offset = 0;
        chunks.forEach(chunk => {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        });
        preloadedTrackByteLengths.set(trackIndex, bytes.byteLength || 0);
        if (bytes.byteLength > 0) {
            preloadTrackByteTotals.set(trackIndex, bytes.byteLength);
            refreshAudioPreloadSections();
        }
        updateSongPreloadIndicator(trackIndex);
        setAudioPreloadProgress(
            getAudioPreloadProgress(trackIndex, bytes.byteLength * 0.98, 0.98),
            `Decoding ${trackIndex + 1}/${data.tracks.length}: ${track.title}`
        );
        void storeCachedAudioBytes(source, bytes.buffer);
        return bytes.buffer;
    }

    async function preloadSingleAlbumTrack(trackIndex, source) {
        const track = data.tracks[trackIndex];
        if (!track || !source) {
            durationFailures.add(trackIndex);
            throw new Error(`Missing audio source for ${track?.title || `track ${trackIndex + 1}`}`);
        }

        setAudioPreloadProgress(
            getAudioPreloadProgress(trackIndex, 0, 0),
            `Loading ${trackIndex + 1}/${data.tracks.length}: ${track.title}`
        );
        updateSongPreloadIndicator(trackIndex);
        const audioBytes = await fetchAudioArrayBuffer(source, track, trackIndex);
        const audioBuffer = await audioEngine.decodeAudioData(audioBytes.slice(0));
        const byteLength = audioBytes.byteLength || getEstimatedPreloadTrackBytes(trackIndex);

        preloadedTrackAudio.set(trackIndex, {
            source,
            audioBuffer
        });
        preloadedTrackByteLengths.set(trackIndex, audioBytes.byteLength || 0);
        preloadTrackLoadedBytes.set(trackIndex, byteLength);
        decodedAudioBuffers.set(getResolvedAudioUrl(source), audioBuffer);
        const analysis = analyzeAudioBuffer(audioBuffer, audioBytes.byteLength || 0);
        setTrackPlaybackAnalysis(trackIndex, analysis);
        trackDurations.set(trackIndex, audioBuffer.duration);
        durationFailures.delete(trackIndex);

        setSongDurationDisplay(trackIndex);

        rebuildStitchedAlbumTimeline({ preservePlayback: true });
        renderTelemetry();
        scheduleLoadedFutureTracks();
        setAudioPreloadProgress(
            getAudioPreloadProgress(trackIndex, byteLength, 1),
            `Loaded ${trackIndex + 1}/${data.tracks.length}: ${track.title}`
        );

        return audioBuffer;
    }

    function ensureAlbumTrackPreloaded(trackIndex, source) {
        const existingAudio = preloadedTrackAudio.get(trackIndex)?.audioBuffer;
        if (existingAudio) return Promise.resolve(existingAudio);
        if (trackPreloadPromises.has(trackIndex)) return trackPreloadPromises.get(trackIndex);

        const preloadPromise = preloadSingleAlbumTrack(trackIndex, source)
            .finally(() => trackPreloadPromises.delete(trackIndex));
        trackPreloadPromises.set(trackIndex, preloadPromise);
        return preloadPromise;
    }

    function getAlbumPreloadOrder(priorityTrackIndex) {
        const trackCount = data.tracks.length;
        if (!trackCount) return [];

        const safePriorityIndex = Math.max(0, Math.min(trackCount - 1, priorityTrackIndex));
        const order = [safePriorityIndex];
        for (let trackIndex = safePriorityIndex + 1; trackIndex < trackCount; trackIndex += 1) {
            order.push(trackIndex);
        }
        for (let trackIndex = 0; trackIndex < safePriorityIndex; trackIndex += 1) {
            order.push(trackIndex);
        }
        return order;
    }

    function getAlbumPreloadConcurrency() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection?.saveData) {
            return ALBUM_PRELOAD_SAVE_DATA_CONCURRENCY;
        }

        const coreCount = Number.parseInt(navigator.hardwareConcurrency, 10);
        if (Number.isFinite(coreCount) && coreCount > 0) {
            return Math.max(2, Math.min(ALBUM_PRELOAD_MAX_CONCURRENCY, Math.floor(coreCount / 2)));
        }

        return Math.min(3, ALBUM_PRELOAD_MAX_CONCURRENCY);
    }

    async function preloadAlbumTracksConcurrently(trackIndexes, preloadSources, maxConcurrency = getAlbumPreloadConcurrency()) {
        const queue = Array.isArray(trackIndexes) ? trackIndexes.filter(trackIndex => Number.isInteger(trackIndex)) : [];
        if (!queue.length) return;

        const workerCount = Math.max(1, Math.min(queue.length, maxConcurrency));
        let cursor = 0;

        async function preloadWorker() {
            while (cursor < queue.length) {
                const trackIndex = queue[cursor];
                cursor += 1;
                await ensureAlbumTrackPreloaded(trackIndex, preloadSources[trackIndex]);
            }
        }

        await Promise.all(Array.from({ length: workerCount }, preloadWorker));
    }

    async function preloadAlbumAudio(initialSelection = getInitialTrackSelection()) {
        if (!data.tracks.length) return;
        refreshAudioPreloadSections();
        setAudioPreloadProgress(0, 'Preparing selected song');
        const preloadSources = data.tracks.map(track => getVersionedAudioSrc(track, 'martin'));
        const preloadOrder = getAlbumPreloadOrder(initialSelection.trackIndex);
        const priorityTrackIndex = preloadOrder[0] ?? 0;

        await ensureAlbumTrackPreloaded(priorityTrackIndex, preloadSources[priorityTrackIndex]);
        const priorityTrack = data.tracks[priorityTrackIndex];
        if (priorityTrack) {
            const startTime = priorityTrackIndex === initialSelection.trackIndex ? initialSelection.startTime : 0;
            selectSong(priorityTrack, priorityTrackIndex, startTime, true);
        }

        const remainingTrackIndexes = preloadOrder.slice(1);
        await preloadAlbumTracksConcurrently(remainingTrackIndexes, preloadSources);
        rebuildStitchedAlbumTimeline({ preservePlayback: true });
        scheduleLoadedFutureTracks();
        setAudioPreloadProgress(1, 'All songs loaded');
    }

    function getCinematicRevealDuration() {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        return reduceMotion ? REDUCED_CINEMATIC_REVEAL_DURATION_MS : CINEMATIC_REVEAL_DURATION_MS;
    }

    function waitForRevealTimeout(durationMs) {
        return new Promise(resolve => {
            window.setTimeout(resolve, Math.max(0, durationMs));
        });
    }

    function releaseDeferredPageMedia() {
        if (deferredPageMediaReleased) return;
        deferredPageMediaReleased = true;
        document.documentElement.dataset.mediaLoadingReleased = 'true';
        queueAlbumCoverSourceUpdate();
        window.dispatchEvent(new Event('sioto-audio-ready'));
    }

    function finishAudioPreloaderImmediately(event = null) {
        if (!audioPreloader || !document.body.classList.contains('is-audio-preloading')) return;
        if (event?.target?.closest?.('#audio-preloader-audio-button')) return;

        audioPreloaderSkipped = true;
        releaseDeferredPageMedia();
        document.body.classList.remove('is-audio-revealing');
        document.body.classList.add('has-audio-revealed');
        document.body.classList.remove('is-audio-preloading');
        audioPreloader.setAttribute('aria-hidden', 'true');
        audioPreloader.setAttribute('aria-label', 'Album loading in background');
        refreshSongPreloadIndicators();
        requestMobileCoverHeightUpdate();
    }

    async function revealAlbumSite() {
        releaseDeferredPageMedia();
        if (audioPreloaderSkipped || !document.body.classList.contains('is-audio-preloading')) {
            refreshSongPreloadIndicators();
            return;
        }
        if (audioRevealPromise) return audioRevealPromise;

        audioRevealPromise = (async () => {
            document.body.classList.add('is-audio-revealing');
            audioPreloader?.setAttribute('aria-label', 'Sioto Jazz presents');
            await waitForRevealTimeout(getCinematicRevealDuration());
            if (audioPreloaderSkipped || !document.body.classList.contains('is-audio-preloading')) {
                return;
            }
            document.body.classList.add('has-audio-revealed');
            document.body.classList.remove('is-audio-preloading');
            audioPreloader?.setAttribute('aria-hidden', 'true');
            window.setTimeout(() => {
                document.body.classList.remove('is-audio-revealing');
            }, 1200);
        })();

        return audioRevealPromise;
    }

    function showAudioPreloadError(error) {
        console.error('Audio preload failed:', error);
        document.body.classList.remove('is-audio-revealing');
        setAudioPreloadProgress(1, `Could not load audio: ${error.message || error}`);
        audioPreloader?.classList.add('has-error');
        finishAudioPreloaderImmediately();
    }

    renderTelemetry();

    data.tracks.forEach((track, trackIndex) => {
        const songItem = document.createElement('div');
        songItem.className = 'song-item';
        songItem.classList.toggle('has-feature', Boolean(track.feature));
        songItem.dataset.trackIndex = trackIndex;

        const songTitle = document.createElement('div');
        songTitle.className = 'song-title';
        appendTrackTitleParts(songTitle, trackIndex, track);

        const songStatus = document.createElement('div');
        songStatus.className = 'song-status';
        const trackStatusLabel = getTrackStatusLabel(track.status) || 'in progress';
        songStatus.textContent = trackStatusLabel;
        songStatus.dataset.status = getTrackStatusKey(trackStatusLabel) || 'in-progress';
        songStatus.setAttribute('aria-label', `Status: ${trackStatusLabel}`);

        const songLength = document.createElement('div');
        songLength.className = 'song-length';
        const declaredDuration = trackDurations.get(trackIndex);
        songLength.textContent = Number.isFinite(declaredDuration) ? formatTime(declaredDuration) : '--:--';

        const songSection = document.createElement('div');
        songSection.className = 'song-section';
        songSection.textContent = '';

        songItem.appendChild(songTitle);
        songItem.appendChild(createSongMotifForTrack(trackIndex));
        songItem.appendChild(songLength);
        // songItem context menu handled by global listener
        songItem.addEventListener('click', () => {
            selectSong(track, trackIndex);
        });
        songList.appendChild(songItem);

        if (!track.mp3) {
            durationFailures.add(trackIndex);
            songLength.textContent = '0:00';
            updateAlbumTotalTime();
            renderTelemetry();
        }
    });
    updateAlbumTotalTime();

    // Set startup defaults until a song is selected
    setToggleIcon(true);
    toggleBtn.disabled = true;
    audioEngine.setVolume(playerVolume);
    updateVolumeControl();
    updateLoopModeControl();
    if (chordInstrument) chordInstrument.value = selectedChordInstrument;
    if (chordCapo) chordCapo.value = String(selectedCapoFret);
    updateTrackNavButtons();
    updateSectionNavButtons();
    updateVersionToggleState();
    configureMediaSessionActions();
    configureMobileAudioInterruptionHandling();
    setupResponsiveAlbumCover();

    preloadAlbumAudio(getInitialTrackSelection())
        .then(() => revealAlbumSite())
        .catch(showAudioPreloadError);

    function setToggleIcon(showPlay) {
        const icon = toggleBtn.querySelector('i');
        if (showPlay) {
            toggleBtn.setAttribute('aria-label', 'Play');
            icon.classList.remove('fa-pause');
            icon.classList.add('fa-play');
            playerBasic.classList.remove('playing');
        } else {
            toggleBtn.setAttribute('aria-label', 'Pause');
            icon.classList.remove('fa-play');
            icon.classList.add('fa-pause');
            playerBasic.classList.add('playing');
        }
    }

    toggleBtn.addEventListener('click', () => {
        if (!currentTrack) return;
        if (isPlaybackPaused() || (immediateAutoplayPending && !isAudioContextRunning())) {
            playPlayback().catch(err => {
                console.error('Audio play error:', err);
                toggleBtn.disabled = false;
                setToggleIcon(true);
            });
            setToggleIcon(false);
            const duration = getPlaybackDuration();
            glSeek.render(duration ? getPlaybackCurrentTime() / duration : 0);
        } else {
            pausePlayback().finally(() => {
                setToggleIcon(true);
            });
        }
    });

    prevTrackBtn?.addEventListener('click', () => {
        goToAdjacentTrack(-1);
    });

    nextTrackBtn?.addEventListener('click', () => {
        goToAdjacentTrack(1);
    });

    prevSectionBtn?.addEventListener('click', () => {
        goToAdjacentSection(-1);
    });

    nextSectionBtn?.addEventListener('click', () => {
        goToAdjacentSection(1);
    });

    volumeBtn?.addEventListener('click', event => {
        event.stopPropagation();
        const willOpen = !volumeControl.classList.contains('is-open');
        volumeControl.classList.toggle('is-open', willOpen);
        volumeBtn.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) {
            volumeSlider?.focus({ preventScroll: true });
            queueVolumePopoverPosition();
        } else {
            volumeBtn.focus({ preventScroll: true });
        }
    });

    volumeControl?.addEventListener('pointerenter', queueVolumePopoverPosition, { passive: true });
    volumeControl?.addEventListener('focusin', queueVolumePopoverPosition);
    window.addEventListener('resize', () => {
        queueVolumePopoverPosition();
        fitActiveLiveLyric();
        const openChord = structureContent.querySelector('.structure-chord.is-diagram-open');
        if (openChord) requestAnimationFrame(() => positionMobileChordPreview(openChord));
    });

    volumeSlider?.addEventListener('input', () => {
        setPlayerVolume(Number.parseFloat(volumeSlider.value) / 100);
    });

    loopModeBtn?.addEventListener('click', () => {
        const modes = ['none', 'track', 'album'];
        setLoopMode(modes[(modes.indexOf(loopMode) + 1) % modes.length]);
    });

    chordInstrument?.addEventListener('change', () => {
        selectedChordInstrument = Object.hasOwn(STRING_INSTRUMENTS, chordInstrument.value) || chordInstrument.value === 'piano'
            ? chordInstrument.value
            : 'guitar';
        try { localStorage.setItem('sioto-chord-instrument', selectedChordInstrument); } catch {}
        structureContent.querySelectorAll('.structure-chord').forEach(chordElement => {
            renderChordPresentation(chordElement, chordElement.dataset.chord || '');
            chordElement.classList.remove('is-diagram-open');
            const chordName = chordElement.dataset.chord || 'N/A';
            chordElement.setAttribute('aria-label', getChordSlotAriaLabel(chordName));
        });
    });

    chordCapo?.addEventListener('change', () => {
        const nextCapoFret = Number.parseInt(chordCapo.value, 10);
        selectedCapoFret = Number.isFinite(nextCapoFret)
            ? Math.max(0, Math.min(11, nextCapoFret))
            : 0;
        try { localStorage.setItem('sioto-chord-capo', String(selectedCapoFret)); } catch {}
        structureContent.querySelectorAll('.structure-chord').forEach(chordElement => {
            const chordName = chordElement.dataset.chord || '';
            renderChordSlotLabel(chordElement, chordName);
            renderChordPresentation(chordElement, chordName);
            chordElement.classList.remove('is-diagram-open');
            chordElement.setAttribute('aria-label', getChordSlotAriaLabel(chordName));
        });
    });

    document.addEventListener('pointerdown', event => {
        const targetElement = event.target instanceof Element ? event.target : null;
        if (!targetElement?.closest('.volume-control')) {
            volumeControl?.classList.remove('is-open');
            volumeBtn?.setAttribute('aria-expanded', 'false');
        }
        if (!targetElement?.closest('.structure-chord')) {
            structureContent.querySelectorAll('.structure-chord.is-diagram-open').forEach(chordElement => {
                chordElement.classList.remove('is-diagram-open');
            });
        }
    }, { passive: true });

    versionToggle?.addEventListener('click', () => {
        switchSongVersion(activeSongVersion === 'dani' ? 'martin' : 'dani');
    });

    lyricsWaveformCanvas?.addEventListener('click', (event) => {
        if (!currentTrack) return;
        const rect = lyricsWaveformCanvas.getBoundingClientRect();
        if (rect.width <= 0) return;
        const clickRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const currentTime = getPlaybackCurrentTime();
        const windowDuration = getLiveLyricsWaveformWindowDuration();
        const windowStart = currentTime
            - windowDuration * LIVE_LYRICS_WAVEFORM_CURRENT_ANCHOR;
        const targetTime = Math.max(0, Math.min(
            getPlaybackDuration(),
            windowStart + clickRatio * windowDuration
        ));
        seekPlayback(targetTime).catch(err => {
            console.error('Audio play error:', err);
            toggleBtn.disabled = false;
            setToggleIcon(true);
        });
        setToggleIcon(false);
        updateProgressBars();
    });

    function handleAudioEnded(event) {
        if (event.currentTarget !== audio || gaplessTransitioning) return;
        if (useMobileMediaSessionAnchor) return;
        const currentTrackIndex = data.tracks.findIndex(t => t === currentTrack);
        if (
            scheduledGaplessBuffer &&
            scheduledGaplessBuffer.previousTrackIndex === currentTrackIndex &&
            activateScheduledGaplessBuffer(scheduledGaplessBuffer)
        ) {
            return;
        }
        if (currentTrackIndex < data.tracks.length - 1) {
            void startGaplessTransition({ force: true });
        } else {
            finishPlaybackAtAlbumEnd(currentTrackIndex);
        }
    }

    // Cache for performance
    let cachedLyricLines = [];
    let cachedLyricTimings = [];
    let cachedChordElements = [];
    let cachedChordStates = [];
    let cachedChordContainers = [];
    let cachedChordOverlay = null;
    let lastActiveChord = null;
    let activeChordState = null;
    let lastRenderedChordBeat = Number.NaN;
    let lastRenderedLyricState = '';
    let lastRenderedSectionBeat = Number.NaN;
    let selectedSongItem = null;
    let lyricsWaveformLastDrawAt = 0;
    let lyricsWaveformAmplitudes = new Float32Array(0);
    let lastLiveWaveformDinoFrame = -1;
    const lyricsWaveformEnvelopeCache = new Map();
    const lyricsWaveformSectionPalette = ['95, 139, 217', '17, 71, 159'];
    let liveLyricsWindowScaleCache = null;
    let liveLyricsLayoutEntries = [];
    let liveLyricsLayoutWidth = 0;
    let liveLyricsLayoutWindowDuration = 0;
    let lyricsWaveformCssWidth = 0;
    let lyricsWaveformCssHeight = 0;
    let lyricsWaveformContext = null;
    const LIVE_LYRIC_HALF_HEIGHT = 16 * 1.18 / 2;
    const LIVE_LYRIC_HORIZONTAL_PADDING = 8;
    const LIVE_LYRIC_WORD_GAP = 6;
    const liveLyricsEnvelopeScratch = [];

    function getStableLyricsWaveformEnvelope(trackIndex, audioBuffer) {
        const cachedEnvelope = lyricsWaveformEnvelopeCache.get(trackIndex);
        if (cachedEnvelope?.audioBuffer === audioBuffer) return cachedEnvelope;

        const pointsPerSecond = 80;
        const pointCount = Math.max(1, Math.ceil(audioBuffer.duration * pointsPerSecond));
        const rawValues = new Float32Array(pointCount);
        const channels = Array.from(
            { length: Math.min(2, audioBuffer.numberOfChannels) },
            (_, channelIndex) => audioBuffer.getChannelData(channelIndex)
        );
        const samplesPerPoint = audioBuffer.sampleRate / pointsPerSecond;

        for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
            const sampleStart = Math.floor(pointIndex * samplesPerPoint);
            const sampleEnd = Math.min(audioBuffer.length, Math.ceil((pointIndex + 1) * samplesPerPoint));
            const sampleStep = Math.max(1, Math.floor((sampleEnd - sampleStart) / 48));
            let energy = 0;
            let peak = 0;
            let sampleCount = 0;
            for (let sampleIndex = sampleStart; sampleIndex < sampleEnd; sampleIndex += sampleStep) {
                let combinedSample = 0;
                for (const channel of channels) combinedSample += Math.abs(channel[sampleIndex] || 0);
                combinedSample /= Math.max(1, channels.length);
                energy += combinedSample * combinedSample;
                peak = Math.max(peak, combinedSample);
                sampleCount += 1;
            }
            const rms = sampleCount > 0 ? Math.sqrt(energy / sampleCount) : 0;
            rawValues[pointIndex] = Math.min(1, rms * 2.35 + peak * 0.16);
        }

        const values = new Float32Array(pointCount);
        for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
            let weightedValue = 0;
            let totalWeight = 0;
            for (let offset = -2; offset <= 2; offset += 1) {
                const sourceIndex = pointIndex + offset;
                if (sourceIndex < 0 || sourceIndex >= pointCount) continue;
                const weight = 3 - Math.abs(offset);
                weightedValue += rawValues[sourceIndex] * weight;
                totalWeight += weight;
            }
            values[pointIndex] = totalWeight > 0 ? weightedValue / totalWeight : rawValues[pointIndex];
        }

        const envelope = { audioBuffer, pointsPerSecond, values };
        lyricsWaveformEnvelopeCache.set(trackIndex, envelope);
        return envelope;
    }

    function measureLiveLyricTextWidth(text) {
        const measuringCanvas = measureLiveLyricTextWidth.canvas ||
            (measureLiveLyricTextWidth.canvas = document.createElement('canvas'));
        const measuringContext = measuringCanvas.getContext('2d');
        measuringContext.font = '700 16px Garet, Arial, sans-serif';
        return Math.max(
            1,
            measuringContext.measureText(text).width - Math.max(0, text.length - 1) * 0.5
        );
    }

    function rebuildLiveLyricsLayoutCache() {
        liveLyricsLayoutEntries = Array.from(
            liveLyricsDisplay?.querySelectorAll('.live-lyrics-line[data-segment-start]') || []
        ).map(line => {
            const lineText = line.querySelector('.live-lyrics-line__text');
            const text = (lineText?.dataset.lyricText || lineText?.textContent || '').trim();
            const words = Array.from(
                line.querySelectorAll('.live-lyrics-line__word')
            ).map(element => ({
                element,
                width: element.getBoundingClientRect().width ||
                    measureLiveLyricTextWidth(element.textContent || '')
            }));
            return {
                line,
                startTime: Number.parseFloat(line.dataset.segmentStart),
                endTime: Number.parseFloat(line.dataset.segmentEnd),
                words,
                wordCount: Math.max(1, words.length || text.split(/\s+/).filter(Boolean).length),
                isOffWaveform: null,
                x: 0,
                endX: 0
            };
        }).filter(entry => Number.isFinite(entry.startTime))
            .sort((first, second) => first.startTime - second.startTime);
        liveLyricsLayoutWidth = 0;
        liveLyricsLayoutWindowDuration = 0;
    }

    function refreshLiveLyricsSlotMetrics(windowDuration, width) {
        if (
            liveLyricsLayoutWidth === width &&
            liveLyricsLayoutWindowDuration === windowDuration
        ) {
            return;
        }
        for (const entry of liveLyricsLayoutEntries) {
            const slotEndTime = Number.isFinite(entry.endTime) && entry.endTime > entry.startTime
                ? entry.endTime
                : entry.startTime + windowDuration;
            const slotWidth = Math.max(1, ((slotEndTime - entry.startTime) / windowDuration) * width);
            entry.line.style.setProperty('--live-lyric-slot-width', `${slotWidth.toFixed(2)}px`);
            entry.line.style.setProperty('--live-lyric-word-count', String(entry.wordCount));
        }
        liveLyricsLayoutWidth = width;
        liveLyricsLayoutWindowDuration = windowDuration;
    }

    function positionLiveLyricsOnWaveform(windowStart, windowDuration, width) {
        if (windowDuration <= 0 || width <= 0 || !liveLyricsLayoutEntries.length) return;
        refreshLiveLyricsSlotMetrics(windowDuration, width);
        const pixelsPerSecond = width / windowDuration;
        const cursorX = width * LIVE_LYRICS_WAVEFORM_CURRENT_ANCHOR;
        for (const entry of liveLyricsLayoutEntries) {
            const lyricX = (entry.startTime - windowStart) * pixelsPerSecond;
            const lyricEndX = (entry.endTime - windowStart) * pixelsPerSecond;
            entry.x = lyricX;
            entry.endX = lyricEndX;
            const slotWidth = Math.max(1, lyricEndX - lyricX);
            entry.line.style.transform = `translate3d(${lyricX.toFixed(2)}px, -50%, 0)`;

            const lyricContentWidth = Math.max(
                1,
                slotWidth - LIVE_LYRIC_HORIZONTAL_PADDING * 2
            );
            const totalWordGap = LIVE_LYRIC_WORD_GAP * Math.max(0, entry.wordCount - 1);
            const wordSpaceWidth = Math.max(
                1,
                (lyricContentWidth - totalWordGap) / entry.wordCount
            );
            for (let wordIndex = 0; wordIndex < entry.words.length; wordIndex += 1) {
                const word = entry.words[wordIndex];
                const wordSpaceLeft =
                    lyricX +
                    LIVE_LYRIC_HORIZONTAL_PADDING +
                    wordIndex * (wordSpaceWidth + LIVE_LYRIC_WORD_GAP);
                const rightmostOffset = Math.max(0, wordSpaceWidth - word.width);
                const pinnedOffset = Math.max(
                    0,
                    Math.min(rightmostOffset, cursorX - wordSpaceLeft)
                );
                word.element.style.transform =
                    `translate3d(${pinnedOffset.toFixed(2)}px, 0, 0)`;
            }

            const isOffWaveform =
                lyricEndX < 0 ||
                lyricX > width;
            if (isOffWaveform !== entry.isOffWaveform) {
                entry.line.classList.toggle('is-off-waveform', isOffWaveform);
                entry.isOffWaveform = isOffWaveform;
            }
        }
    }

    function renderLyricsWaveform(
        currentTime = getPlaybackCurrentTime(),
        { force = false, duration = getPlaybackDuration() } = {}
    ) {
        if (!lyricsWaveformCanvas || !currentTrack || selectedTrackIndex < 0) return;
        const now = performance.now();
        const width = lyricsWaveformCssWidth || Math.round(lyricsWaveformCanvas.clientWidth);
        const height = lyricsWaveformCssHeight || Math.round(lyricsWaveformCanvas.clientHeight);
        if (width <= 0 || height <= 0 || duration <= 0) return;

        const windowDuration = getLiveLyricsWaveformWindowDuration(currentTrack, width);
        const currentTimeAnchor = LIVE_LYRICS_WAVEFORM_CURRENT_ANCHOR;
        const windowStart = currentTime - windowDuration * currentTimeAnchor;
        const windowEnd = windowStart + windowDuration;
        positionLiveLyricsOnWaveform(windowStart, windowDuration, width);
        if (!force && now - lyricsWaveformLastDrawAt < LIVE_LYRICS_WAVEFORM_FRAME_INTERVAL) return;

        const audioBuffer = preloadedTrackAudio.get(selectedTrackIndex)?.audioBuffer;
        if (!audioBuffer) return;
        lyricsWaveformLastDrawAt = now;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const pixelWidth = Math.max(1, Math.round(width * dpr));
        const pixelHeight = Math.max(1, Math.round(height * dpr));
        if (lyricsWaveformCanvas.width !== pixelWidth || lyricsWaveformCanvas.height !== pixelHeight) {
            lyricsWaveformCanvas.width = pixelWidth;
            lyricsWaveformCanvas.height = pixelHeight;
        }

        const context = lyricsWaveformContext ||
            (lyricsWaveformContext = lyricsWaveformCanvas.getContext('2d'));
        if (!context) return;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#e9f0fb';
        context.fillRect(0, 0, width, height);

        const centerY = height / 2;
        const envelope = getStableLyricsWaveformEnvelope(selectedTrackIndex, audioBuffer);
        if (lyricsWaveformAmplitudes.length !== width) {
            lyricsWaveformAmplitudes = new Float32Array(width);
        }
        const amplitudes = lyricsWaveformAmplitudes;

        const sectionPalette = lyricsWaveformSectionPalette;
        const playbackTrim = getTrackPlaybackTrim(selectedTrackIndex);
        const playbackSecondsPerPixel = windowDuration / Math.max(1, width);
        let playbackTime = windowStart;

        for (let x = 0; x < width; x += 1) {
            if (playbackTime < 0 || playbackTime > duration) {
                amplitudes[x] = 0;
            } else {
                const sourceTime = Math.max(
                    0,
                    Math.min(playbackTrim.rawDuration, playbackTrim.sourceStart + playbackTime)
                );
                const envelopePosition = Math.max(0, Math.min(envelope.values.length - 1, sourceTime * envelope.pointsPerSecond));
                const lowerIndex = Math.floor(envelopePosition);
                const upperIndex = Math.min(envelope.values.length - 1, lowerIndex + 1);
                const interpolation = envelopePosition - lowerIndex;
                amplitudes[x] = envelope.values[lowerIndex]
                    + (envelope.values[upperIndex] - envelope.values[lowerIndex]) * interpolation;
            }
            const contrastedAmplitude = Math.pow(amplitudes[x], 1.7) * 1.35;
            amplitudes[x] = contrastedAmplitude / (1 + contrastedAmplitude * 0.35);
            playbackTime += playbackSecondsPerPixel;
        }

        const lyricEnvelopes = liveLyricsEnvelopeScratch;
        lyricEnvelopes.length = 0;
        for (const entry of liveLyricsLayoutEntries) {
            if (entry.isOffWaveform) continue;
            const left = Math.max(0, entry.x);
            const right = Math.min(width, entry.endX);
            if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) continue;
            entry.visibleLeft = left;
            entry.visibleRight = right;
            lyricEnvelopes.push(entry);
        }

        for (const lyricEnvelopeEntry of lyricEnvelopes) {
            const lyricLeft = lyricEnvelopeEntry.visibleLeft;
            const lyricRight = lyricEnvelopeEntry.visibleRight;
            const lyricHalfHeight = Math.min(height * 0.46, LIVE_LYRIC_HALF_HEIGHT);
            const shoulderWidth = 22;
            const envelopeScale = height * 0.36;
            const shoulderStart = Math.max(0, lyricLeft - shoulderWidth);
            const shoulderEnd = Math.min(width, lyricRight + shoulderWidth);
            for (let x = Math.floor(shoulderStart); x < Math.ceil(shoulderEnd); x += 1) {
                let lyricEnvelope = 1;
                if (x < lyricLeft) lyricEnvelope = (x - shoulderStart) / Math.max(1, lyricLeft - shoulderStart);
                if (x > lyricRight) lyricEnvelope = (shoulderEnd - x) / Math.max(1, shoulderEnd - lyricRight);
                lyricEnvelope = Math.max(0, Math.min(1, lyricEnvelope));
                lyricEnvelope = lyricEnvelope * lyricEnvelope * (3 - 2 * lyricEnvelope);
                const originalAmplitude = amplitudes[x];
                const expandedAmplitude = Math.max(originalAmplitude, lyricHalfHeight * lyricEnvelope / envelopeScale);
                amplitudes[x] = expandedAmplitude;
            }
        }

        const timing = getTrackTiming(currentTrack);
        if (timing.beatDuration > 0) {
            const sourceWindowStart = getSourceTimeForPlaybackTime(selectedTrackIndex, Math.max(0, windowStart));
            const sourceWindowEnd = getSourceTimeForPlaybackTime(selectedTrackIndex, Math.min(duration, windowEnd));
            const firstBeat = Math.floor((sourceWindowStart - timing.startOffset) / timing.beatDuration) - 1;
            const lastBeat = Math.ceil((sourceWindowEnd - timing.startOffset) / timing.beatDuration) + 1;
            context.lineWidth = 1;
            for (let beatIndex = Math.max(0, firstBeat); beatIndex <= lastBeat; beatIndex += 1) {
                const sourceBeatTime = timing.startOffset + beatIndex * timing.beatDuration;
                const playbackBeatTime = getPlaybackTimeForSourceTime(selectedTrackIndex, sourceBeatTime);
                if (playbackBeatTime < windowStart || playbackBeatTime > windowEnd) continue;
                const x = ((playbackBeatTime - windowStart) / windowDuration) * width;
                context.beginPath();
                context.moveTo(Math.round(x) + 0.5, 0);
                context.lineTo(Math.round(x) + 0.5, height);
                context.strokeStyle = 'rgba(31, 86, 180, 0.24)';
                context.stroke();
            }
        }

        const waveformGradient = context.createLinearGradient(0, 0, width, 0);
        waveformGradient.addColorStop(0, 'rgba(35, 107, 208, 0.42)');
        waveformGradient.addColorStop(currentTimeAnchor, 'rgba(31, 86, 180, 0.9)');
        waveformGradient.addColorStop(1, 'rgba(35, 107, 208, 0.42)');
        const waveformPath = new Path2D();
        waveformPath.moveTo(0, centerY);
        for (let x = 0; x < width; x += 1) {
            waveformPath.lineTo(x, centerY - amplitudes[x] * height * 0.36);
        }
        for (let x = width - 1; x >= 0; x -= 1) {
            waveformPath.lineTo(x, centerY + amplitudes[x] * height * 0.36);
        }
        waveformPath.closePath();
        context.fillStyle = waveformGradient;
        context.fill(waveformPath);

        for (const section of currentSeekSections) {
            const sectionStartTime = section.start * duration;
            const sectionEndTime = section.end * duration;
            const visibleStartTime = Math.max(windowStart, sectionStartTime);
            const visibleEndTime = Math.min(windowEnd, sectionEndTime);
            if (visibleEndTime <= visibleStartTime) continue;
            const sectionX = ((visibleStartTime - windowStart) / windowDuration) * width;
            const sectionWidth = ((visibleEndTime - visibleStartTime) / windowDuration) * width;
            const sectionRgb = sectionPalette[(section.index || 0) % sectionPalette.length];
            context.save();
            context.beginPath();
            context.rect(sectionX, 0, Math.max(1, sectionWidth), height);
            context.clip();
            context.fillStyle = `rgba(${sectionRgb}, ${section.index % 2 === 0 ? 0.72 : 0.9})`;
            context.fill(waveformPath);
            context.restore();
        }

        for (const lyricEnvelopeEntry of lyricEnvelopes) {
            context.save();
            context.beginPath();
            context.rect(
                lyricEnvelopeEntry.visibleLeft,
                0,
                Math.max(1, lyricEnvelopeEntry.visibleRight - lyricEnvelopeEntry.visibleLeft),
                height
            );
            context.clip();
            context.fillStyle = '#08205e';
            context.fill(waveformPath);
            context.restore();
        }

        const cursorX = width * currentTimeAnchor;
        const cursorSourceTime = getSourceTimeForPlaybackTime(selectedTrackIndex, currentTime);
        const cursorBeatPosition = timing.beatDuration > 0
            ? Math.max(0, (cursorSourceTime - timing.startOffset) / timing.beatDuration)
            : 0;
        const cursorBeatPhase = cursorBeatPosition - Math.floor(cursorBeatPosition);
        const cursorBeatPulse = Math.max(0, 1 - cursorBeatPhase / 0.55);
        const cursorAmplitudeIndex = Math.max(
            0,
            Math.min(width - 1, Math.round(width * currentTimeAnchor))
        );
        const cursorAmplitude = amplitudes[cursorAmplitudeIndex] * height * 0.36;
        const cursorTop = centerY - cursorAmplitude;
        const cursorHeight = cursorAmplitude * 2;
        const shadowLength = 30;
        const shadowStrength = 0.12 + cursorBeatPulse * 0.84;
        const cursorShadow = context.createLinearGradient(cursorX, 0, cursorX - shadowLength, 0);
        cursorShadow.addColorStop(0, `rgba(255, 255, 255, ${shadowStrength.toFixed(2)})`);
        cursorShadow.addColorStop(0.28, `rgba(255, 255, 255, ${(shadowStrength * 0.58).toFixed(2)})`);
        cursorShadow.addColorStop(1, 'rgba(255, 255, 255, 0)');

        context.save();
        context.fillStyle = cursorShadow;
        context.fillRect(cursorX - shadowLength, cursorTop, shadowLength, cursorHeight);
        context.strokeStyle = '#fff';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(cursorX, cursorTop);
        context.lineTo(cursorX, cursorTop + cursorHeight);
        context.stroke();
        context.restore();

        if (liveWaveformDino && timing.beatDuration > 0) {
            const sourceCurrentTime = getSourceTimeForPlaybackTime(selectedTrackIndex, currentTime);
            const beatPosition = Math.max(0, (sourceCurrentTime - timing.startOffset) / timing.beatDuration);
            const phraseBeats = timing.beatsPerBar * 4;
            const fourBarPhase = (beatPosition % phraseBeats) / phraseBeats;
            const dinoFrame = Math.min(35, Math.floor(fourBarPhase * 36));
            const dinoColumn = dinoFrame % 6;
            const dinoRow = Math.floor(dinoFrame / 6);
            if (dinoFrame !== lastLiveWaveformDinoFrame) {
                liveWaveformDino.style.backgroundPosition = `${dinoColumn * 20}% ${dinoRow * 20}%`;
                lastLiveWaveformDinoFrame = dinoFrame;
            }
        }

        const activeLyricTiming = cachedLyricTimings.find(timingEntry =>
            currentTime >= timingEntry.startTime && currentTime < timingEntry.endTime
        );
        const hasActiveLyric = Boolean(activeLyricTiming);
        lyricsWaveformCanvas.classList.toggle('has-active-lyric', hasActiveLyric);
        liveWaveformDino?.classList.toggle('has-active-lyric', hasActiveLyric);
    }

    if (lyricsWaveformCanvas && window.ResizeObserver) {
        new ResizeObserver(entries => {
            const contentRect = entries[0]?.contentRect;
            if (contentRect) {
                lyricsWaveformCssWidth = Math.round(contentRect.width);
                lyricsWaveformCssHeight = Math.round(contentRect.height);
            }
            if (currentTrack) requestAnimationFrame(() => renderLyricsWaveform(getPlaybackCurrentTime(), { force: true }));
        }).observe(lyricsWaveformCanvas.parentElement || lyricsWaveformCanvas);
    }
    document.fonts?.ready.then(() => {
        liveLyricsWindowScaleCache = null;
        rebuildLiveLyricsLayoutCache();
        if (currentTrack) {
            requestAnimationFrame(() =>
                renderLyricsWaveform(getPlaybackCurrentTime(), { force: true })
            );
        }
    });

    // Recompute chord overlay layout when player becomes visible or viewport changes
    function recomputeChordLayout() {
        try {
            if (!structureContent) return;
            const hostRect = structureContent.getBoundingClientRect();
            if (!hostRect || hostRect.height === 0) return; // not visible yet

            const containers = structureContent.querySelectorAll('.chord-container');
            cachedChordContainers = Array.from(containers).map(c => {
                const r = c.getBoundingClientRect();
                const progressEl = c.querySelector('.chord-progress');
                return {
                    beat: parseInt(progressEl.dataset.beat) - 1,
                    span: parseInt(progressEl.dataset.span) || 1,
                    x: Math.floor(r.left - hostRect.left),
                    y: Math.floor(r.top - hostRect.top),
                    w: Math.floor(r.width),
                    h: Math.floor(r.height)
                };
            });

            const chordsCanvas = document.getElementById('chords-gl');
            cachedChordOverlay = chordsCanvas && window.getChordOverlayRenderer ?
                window.getChordOverlayRenderer(chordsCanvas) : null;
        } catch (e) { /* noop */ }
    }

    // Recompute when resizing viewport
    window.addEventListener('resize', recomputeChordLayout);

    function getLiveLyricSegment(timing) {
        const text = (timing?.line?.textContent || '').trim();
        return {
            text,
            part: 0,
            startTime: timing?.startTime ?? 0,
            endTime: timing?.endTime ?? 0
        };
    }

    function getLiveLyricsWaveformWindowDuration(
        track = currentTrack,
        viewportWidth = lyricsWaveformCanvas?.clientWidth || liveLyricsDisplay?.clientWidth || 0
    ) {
        if (!track) return LIVE_LYRICS_WAVEFORM_FALLBACK_SECONDS;
        const { beatDuration, beatsPerBar } = getTrackTiming(track);
        const barDuration = beatDuration * beatsPerBar;
        const fourBarDuration = barDuration * LIVE_LYRICS_WAVEFORM_WINDOW_BARS;
        if (!Number.isFinite(fourBarDuration) || fourBarDuration <= 0) {
            return LIVE_LYRICS_WAVEFORM_FALLBACK_SECONDS;
        }

        const width = Math.round(viewportWidth);
        if (width <= 0 || cachedLyricTimings.length < 1) return fourBarDuration;
        if (
            liveLyricsWindowScaleCache?.track === track &&
            liveLyricsWindowScaleCache?.width === width &&
            liveLyricsWindowScaleCache?.timings === cachedLyricTimings
        ) {
            return liveLyricsWindowScaleCache.duration;
        }

        const chronologicalTimings = [...cachedLyricTimings]
            .sort((first, second) => first.startTime - second.startTime);
        const measureLyricWidth = timing => {
            const lyricText = (timing.line?.textContent || '').trim();
            const words = lyricText.split(/\s+/).filter(Boolean);
            if (words.length <= 1) return measureLiveLyricTextWidth(lyricText);
            const widestWord = words.reduce(
                (widest, word) => Math.max(widest, measureLiveLyricTextWidth(word)),
                1
            );
            return widestWord * words.length;
        };
        let fittedWindowDuration = fourBarDuration;

        for (const timing of chronologicalTimings) {
            const lyricDuration = timing.endTime - timing.startTime;
            if (lyricDuration <= 0.02) continue;
            const requiredWidth = measureLyricWidth(timing) + 16;
            fittedWindowDuration = Math.min(
                fittedWindowDuration,
                width * lyricDuration / requiredWidth
            );
        }

        for (let index = 0; index < chronologicalTimings.length - 1; index += 1) {
            const timing = chronologicalTimings[index];
            const nextTiming = chronologicalTimings[index + 1];
            const timeGap = nextTiming.startTime - timing.startTime;
            if (timeGap <= 0.02) continue;
            const requiredWidth = measureLyricWidth(timing) + 18;
            fittedWindowDuration = Math.min(
                fittedWindowDuration,
                width * timeGap / requiredWidth
            );
        }

        const duration = Math.max(0.05, fittedWindowDuration);
        liveLyricsWindowScaleCache = {
            track,
            width,
            timings: cachedLyricTimings,
            duration
        };
        return duration;
    }

    function updateLiveLyricsStack(lyricTimings, activeIndex, force = false, currentTime = getPlaybackCurrentTime()) {
        if (!liveLyricsDisplay) return;
        if (!Array.isArray(lyricTimings) || !lyricTimings.length) {
            if (force || liveLyricsDisplay.childElementCount) {
                liveLyricsDisplay.replaceChildren();
                liveLyricsLayoutEntries = [];
                liveLyricsLayoutWidth = 0;
                liveLyricsLayoutWindowDuration = 0;
                lastLiveLyricIndex = -1;
                lastLiveLyricAnchorIndex = 0;
            }
            return;
        }

        const waveformWidth = lyricsWaveformCssWidth ||
            Math.round(lyricsWaveformCanvas?.clientWidth || liveLyricsDisplay.clientWidth);
        const waveformWindowDuration = getLiveLyricsWaveformWindowDuration(currentTrack, waveformWidth);
        const windowStart = currentTime
            - waveformWindowDuration * LIVE_LYRICS_WAVEFORM_CURRENT_ANCHOR;
        const renderStart = windowStart - waveformWindowDuration;
        const renderEnd = windowStart + waveformWindowDuration * 2;
        const visibleIndexes = lyricTimings
            .map((timing, index) => ({ timing, index }))
            .filter(({ timing }) => timing.endTime >= renderStart && timing.startTime <= renderEnd)
            .map(({ index }) => index);
        const activeSegment = activeIndex >= 0 && activeIndex < lyricTimings.length
            ? getLiveLyricSegment(lyricTimings[activeIndex])
            : null;
        const renderKey = `${visibleIndexes.join(',')}|${activeIndex}:${activeSegment?.part ?? 0}`;
        if (!force && renderKey === lastLiveLyricIndex) return;

        const fragment = document.createDocumentFragment();
        for (const index of visibleIndexes) {
            const line = document.createElement('div');
            line.className = 'live-lyrics-line';
            line.dataset.lyricIndex = index;
            line.dataset.seekTime = String(lyricTimings[index]?.startTime ?? 0);
            line.dataset.segmentStart = String(lyricTimings[index]?.startTime ?? 0);
            line.dataset.segmentEnd = String(lyricTimings[index]?.endTime ?? 0);
            const isCenter = index === activeIndex;
            const lineText = document.createElement('span');
            lineText.className = 'live-lyrics-line__text';
            const lyricText = isCenter && activeSegment
                ? activeSegment.text
                : (lyricTimings[index]?.line?.textContent || '').trim();
            const lyricWords = lyricText.split(/\s+/).filter(Boolean);
            lineText.dataset.lyricText = lyricText;
            lineText.setAttribute('aria-label', lyricText);
            for (const word of lyricWords) {
                const wordSpan = document.createElement('span');
                wordSpan.className = 'live-lyrics-line__word';
                wordSpan.setAttribute('aria-hidden', 'true');
                wordSpan.textContent = word;
                lineText.appendChild(wordSpan);
            }
            line.appendChild(lineText);
            if (isCenter && activeSegment) {
                line.classList.add('is-active');
                line.dataset.segmentStart = String(activeSegment.startTime);
                line.dataset.segmentEnd = String(activeSegment.endTime);
            } else {
                line.classList.add(
                    'is-near',
                    lyricTimings[index].startTime < currentTime ? 'is-previous' : 'is-next'
                );
            }
            fragment.appendChild(line);
        }

        liveLyricsDisplay.replaceChildren(fragment);
        rebuildLiveLyricsLayoutCache();
        positionLiveLyricsOnWaveform(
            currentTime - waveformWindowDuration * LIVE_LYRICS_WAVEFORM_CURRENT_ANCHOR,
            waveformWindowDuration,
            waveformWidth
        );
        lastLiveLyricIndex = renderKey;
        lastLiveLyricAnchorIndex = activeIndex;
    }

    function updateProgressBars({ forceTimedContent = false } = {}) {
        if (!currentTrack) return;
        syncActiveTrackToPlaybackTime();
        const currentTime = getPlaybackCurrentTime();
        const duration = getPlaybackDuration();
        renderLyricsWaveform(currentTime, { duration });
        const isPaused = isPlaybackPaused();
        if (isPaused && !forceTimedContent) return;
        if (!isPaused) maybePrepareNextTrack(currentTime, duration);
        
        // Update timeline text (throttle to reduce DOM writes)
        const timeText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        if (timeline.textContent !== timeText) {
            timeline.textContent = timeText;
        }
        updateSectionNavButtons(currentTime, duration);
        
        const progressPercent = duration ? (currentTime / duration) : 0;
        glSeek.render(progressPercent);

        const songGridTime = getSongGridTime(currentTrack, currentTime);
        const { beatDuration, startOffset } = getTrackTiming(currentTrack);
        const currentBeat = Math.floor(songGridTime / beatDuration);
        const isLyricsPanelActive = lyricsPanel?.classList.contains('active') === true;

        // The section label only changes at beat boundaries.
        if (currentBeat !== lastRenderedSectionBeat) {
            let currentSection = '';
            let beatIndex = 0;
            const sections = currentTrack.structure.sections;
            for (let i = 0; i < sections.length; i++) {
                const sectionBeats = sections[i].chords.length;
                if (currentBeat >= beatIndex && currentBeat < beatIndex + sectionBeats) {
                    currentSection = sections[i].label;
                    break;
                }
                beatIndex += sectionBeats;
            }
            const sectionSpan = selectedSongItem?.querySelector('.song-section');
            if (sectionSpan && sectionSpan.textContent !== currentSection) {
                sectionSpan.textContent = currentSection;
            }
            lastRenderedSectionBeat = currentBeat;
        }

        // Find the current lyric every frame for the always-visible live display,
        // but only touch the hidden detailed lyrics when their state changes.
        let activeLyricIndex = -1;
        let lyricState = '';
        const activeLyricText = [];
        const lyricTimings = cachedLyricTimings.length
            ? cachedLyricTimings
            : buildLyricTimingEntries(currentTrack, cachedLyricLines);

        for (let i = 0; i < lyricTimings.length; i++) {
            const timing = lyricTimings[i];
            const isActive = currentTime >= timing.startTime && currentTime < timing.endTime;
            if (isActive) {
                lyricState += 'a';
                if (activeLyricIndex === -1) activeLyricIndex = i;
                activeLyricText.push(timing.line.textContent);
            } else if (currentTime >= timing.endTime) {
                lyricState += 'p';
            } else {
                lyricState += 'f';
            }
        }
        if (isLyricsPanelActive) {
            if (lyricState !== lastRenderedLyricState) {
                for (let i = 0; i < lyricTimings.length; i++) {
                    const timing = lyricTimings[i];
                    const isActive = currentTime >= timing.startTime && currentTime < timing.endTime;
                    const isPassed = currentTime >= timing.endTime;
                    timing.line.classList.toggle('active', isActive);
                    timing.line.classList.toggle('passed', !isActive && isPassed);
                }
                lastRenderedLyricState = lyricState;
            }
        } else {
            lastRenderedLyricState = '';
        }
        const currentLyric = activeLyricText.join(' / ');
        if (currentLyricDisplay) setAnimatedText(currentLyricDisplay, currentLyric);
        updateLiveLyricsStack(lyricTimings, activeLyricIndex, false, currentTime);

        // Chord detail is only visible in the Song tab. Synchronize its full DOM
        // state once per beat, then animate only the active chord's progress.
        if (!isLyricsPanelActive) {
            activeChordState = null;
            lastRenderedChordBeat = Number.NaN;
            return;
        }

        if (currentBeat !== lastRenderedChordBeat) {
            activeChordState = null;
            for (let i = 0; i < cachedChordStates.length; i++) {
                const chordState = cachedChordStates[i];
                const { chord, progressElement, startBeat, endBeat } = chordState;
                const isActive = currentBeat >= startBeat && currentBeat <= endBeat;
                const isPassed = currentBeat > endBeat;

                if (progressElement && !isActive) {
                    const snapProgress = isPassed ? 100 : 0;
                    if (progressElement.style.getPropertyValue('--progress') !== String(snapProgress)) {
                        progressElement.style.setProperty('--progress', snapProgress);
                    }
                }

                if (isActive) {
                    activeChordState = chordState;
                    if (chord !== lastActiveChord) {
                        if (lastActiveChord) lastActiveChord.classList.remove('active');
                        chord.classList.add('active');
                        chord.classList.remove('passed');
                        lastActiveChord = chord;
                    }
                } else if (isPassed && !chord.classList.contains('passed')) {
                    chord.classList.remove('active');
                    chord.classList.add('passed');
                } else if (!isPassed && (chord.classList.contains('active') || chord.classList.contains('passed'))) {
                    chord.classList.remove('active', 'passed');
                }
            }
            lastRenderedChordBeat = currentBeat;
        }

        if (activeChordState?.progressElement) {
            const { progressElement, startBeat, spanLength, extendsToEnd } = activeChordState;
            const beatSourceStartTime = startOffset + startBeat * beatDuration;
            const beatSourceEndTime = beatSourceStartTime + beatDuration * spanLength;
            const beatStartTime = selectedTrackIndex >= 0
                ? getPlaybackTimeForSourceTime(selectedTrackIndex, beatSourceStartTime)
                : beatSourceStartTime;
            const beatEndTime = extendsToEnd
                ? duration
                : (selectedTrackIndex >= 0
                    ? getPlaybackTimeForSourceTime(selectedTrackIndex, beatSourceEndTime)
                    : beatSourceEndTime);
            const beatPlaybackDuration = Math.max(0.001, beatEndTime - beatStartTime);
            let progress = 0;
            if (currentTime >= beatEndTime) progress = 100;
            else if (currentTime >= beatStartTime) {
                progress = ((currentTime - beatStartTime) / beatPlaybackDuration) * 100;
            }
            progressElement.style.setProperty('--progress', progress);
        }
    }

    let animationFrameId = null;
    
    function smoothUpdateLoop() {
        if (isPlaybackPaused() || !currentTrack) {
            animationFrameId = null;
            return;
        }
        updateProgressBars();
        if (telemetryEnabled) updateLiveTelemetryAnalysis();
        animationFrameId = requestAnimationFrame(smoothUpdateLoop);
    }
    
    function handleAudioPlay(event) {
        if (event.currentTarget !== audio) return;
        if (useMobileMediaSessionAnchor) {
            mediaSessionAnchorStartedAt = Date.now();
            updateMediaSessionMetadata();
            setMediaSessionPlaybackState(webAudioPlayback.playing ? 'playing' : 'paused');
            return;
        }
        if (!animationFrameId) {
            smoothUpdateLoop();
        }
        scheduleGaplessBufferIfPossible();
        updateMediaSessionMetadata();
        setMediaSessionPlaybackState('playing');
        updateLiveTelemetryAnalysis(true);
    }
    
    function handleAudioPause(event) {
        if (event.currentTarget !== audio) return;
        if (useMobileMediaSessionAnchor) {
            if (!mediaSessionAnchorExpectedPause && webAudioPlayback.playing) {
                audio.dataset.lastInterruption = 'media-session-anchor-paused';
                void pausePlayback();
                setToggleIcon(true);
            } else {
                setMediaSessionPlaybackState(webAudioPlayback.playing ? 'playing' : 'paused');
            }
            return;
        }
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        setMediaSessionPlaybackState('paused');
        updateLiveTelemetryAnalysis(true);
    }
    
    function handleAudioSeeking(event) {
        if (event.currentTarget !== audio) return;
        if (useMobileMediaSessionAnchor) return;
        updateProgressBars();
        updateLiveTelemetryAnalysis(true);
    }

    function handleAudioTimeUpdate(event) {
        if (event.currentTarget !== audio || audio.paused || !currentTrack) return;
        if (useMobileMediaSessionAnchor) return;
        const duration = audio.duration || trackDurations.get(selectedTrackIndex) || 0;
        maybePrepareNextTrack(audio.currentTime || 0, duration);
    }

    function handleAudioLoadedMetadata(event) {
        if (event.currentTarget !== audio || !currentTrack) return;
        if (useMobileMediaSessionAnchor) return;
        const duration = getPlaybackDuration() || trackDurations.get(selectedTrackIndex) || 0;
        refreshSeekSections(currentTrack, duration);
        glSeek.render(duration ? getPlaybackCurrentTime() / duration : 0);
    }

    function handleAudioError(event) {
        if (event.currentTarget !== audio) return;
        if (useMobileMediaSessionAnchor) {
            console.warn('Mobile media-session anchor error:', audio.error);
            return;
        }
        console.error('Audio error:', audio.error);
        toggleBtn.disabled = false;
        setToggleIcon(true);
    }

    function bindManagedAudioElementEvents(element) {
        element.addEventListener('ended', handleAudioEnded);
        element.addEventListener('play', handleAudioPlay);
        element.addEventListener('pause', handleAudioPause);
        element.addEventListener('seeking', handleAudioSeeking);
        element.addEventListener('timeupdate', handleAudioTimeUpdate);
        element.addEventListener('loadedmetadata', handleAudioLoadedMetadata);
        element.addEventListener('error', handleAudioError);
    }

    bindManagedAudioElementEvents(audio);
    bindManagedAudioElementEvents(standbyAudio);
})
.catch(error => console.error('Error loading JSON:', error));

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const sec = Math.floor(diffMs / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    const week = Math.floor(day / 7);
    const month = Math.floor(day / 30);
    const year = Math.floor(day / 365);

    if (sec < 60) return 'just now';
    if (min < 60) return `${min} ${min === 1 ? 'minute' : 'minutes'} ago`;
    if (hr < 24) return `${hr} ${hr === 1 ? 'hour' : 'hours'} ago`;
    if (day < 14) return `${day} ${day === 1 ? 'day' : 'days'} ago`;
    if (week < 9) return `${week} ${week === 1 ? 'week' : 'weeks'} ago`;
    if (month < 18) return `${month} ${month === 1 ? 'month' : 'months'} ago`;
    return `${year} ${year === 1 ? 'year' : 'years'} ago`;
}
