// Real WebCodecs regression smoke, independent of the user's projects and app session.
// Requires Windows Edge and FFmpeg on PATH. Run: node scripts/smoke-render.mjs
import { createServer } from "vite";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const temporary = await mkdtemp(join(tmpdir(), "clipper-webcodecs-"));
const sourceChannels = Number(process.env.SMOKE_CHANNELS || 1);
assert.ok([1, 2, 6].includes(sourceChannels), "SMOKE_CHANNELS must be 1, 2 or 6");
let server;
let browser;
let socket;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const source = join(temporary, "source.mp4");
  const fixture = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=96000", "-t", "1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "96000", "-ac", String(sourceChannels), source], { windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr?.toString());
  const encoded = (await readFile(source)).toString("base64");
  server = await createServer({ configFile: resolve("vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false, host: "127.0.0.1" } });
  server.middlewares.use("/__smoke", async (_req, res, next) => {
    try {
      const html = await server.transformIndexHtml("/__smoke", "<!doctype html><title>Clipper WebCodecs smoke</title>");
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } catch (error) { next(error); }
  });
  await server.listen();
  const port = server.httpServer.address().port;
  const profile = join(temporary, "edge-profile");
  browser = spawn(process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
    "--headless=new", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--disable-sync",
    "--autoplay-policy=no-user-gesture-required", `http://127.0.0.1:${port}/__smoke`,
  ], { windowsHide: true, stdio: "ignore" });
  let debugPort;
  for (let i = 0; i < 150; i++) {
    try { debugPort = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch { await delay(200); }
  }
  assert.ok(debugPort, "Edge did not start its isolated debugging session");
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/__smoke`)}`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, reject) => { socket.addEventListener("open", r, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const requests = new Map();
  socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); const pending = requests.get(message.id); if (pending) { requests.delete(message.id); pending(message); } });
  const cdp = async (method, params = {}) => {
    const id = ++sequence;
    const response = new Promise((r) => requests.set(id, r));
    socket.send(JSON.stringify({ id, method, params }));
    let timeout;
    let result;
    try {
      result = await Promise.race([response, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 120_000);
      })]);
    } finally { clearTimeout(timeout); }
    if (result.error) throw new Error(JSON.stringify(result.error));
    return result.result;
  };
  for (let i = 0; i < 100; i++) {
    const state = await cdp("Runtime.evaluate", { expression: "location.pathname === '/__smoke' && document.readyState === 'complete'", returnByValue: true });
    if (state.result.value) break;
    await delay(100);
  }
  const result = await cdp("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const { renderClipperFormat } = await import('/src/features/clipper/engine/render/format.util.ts');
    const { DEFAULT_CLIPPER_SETTINGS } = await import('/src/features/clipper/settings/settings.util.ts');
    const { Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js');
    const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), c => c.charCodeAt(0));
    const file = new File([bytes], 'source.mp4', { type: 'video/mp4' });
    const settings = structuredClone(DEFAULT_CLIPPER_SETTINGS);
    settings.captions.enabled = false;
    settings.branding = { ...settings.branding, kind: 'text', text: '' };
    settings.formats.resolutionCap = '720p';
    settings.formats.quality = 'draft';
    const context = { settings, captionGroups: [], faceCache: null, disabledCollageRegionIds: [],
      smartCropAnalysis: { clipStart: 0, clipEnd: 1.2, analyzerVersion: 'smoke', modelId: 'smoke', aspectTracks: {
        youtube: { targetAspectRatio: 16/9, samples: [
          { t: 0, crop: { x: 0, y: 0, width: 1280/1920, height: 720/1080 } },
          { t: 1.2, crop: { x: 0.05, y: 0.05, width: 1284/1920, height: 724/1080 } },
        ] },
      } },
    };
    const format = { id: 'youtube', platform: 'youtube', aspectId: '16-9', mode: 'crop' };
    const diagnostics = [];
    const result = await renderClipperFormat(file, format, context, {
      clipWindow: { segments: [{ startSec: 0.1, endSec: 0.5 }, { startSec: 0.7, endSec: 1.1 }] },
      onDiagnostics: d => diagnostics.push(d),
    });
    const input = new Input({ source: new BlobSource(result.blob), formats: ALL_FORMATS });
    try {
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      settings.captions.enabled = true;
      settings.branding.text = 'Smoke';
      await renderClipperFormat(file, format, context, {
        clipWindow: { segments: [{ startSec: 0, endSec: 0.3 }] },
      });
      const controller = new AbortController();
      let cancelled = false;
      try {
        await renderClipperFormat(file, format, context, {
          signal: controller.signal, clipWindow: { segments: [{ startSec: 0, endSec: 1.1 }] },
          onProgress: ratio => { if (ratio > 0) controller.abort(); },
        });
      } catch (error) { cancelled = error.name === 'AbortError'; }
      return { cancelled, width: video.codedWidth, height: video.codedHeight, sampleRate: audio.sampleRate,
        channels: audio.numberOfChannels, duration: await input.computeDuration(), bytes: result.blob.size,
        sampleSizes: [...new Set(diagnostics.filter(d => d.sample).map(d => d.sample.width + 'x' + d.sample.height))] };
    } finally { input.dispose(); }
  })()` });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const value = result.result.value;
  assert.deepEqual([value.width, value.height, value.sampleRate, value.channels], [1280, 720, 48_000, sourceChannels === 1 ? 1 : 2]);
  assert.ok(Math.abs(value.duration - 0.8) < 0.08, `Incorrect stitched duration: ${value.duration}`);
  assert.deepEqual(value.sampleSizes, ["1280x720"]);
  assert.equal(value.cancelled, true, "Render did not cancel cleanly");
  console.log("WebCodecs render passed:", JSON.stringify(value));
  await cdp("Browser.close");
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
    await delay(500);
  }
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill();
  await server?.close();
  // Only this script's unique mkdtemp directory is removed.
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
