import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const dataPath = fileURLToPath(new URL("../3000/competition.json", import.meta.url));
const mediaDirectory = fileURLToPath(new URL("../3000/competition-media/", import.meta.url));
const requireFrom3000 = createRequire(new URL("../3000/package.json", import.meta.url));
const data = JSON.parse(await readFile(dataPath, "utf8"));
const instagramSessionId = process.env.INSTAGRAM_SESSION_ID || "";
const previousEntries = new Map(data.entries.map((entry) => [normaliseInstagramUrl(entry.permalink), entry]));
const previousMetrics = new Map(data.metricSnapshots.map((snapshot) => [snapshot.entryId, snapshot]));
const capturedAt = new Date().toISOString();

function decodeHtml(value = "") {
    return value
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&#x27;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&nbsp;", " ")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function metaTags(html) {
    const values = new Map();
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
        const attributes = new Map();
        for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
            attributes.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
        }
        const name = attributes.get("property") || attributes.get("name");
        if (name && attributes.has("content")) values.set(name.toLowerCase(), attributes.get("content"));
    }
    return values;
}

function parseMetricNumber(raw) {
    if (!raw) return null;
    const value = String(raw).trim().replace(/\s/g, "");
    const suffix = value.match(/[kmb]$/i)?.[0]?.toLowerCase();
    const numeric = value.replace(/[kmb]$/i, "");
    let parsed;

    if (suffix) {
        parsed = Number.parseFloat(numeric.replace(",", "."));
    } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(numeric)) {
        parsed = Number(numeric.replace(/[.,]/g, ""));
    } else {
        parsed = Number(numeric.replace(",", "."));
    }

    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * ({ k: 1_000, m: 1_000_000, b: 1_000_000_000 }[suffix] || 1));
}

function jsonCount(html, names) {
    const normalised = html.replaceAll('\\"', '"');
    for (const name of names) {
        const direct = normalised.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`));
        if (direct) return Number(direct[1]);
    }
    return null;
}

function parsePublicPost(html, canonicalUrl) {
    const metas = metaTags(html);
    const description = metas.get("og:description") || metas.get("description") || "";
    const englishCounts = description.match(
        /([\d.,\s]+(?:[kmb])?)\s+likes?\s*,\s*([\d.,\s]+(?:[kmb])?)\s+comments?/i
    );
    const likes = englishCounts
        ? parseMetricNumber(englishCounts[1])
        : jsonCount(html, ["like_count"]);
    const comments = englishCounts
        ? parseMetricNumber(englishCounts[2])
        : jsonCount(html, ["comment_count", "comments_count"]);
    const username = (
        jsonString(html, "username")
        || description.match(/\s-\s+@?([\w.]+)\s+on\s+/i)?.[1]
        || metas.get("og:title")?.match(/^@?([\w.]+)\s+(?:on Instagram|•)/i)?.[1]
        || ""
    ).replace(/^@/, "");
    const timestamp = jsonCount(html, ["taken_at_timestamp", "taken_at"]);
    const pathType = new URL(canonicalUrl).pathname.split("/").filter(Boolean)[0];

    return {
        likes,
        comments,
        username,
        caption: description.replace(/^[\s\S]*?\s-\s+@?[\w.]+\s+on\s+[^:]+:\s*/i, ""),
        thumbnailUrl: metas.get("og:image") || "",
        publishedAt: timestamp ? new Date(timestamp * 1000).toISOString() : null,
        mediaType: pathType === "reel" ? "REEL" : "IMAGE"
    };
}

function jsonString(html, name) {
    const normalised = html.replaceAll('\\"', '"');
    const match = normalised.match(new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (!match) return "";
    try {
        return JSON.parse(`"${match[1]}"`);
    } catch {
        return decodeHtml(match[1]);
    }
}

function normaliseInstagramUrl(rawUrl) {
    if (!rawUrl) return "";
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid Instagram URL: ${rawUrl}`);
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "instagram.com") throw new Error(`Only instagram.com links are allowed: ${rawUrl}`);

    const match = url.pathname.match(/^\/(p|reels?)\/([\w-]+)/i);
    if (!match) throw new Error(`Not an Instagram post or Reel URL: ${rawUrl}`);
    const type = match[1].toLowerCase() === "p" ? "p" : "reel";
    return `https://www.instagram.com/${type}/${match[2]}/`;
}

function entryIdFor(url) {
    const [, type, shortcode] = new URL(url).pathname.match(/^\/(p|reel)\/([\w-]+)/i);
    return `instagram-${type.toLowerCase()}-${shortcode}`;
}

function shortcodeFor(url) {
    return new URL(url).pathname.match(/^\/(?:p|reel)\/([\w-]+)/i)?.[1] || "";
}

function countFromMediaObject(item, type) {
    const candidates = type === "likes"
        ? [
            item?.like_count,
            item?.likesCount,
            item?.edge_media_preview_like?.count,
            item?.edge_liked_by?.count
        ]
        : [
            item?.comment_count,
            item?.comments_count,
            item?.commentsCount,
            item?.edge_media_to_parent_comment?.count,
            item?.edge_media_to_comment?.count
        ];
    const value = candidates.find((candidate) => Number.isFinite(Number(candidate)));
    return value === undefined ? null : Number(value);
}

function findMediaObject(value, shortcode, visited = new Set()) {
    if (!value || typeof value !== "object" || visited.has(value)) return null;
    visited.add(value);

    const candidateShortcode = value.shortcode || value.shortCode || value.code;
    if (
        candidateShortcode === shortcode
        && countFromMediaObject(value, "likes") !== null
        && countFromMediaObject(value, "comments") !== null
    ) {
        return value;
    }

    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        const found = findMediaObject(child, shortcode, visited);
        if (found) return found;
    }
    return null;
}

function postFromMediaObject(item, permalink, source) {
    const likes = countFromMediaObject(item, "likes");
    const comments = countFromMediaObject(item, "comments");
    if (likes === null || comments === null) return null;

    const pathType = new URL(permalink).pathname.split("/").filter(Boolean)[0];
    const timestamp = item.taken_at || item.taken_at_timestamp || item.timestamp;
    const width = Number(item.original_width || item.dimensions?.width || item.width);
    const height = Number(item.original_height || item.dimensions?.height || item.height);
    return {
        likes,
        comments,
        username: item.user?.username || item.owner?.username || item.ownerUsername || "",
        caption: item.caption?.text || item.caption || "",
        thumbnailUrl: (
            item.image_versions2?.candidates?.[0]?.url
            || item.display_url
            || item.displayUrl
            || item.thumbnail_src
            || ""
        ),
        publishedAt: Number.isFinite(Number(timestamp))
            ? new Date(Number(timestamp) * 1000).toISOString()
            : typeof timestamp === "string"
                ? timestamp
                : null,
        mediaType: pathType === "reel"
            ? "REEL"
            : Number(item.media_type) === 8 || item.type === "Sidecar"
                ? "CAROUSEL_ALBUM"
                : "IMAGE",
        mediaAspectRatio: Number.isFinite(width) && Number.isFinite(height) && height > 0
            ? width / height
            : null,
        source
    };
}

function mediaIdFromShortcode(shortcode) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = 0n;
    for (const character of shortcode) {
        const value = alphabet.indexOf(character);
        if (value < 0) throw new Error(`Invalid Instagram shortcode: ${shortcode}`);
        id = id * 64n + BigInt(value);
    }
    return id.toString();
}

async function fetchPostWithSession(permalink) {
    if (!instagramSessionId) throw new Error("INSTAGRAM_SESSION_ID is not configured");
    const mediaId = mediaIdFromShortcode(shortcodeFor(permalink));
    const endpoint = `https://www.instagram.com/api/v1/media/${mediaId}/info/`;
    const response = await fetch(endpoint, {
        headers: {
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": `sessionid=${instagramSessionId}`,
            "Referer": permalink,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
            "X-ASBD-ID": "129477",
            "X-IG-App-ID": "936619743392459",
            "X-Requested-With": "XMLHttpRequest"
        },
        signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload?.message || `Instagram session API returned HTTP ${response.status}`);
    }
    const item = payload?.items?.[0];
    if (!item) throw new Error("Instagram session API returned no post");

    const post = postFromMediaObject(item, permalink, "instagram_authenticated_web");
    if (!post) {
        throw new Error("Instagram session API returned no like/comment counts");
    }
    return post;
}

let chromiumBrowser;
let chromiumContext;

async function getChromiumContext() {
    if (chromiumContext) return chromiumContext;
    const { chromium } = requireFrom3000("playwright-core");
    chromiumBrowser = await chromium.launch({ headless: true });
    chromiumContext = await chromiumBrowser.newContext({
        locale: "en-US",
        viewport: { width: 1365, height: 1000 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
    });
    if (instagramSessionId) {
        await chromiumContext.addCookies([{
            name: "sessionid",
            value: instagramSessionId,
            domain: ".instagram.com",
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "Lax"
        }]);
    }
    return chromiumContext;
}

async function fetchPostWithBrowser(permalink) {
    const context = await getChromiumContext();
    const page = await context.newPage();
    const shortcode = shortcodeFor(permalink);
    const responseTasks = [];
    let mediaObject = null;

    page.on("response", (response) => {
        const contentType = response.headers()["content-type"] || "";
        if (!contentType.includes("json") || !/(graphql|\/api\/)/i.test(response.url())) return;
        responseTasks.push((async () => {
            try {
                const payload = await response.json();
                mediaObject ||= findMediaObject(payload, shortcode);
            } catch {
                // Some Instagram responses are streamed or not valid JSON.
            }
        })());
    });

    try {
        await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(5_000);
        await Promise.allSettled(responseTasks);
        const closeOverlay = page.locator('[aria-label="Close"]').first();
        if (await closeOverlay.isVisible().catch(() => false)) {
            await closeOverlay.click();
            await page.waitForTimeout(400);
        }

        const networkPost = mediaObject
            ? postFromMediaObject(mediaObject, permalink, "instagram_rendered_browser")
            : null;
        if (networkPost) return networkPost;

        let capturedPrimaryMedia = "";
        let capturedAspectRatio = null;
        const primaryMedia = page.locator('[aria-label="Video player"]').first();
        if (await primaryMedia.count()) {
            const box = await primaryMedia.boundingBox();
            if (box && box.width * box.height >= 40_000) {
                await mkdir(mediaDirectory, { recursive: true });
                const filename = `${entryIdFor(permalink)}.png`;
                await primaryMedia.screenshot({ path: `${mediaDirectory}${filename}` });
                capturedPrimaryMedia = `competition-media/${filename}`;
                capturedAspectRatio = box.width / box.height;
            }
        }

        const rendered = await page.evaluate(() => {
            const root = document.querySelector("article") || document.querySelector("main") || document.body;
            const text = root?.innerText || "";
            const videoPoster = root?.querySelector("video[poster]")?.poster || "";
            const image = [...(root?.querySelectorAll("img") || [])]
                .map((element) => ({
                    src: element.currentSrc || element.src,
                    area: Math.max(
                        element.naturalWidth * element.naturalHeight,
                        element.clientWidth * element.clientHeight
                    )
                }))
                .filter((candidate) => candidate.src && candidate.area >= 40_000)
                [0]?.src || "";
            const profileLink = [...(root?.querySelectorAll('a[href^="/"]') || [])]
                .map((anchor) => anchor.getAttribute("href"))
                .find((href) => /^\/[\w.]+\/$/.test(href || ""));
            return {
                text,
                image: videoPoster || image,
                username: profileLink?.split("/").filter(Boolean)[0] || "",
                labels: [...document.querySelectorAll("[aria-label]")]
                    .map((element) => element.getAttribute("aria-label"))
                    .filter(Boolean)
                    .slice(0, 80)
            };
        });
        const summaryMatch = rendered.text.match(
            /\n([\d.,]+\s*[kmb]?)\s*\n([\d.,]+\s*[kmb]?)\s*\n(?:\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?)\s+ago|[a-z]+\s+\d{1,2}(?:,\s+\d{4})?)/i
        );
        const likesMatch = (
            summaryMatch && [summaryMatch[0], summaryMatch[1]]
            || rendered.text.match(/([\d.,\s]+(?:[kmb])?)\s+likes?\b/i)
            || rendered.text.match(/liked by[\s\S]{0,100}?\band\s+([\d.,\s]+(?:[kmb])?)\s+others?\b/i)
            || rendered.labels.join("\n").match(/([\d.,\s]+(?:[kmb])?)\s+likes?\b/i)
        );
        const commentsMatch = (
            summaryMatch && [summaryMatch[0], summaryMatch[2]]
            || rendered.text.match(/view all\s+([\d.,\s]+(?:[kmb])?)\s+comments?\b/i)
            || rendered.text.match(/([\d.,\s]+(?:[kmb])?)\s+comments?\b/i)
            || rendered.labels.join("\n").match(/([\d.,\s]+(?:[kmb])?)\s+comments?\b/i)
        );
        const likes = parseMetricNumber(likesMatch?.[1]);
        const comments = parseMetricNumber(commentsMatch?.[1]);
        if (!Number.isFinite(likes) || !Number.isFinite(comments)) {
            throw new Error(
                `rendered page contained no counts `
                + `(text: ${JSON.stringify(rendered.text.slice(0, 800))}; `
                + `tail: ${JSON.stringify(rendered.text.slice(-240))}; `
                + `labels: ${JSON.stringify(rendered.labels)})`
            );
        }

        return {
            likes,
            comments,
            username: rendered.username,
            caption: "",
            thumbnailUrl: capturedPrimaryMedia || rendered.image,
            mediaAspectRatio: capturedAspectRatio,
            publishedAt: null,
            mediaType: new URL(permalink).pathname.startsWith("/reel/") ? "REEL" : "IMAGE",
            source: "instagram_rendered_browser"
        };
    } finally {
        await page.close();
    }
}

async function fetchPublicPost(url) {
    const candidates = [url, `${url}embed/captioned/`];
    const diagnostics = [];

    for (const candidate of candidates) {
        const response = await fetch(candidate, {
            redirect: "follow",
            headers: {
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
            }
        });
        if (!response.ok) {
            diagnostics.push(`${new URL(candidate).pathname}: HTTP ${response.status}`);
            continue;
        }

        const html = await response.text();
        const parsed = parsePublicPost(html, url);
        if (Number.isFinite(parsed.likes) && Number.isFinite(parsed.comments)) {
            return { ...parsed, source: "instagram_public_page" };
        }

        const description = metaTags(html).get("og:description") || metaTags(html).get("description") || "";
        diagnostics.push(
            `${new URL(candidate).pathname}: ${html.length} bytes, description `
            + `${JSON.stringify(description.slice(0, 120))}, like_count ${html.includes("like_count")}, `
            + `comment_count ${html.includes("comment_count")}`
        );
    }

    throw new Error(`Instagram did not expose public like/comment counts (${diagnostics.join("; ")})`);
}

function collectSubmissionLinks() {
    const links = [];
    for (const [trackId, trackLinks] of Object.entries(data.submissionLinksByTrack || {})) {
        if (!Array.isArray(trackLinks)) throw new Error(`submissionLinksByTrack.${trackId} must be an array`);
        for (const rawUrl of trackLinks) {
            const permalink = normaliseInstagramUrl(rawUrl);
            links.push({ trackId, permalink });
        }
    }

    const duplicates = links.filter((item, index) => (
        links.findIndex((candidate) => candidate.permalink === item.permalink) !== index
    ));
    if (duplicates.length) throw new Error(`Duplicate submission link: ${duplicates[0].permalink}`);
    return links;
}

if (process.argv.includes("--self-test")) {
    const sample = parsePublicPost(
        '<meta property="og:description" content="1,234 likes, 56 comments - @demo.user on July 25, 2026: &quot;Test post&quot;"><meta property="og:image" content="https://example.com/image.jpg">',
        "https://www.instagram.com/reel/TEST123/"
    );
    if (
        sample.likes !== 1234
        || sample.comments !== 56
        || sample.username !== "demo.user"
        || sample.mediaType !== "REEL"
        || mediaIdFromShortcode("CfevKEjjO3W") !== "2872941012581150166"
        || normaliseInstagramUrl("https://www.instagram.com/reels/DbLqIoJu3CQ/")
            !== "https://www.instagram.com/reel/DbLqIoJu3CQ/"
    ) {
        throw new Error(`Public post parser self-test failed: ${JSON.stringify(sample)}`);
    }
    console.log("Public Instagram post parser self-test passed.");
    process.exit(0);
}

const links = collectSubmissionLinks();
if (!instagramSessionId && links.length) {
    console.log("INSTAGRAM_SESSION_ID is not configured; using anonymous rendered-browser mode.");
}

const entries = [];
const snapshots = [];
const participantsByUsername = new Map();
let changed = false;
let failures = 0;
let successfulFetches = 0;

for (const { trackId, permalink } of links) {
    const id = entryIdFor(permalink);
    const previousEntry = previousEntries.get(permalink);
    const previousSnapshot = previousMetrics.get(previousEntry?.id || id);

    try {
        let post;
        if (instagramSessionId) {
            try {
                post = await fetchPostWithSession(permalink);
            } catch (error) {
                console.warn(`Authenticated fetch failed for ${permalink}: ${error.message}; trying public fallback.`);
            }
        }
        if (!post) {
            try {
                post = await fetchPostWithBrowser(permalink);
            } catch (error) {
                console.warn(`Rendered-browser fetch failed for ${permalink}: ${error.message}; trying HTML fallback.`);
            }
        }
        post ||= await fetchPublicPost(permalink);
        successfulFetches += 1;
        const previousParticipant = data.participants.find((item) => item.id === previousEntry?.participantId);
        const username = post.username || previousParticipant?.username || `post_${id.split("-").at(-1)}`;
        const participantId = `instagram-user-${username.toLowerCase().replace(/[^\w.-]+/g, "-")}`;
        participantsByUsername.set(username.toLowerCase(), {
            id: participantId,
            username,
            displayName: username
        });

        const entry = {
            id,
            participantId,
            trackId: Number.isFinite(Number(trackId)) ? Number(trackId) : trackId,
            permalink,
            mediaType: post.mediaType,
            caption: post.caption,
            thumbnailUrl: post.thumbnailUrl,
            mediaAspectRatio: post.mediaAspectRatio || previousEntry?.mediaAspectRatio || 1,
            publishedAt: post.publishedAt || previousEntry?.publishedAt || capturedAt,
            submittedAt: previousEntry?.submittedAt || capturedAt,
            status: previousEntry?.status || "approved"
        };
        const countsChanged = (
            !previousSnapshot
            || previousSnapshot.likes !== post.likes
            || previousSnapshot.comments !== post.comments
        );
        const snapshot = countsChanged
            ? {
                id: `metric-latest-${id}`,
                entryId: id,
                capturedAt,
                likes: post.likes,
                comments: post.comments,
                source: post.source
            }
            : { ...previousSnapshot, entryId: id };

        entries.push(entry);
        snapshots.push(snapshot);
        changed ||= countsChanged || JSON.stringify(entry) !== JSON.stringify(previousEntry);
        console.log(`${permalink} — ${post.likes} likes, ${post.comments} comments`);
    } catch (error) {
        failures += 1;
        console.error(`Could not sync ${permalink}: ${error.message}`);
        if (previousEntry) {
            entries.push(previousEntry);
            const username = data.participants.find((item) => item.id === previousEntry.participantId);
            if (username) participantsByUsername.set(username.username.toLowerCase(), username);
        }
        if (previousSnapshot) snapshots.push(previousSnapshot);
    }
}

data.participants = [...participantsByUsername.values()];
data.entries = entries;
data.metricSnapshots = snapshots;
const snapshotSources = new Set(snapshots.map((snapshot) => snapshot.source));
data.instagramSync.provider = snapshotSources.has("instagram_authenticated_web")
    ? "instagram_authenticated_web"
    : snapshotSources.has("instagram_rendered_browser")
        ? "instagram_rendered_browser"
        : "instagram_public_page";
data.instagramSync.failedEntries = failures;
if (successfulFetches > 0) data.instagramSync.lastFetchedAt = capturedAt;
if (changed) data.instagramSync.lastSyncedAt = capturedAt;

await chromiumBrowser?.close();
await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`Checked ${links.length} links; ${failures} failed; metrics ${changed ? "changed" : "unchanged"}.`);
if (links.length && successfulFetches === 0) process.exitCode = 1;
