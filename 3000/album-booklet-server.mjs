import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, createReadStream } from "node:fs";
import { dirname, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const parentRoot = dirname(projectRoot);
const host = "127.0.0.1";
const port = 8765;
const bookletUrl = `http://${host}:${port}/album-booklet.html`;
const exportTimeoutMs = Number.parseInt(process.env.BOOKLET_EXPORT_TIMEOUT_MS || "120000", 10);

function log(message) {
    console.log(message);
}

const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wav": "audio/wav",
    ".webp": "image/webp"
};

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    ].filter(Boolean);
    return candidates.find(existsSync);
}

function safeFilePath(requestUrl) {
    const pathname = decodeURIComponent(new URL(requestUrl, bookletUrl).pathname);
    if (pathname.startsWith("/fonts/")) {
        const target = resolve(parentRoot, `.${pathname}`);
        const fontsRoot = resolve(parentRoot, "fonts");
        return target.startsWith(fontsRoot) ? target : null;
    }
    const relative = pathname === "/" ? "album-booklet.html" : pathname.slice(1);
    const target = resolve(projectRoot, normalize(relative));
    return target.startsWith(projectRoot) ? target : null;
}

function sendFile(response, filePath) {
    if (!filePath || !existsSync(filePath)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }
    response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
}

async function createVectorPdf() {
    const chromePath = findChrome();
    if (!chromePath) throw new Error("Google Chrome or Microsoft Edge is required for vector PDF export");
    log("Starting vector PDF render");
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(bookletUrl, { waitUntil: "domcontentloaded", timeout: exportTimeoutMs });
        const deadline = Date.now() + exportTimeoutMs;
        let pageState;
        while (Date.now() < deadline) {
            pageState = await page.evaluate(() => ({
                fonts: document.fonts.status,
                readyState: document.readyState,
                sheets: document.querySelectorAll(".sheet-side").length,
                status: document.querySelector("#status")?.textContent || ""
            }));
            if (pageState?.readyState === "complete" && pageState?.fonts === "loaded" && pageState?.sheets === 8 && pageState?.status.includes("print ready")) break;
            await page.waitForTimeout(200);
        }
        if (Date.now() >= deadline) throw new Error(`The booklet did not finish loading before export: ${JSON.stringify(pageState)}`);

        log("Booklet is ready; writing PDF");
        await page.emulateMedia({ media: "print" });
        const pdf = await page.pdf({
            displayHeaderFooter: false,
            height: "120mm",
            margin: { bottom: "0", left: "0", right: "0", top: "0" },
            preferCSSPageSize: true,
            printBackground: true,
            scale: 1,
            width: "240mm"
        });
        log("Vector PDF complete");
        return pdf;
    } finally {
        await browser.close();
    }
}

let activeExport;

const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, bookletUrl).pathname;
        if (pathname === "/__export_booklet_pdf") {
            activeExport ||= createVectorPdf().finally(() => { activeExport = null; });
            const pdf = await activeExport;
            response.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="album-booklet.pdf"',
                "Content-Length": pdf.length,
                "Content-Type": "application/pdf"
            });
            response.end(pdf);
            return;
        }
        sendFile(response, safeFilePath(request.url));
    } catch (error) {
        console.error(error);
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : "PDF export failed");
    }
});

server.listen(port, host, () => {
    console.log(`Album booklet ready at ${bookletUrl}`);
    console.log("Keep this window open while previewing and exporting.");
    if (process.platform === "win32" && process.env.BOOKLET_NO_OPEN !== "1") {
        spawn("cmd.exe", ["/c", "start", "", bookletUrl], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
});
