(() => {
    const state = {
        album: null,
        competitionData: null,
        tracks: [],
        entries: [],
        leaders: [],
        selectedTrack: "all"
    };

    const elements = {
        cover: document.getElementById("album-cover"),
        status: document.getElementById("competition-status"),
        start: document.getElementById("competition-start"),
        end: document.getElementById("competition-end"),
        window: document.getElementById("competition-window"),
        prizes: document.getElementById("prize-grid"),
        scores: document.getElementById("score-row"),
        syncTime: document.getElementById("sync-time"),
        leaderboard: document.getElementById("leaderboard"),
        posts: document.getElementById("posts-grid"),
        trackFilter: document.getElementById("track-filter"),
        emptyTemplate: document.getElementById("empty-state-template")
    };

    const tabs = document.getElementById("competition-tabs");

    tabs.addEventListener("click", (event) => {
        const button = event.target.closest(".competition-tab");
        if (!button) return;

        tabs.querySelectorAll(".competition-tab").forEach((tab) => {
            const active = tab === button;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", String(active));
        });

        document.querySelectorAll(".competition-tab-panel").forEach((panel) => {
            const active = panel.id === `tab-${button.dataset.tab}`;
            panel.classList.toggle("active", active);
            panel.hidden = !active;
        });
    });

    const numberFormatter = new Intl.NumberFormat("mk-MK");
    const dateFormatter = new Intl.DateTimeFormat("mk-MK", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Skopje"
    });
    const dateTimeFormatter = new Intl.DateTimeFormat("mk-MK", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Skopje"
    });

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeUrl(value) {
        if (!value) return "";
        const raw = String(value).trim();
        if (/^(?:\.{0,2}\/)?[\w%./-]+(?:\?[^#]*)?(?:#.*)?$/.test(raw)) {
            return raw;
        }
        try {
            const url = new URL(raw, window.location.href);
            if (url.protocol === "https:") return url.href;
            if (
                url.origin === window.location.origin
                && (url.protocol === "http:" || url.protocol === "file:")
            ) {
                return url.href;
            }
            return "";
        } catch {
            return "";
        }
    }

    function formatPrize(amount, currency = "MKD") {
        return `${numberFormatter.format(amount)} ${currency === "MKD" ? "МКД" : currency}`;
    }

    function mediaAspect(entry) {
        const value = Number(entry.mediaAspectRatio);
        return Number.isFinite(value) && value >= 0.4 && value <= 2 ? value : 1;
    }

    function getCompetitionStatus(competition) {
        const now = Date.now();
        const start = new Date(competition.startAt).getTime();
        const end = new Date(competition.endAt).getTime();
        if (now < start) return "upcoming";
        if (now > end) return "ended";
        return "live";
    }

    function latestSnapshots(rows) {
        const latest = new Map();
        rows.forEach((snapshot) => {
            const current = latest.get(snapshot.entryId);
            if (!current || new Date(snapshot.capturedAt) > new Date(current.capturedAt)) {
                latest.set(snapshot.entryId, snapshot);
            }
        });
        return latest;
    }

    function calculateScore(snapshot, rules) {
        if (!snapshot) return null;
        const complete = rules.every((rule) => Number.isFinite(Number(snapshot[rule.metric])));
        if (!complete) return null;
        return rules.reduce((total, rule) => {
            return total + Number(snapshot[rule.metric]) * Number(rule.pointsPerUnit);
        }, 0);
    }

    function buildEntries(data) {
        const participants = new Map(data.participants.map((participant) => [participant.id, participant]));
        const tracks = new Map(state.tracks.map((track) => [String(track.id), track]));
        const snapshots = latestSnapshots(data.metricSnapshots);

        return data.entries
            .map((entry) => {
                const snapshot = snapshots.get(entry.id) || null;
                return {
                    ...entry,
                    participant: participants.get(entry.participantId) || {
                        username: "unknown",
                        displayName: "Unknown"
                    },
                    track: tracks.get(String(entry.trackId)) || null,
                    metrics: snapshot,
                    score: calculateScore(snapshot, data.scoringRules)
                };
            })
            .filter((entry) => entry.track);
    }

    function buildLeaders(entries) {
        const competition = state.competitionData.competition;
        const eligibleTypes = new Set(competition.eligibleMediaTypes || ["IMAGE", "CAROUSEL_ALBUM", "REEL"]);
        return entries
            .filter((entry) => (
                entry.status === "approved"
                && entry.score !== null
                && eligibleTypes.has(entry.mediaType)
            ))
            .sort((a, b) => (
                b.score - a.score
                || new Date(a.submittedAt) - new Date(b.submittedAt)
                || String(a.id).localeCompare(String(b.id))
            ))
            .slice(0, 10);
    }

    function getPrizeForRank(rank, data) {
        return data.prizeRules.find((rule) => rule.scope === "overall" && Number(rule.rank) === rank) || null;
    }

    function renderCompetitionMeta(data) {
        const competition = data.competition;
        const status = getCompetitionStatus(competition);
        elements.status.dataset.status = status;
        elements.status.textContent = {
            live: "Во тек",
            upcoming: "Наскоро",
            ended: "Завршен"
        }[status];
        elements.start.textContent = dateFormatter.format(new Date(competition.startAt));
        elements.end.textContent = dateFormatter.format(new Date(competition.endAt));
        elements.window.textContent = `${dateFormatter.format(new Date(competition.startAt))} — ${dateFormatter.format(new Date(competition.endAt))}`;

        const prizeOrder = data.prizeRules
            .filter((rule) => rule.scope === "overall")
            .sort((a, b) => Number(a.rank) - Number(b.rank));
        const prizeLabels = ["Прво место", "Второ место", "Трето место", "Четврто место", "Петто место"];

        elements.prizes.innerHTML = prizeOrder.map((prize, index) => `
            <div class="prize">
                <span class="prize-label">${prizeLabels[index]}</span>
                <strong class="prize-value">${formatPrize(prize.amount, prize.currency)}</strong>
            </div>
        `).join("") + `
            <div class="prize prize--booklet">
                <span class="prize-label">Топ 10</span>
                <strong class="prize-value">Физички буклет од албумот</strong>
            </div>
        `;

        const scoreIcons = {
            likes: "fa-heart",
            comments: "fa-comment"
        };
        const scoreLabels = {
            likes: "Like",
            comments: "Comment"
        };

        const lastFetchedAt = data.instagramSync.lastFetchedAt || data.instagramSync.lastSyncedAt;
        elements.syncTime.textContent = lastFetchedAt
            ? `Последно преземено: ${dateTimeFormatter.format(new Date(lastFetchedAt))}`
            : "Се чека првото Instagram ажурирање";
    }

    function renderTrackFilter() {
        const current = elements.trackFilter.value || state.selectedTrack;
        elements.trackFilter.innerHTML = [
            '<option value="all">Сите песни</option>',
            ...state.tracks.map((track) => (
                `<option value="${escapeHtml(track.id)}">${String(track.id).padStart(2, "0")} · ${escapeHtml(track.title)}</option>`
            ))
        ].join("");
        elements.trackFilter.value = state.tracks.some((track) => String(track.id) === current) ? current : "all";
    }

    function renderLeaderboard() {
        if (!state.leaders.length) {
            elements.leaderboard.replaceChildren(elements.emptyTemplate.content.cloneNode(true));
            return;
        }

        elements.leaderboard.innerHTML = state.leaders.map((entry, index) => {
            const prize = getPrizeForRank(index + 1, state.competitionData);
            const username = `@${entry.participant.username}`;
            const thumbnail = safeUrl(entry.thumbnailUrl);
            return `
                <a class="leader-row" href="${safeUrl(entry.permalink)}" target="_blank" rel="noopener">
                    <strong class="leader-rank">${index + 1}</strong>
                    <span class="leader-media" style="--media-aspect: ${mediaAspect(entry)}">
                        ${thumbnail
                            ? `<img src="${thumbnail}" alt="Пријава од ${escapeHtml(username)}" loading="lazy">`
                            : '<i class="fa-brands fa-instagram" aria-hidden="true"></i>'}
                    </span>
                    <span class="leader-user">
                        <strong>${escapeHtml(username)}</strong>
                        <span>Моментален лидер</span>
                    </span>
                    <span class="leader-song">
                        <strong>${escapeHtml(entry.track.title)}</strong>
                        <span>Песна ${String(entry.track.id).padStart(2, "0")}</span>
                    </span>
                    <span class="leader-score">
                        <strong>${numberFormatter.format(entry.score)}</strong>
                        <span>Поени</span>
                    </span>
                    <span class="leader-prize">
                        <strong>${prize ? numberFormatter.format(prize.amount) : "Буклет"}</strong>
                        <span>${prize ? "МКД + буклет" : "Физички буклет"}</span>
                    </span>
                </a>
            `;
        }).join("");
    }

    function metricValue(entry, metric) {
        const value = entry.metrics?.[metric];
        return Number.isFinite(Number(value)) ? numberFormatter.format(Number(value)) : "—";
    }

    function renderPosts() {
        const visibleEntries = state.entries
            .filter((entry) => state.selectedTrack === "all" || String(entry.trackId) === state.selectedTrack)
            .sort((a, b) => {
                if (a.score === null && b.score !== null) return 1;
                if (a.score !== null && b.score === null) return -1;
                return (b.score || 0) - (a.score || 0) || new Date(a.submittedAt) - new Date(b.submittedAt);
            });

        if (!visibleEntries.length) {
            elements.posts.replaceChildren(elements.emptyTemplate.content.cloneNode(true));
            return;
        }

        elements.posts.innerHTML = visibleEntries.map((entry) => {
            const thumbnail = safeUrl(entry.thumbnailUrl);
            const mediaIcon = entry.mediaType === "REEL" ? "fa-video" : "fa-image";
            const username = `@${entry.participant.username}`;
            return `
                <article class="post-card">
                    <a class="post-media" href="${safeUrl(entry.permalink)}" target="_blank" rel="noopener"
                        aria-label="Отвори ја Instagram објавата од ${escapeHtml(username)}"
                        style="--media-aspect: ${mediaAspect(entry)}">
                        ${thumbnail
                            ? `<img src="${thumbnail}" alt="Пријава од ${escapeHtml(username)}" loading="lazy">`
                            : '<i class="fa-brands fa-instagram" aria-hidden="true"></i>'}
                        <span class="media-type"><i class="fa-solid ${mediaIcon}" aria-hidden="true"></i></span>
                    </a>
                    <div class="post-content">
                        <div class="post-user-row">
                            <span class="post-user">${escapeHtml(username)}</span>
                            <strong class="post-score">${entry.score === null ? "—" : numberFormatter.format(entry.score)}</strong>
                        </div>
                        <p class="post-track">${String(entry.track.id).padStart(2, "0")} · ${escapeHtml(entry.track.title)}</p>
                        <div class="metric-row" aria-label="Instagram engagement">
                            <span class="metric"><i class="fa-solid fa-heart" aria-hidden="true"></i>${metricValue(entry, "likes")}</span>
                            <span class="metric"><i class="fa-solid fa-comment" aria-hidden="true"></i>${metricValue(entry, "comments")}</span>
                        </div>
                        <a class="post-link" href="${safeUrl(entry.permalink)}" target="_blank" rel="noopener">
                            <i class="fa-brands fa-instagram" aria-hidden="true"></i> Отвори ја објавата
                        </a>
                    </div>
                </article>
            `;
        }).join("");
    }

    function render() {
        renderCompetitionMeta(state.competitionData);
        renderTrackFilter();
        renderLeaderboard();
        renderPosts();
    }

    function validateData(albumData, competitionData) {
        if (!albumData?.album || !Array.isArray(albumData.tracks)) {
            throw new Error("Податоците за албумот не се достапни.");
        }
        if (
            !competitionData?.competition
            || !Array.isArray(competitionData.scoringRules)
            || !Array.isArray(competitionData.prizeRules)
            || !Array.isArray(competitionData.participants)
            || !Array.isArray(competitionData.entries)
            || !Array.isArray(competitionData.metricSnapshots)
        ) {
            throw new Error("Податоците за натпреварот не се достапни.");
        }
    }

    async function load() {
        try {
            const [albumResponse, competitionResponse] = await Promise.all([
                fetch("album.json"),
                fetch("competition.json", { cache: "no-store" })
            ]);
            if (!albumResponse.ok || !competitionResponse.ok) throw new Error("Податоците за натпреварот не може да се вчитаат.");

            const [albumData, competitionData] = await Promise.all([
                albumResponse.json(),
                competitionResponse.json()
            ]);
            validateData(albumData, competitionData);

            state.album = albumData;
            state.competitionData = competitionData;
            state.tracks = albumData.tracks.slice(0, albumData.album.standardTrackCount || 10);
            state.entries = buildEntries(competitionData);
            state.leaders = buildLeaders(state.entries);
            elements.cover.src = safeUrl(albumData.album.coverImage) || "album_cover_500x500.webp";
            elements.cover.alt = `Насловната слика на ${albumData.album.title} од ${albumData.album.band}`;
            render();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Натпреварот не може да се вчита.";
            elements.leaderboard.innerHTML = `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
            elements.posts.innerHTML = `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
            elements.status.textContent = "Недостапно";
            elements.status.dataset.status = "ended";
        }
    }

    elements.trackFilter.addEventListener("change", () => {
        state.selectedTrack = elements.trackFilter.value;
        renderPosts();
    });

    load();
    window.setInterval(load, 60000);
})();
