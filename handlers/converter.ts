import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { spawn } from 'child_process';
import * as iconv from 'iconv-lite';
import { NauticaSong } from '../models/nautica_song';
import { GetNextNauticaId, invalidateMusicDbCache } from '../utils';
import { uploadSongZip, isDriveEnabled } from './drive';

// Conversion queue to avoid parallel CPU-heavy operations
let conversionQueue: NauticaSong[] = [];
let isConverting = false;

export async function convertNauticaSong(song: NauticaSong): Promise<void> {
  // Skip if this chart is already waiting in the queue — prevents double-queueing
  // if Reconvert All is pressed twice, or if an admin requeues a chart that is
  // still pending from an earlier call.
  if (conversionQueue.some(s => s.nauticaId === song.nauticaId)) return;
  conversionQueue.push(song);
  if (!isConverting) processQueue();
}

// Bulk reconversion path. Unlike convertNauticaSong (which queues per-song
// and invokes VoxCharger once per chart), this prepares all charts in
// parallel (download + extract), writes a manifest, then invokes VoxCharger
// exactly once with --bulk-import --manifest. Target use case is
// Reconvert All, where the N-times per-chart .exe startup / DB-load /
// DB-save overhead dominates wall clock time.
//
// Mutually exclusive with the per-song queue via the shared isConverting
// flag — callers should wait (see acquireSingleRunnerSlot) or just push
// to the queue and let the queue drain first.
export async function bulkConvertNauticaSongs(songs: NauticaSong[]): Promise<{ ok: number; failed: number }> {
  if (songs.length === 0) return { ok: 0, failed: 0 };

  await acquireSingleRunnerSlot();
  isConverting = true;

  try {
    return await doBulkConvert(songs);
  } finally {
    isConverting = false;
    // Drain anything that was queued via convertNauticaSong while bulk ran.
    if (conversionQueue.length > 0) processQueue();
  }
}

// Simple mutual-exclusion: spin until isConverting is false. JS is
// single-threaded so the check-and-set pair after the await is atomic
// wrt other async calls that do the same.
async function acquireSingleRunnerSlot(): Promise<void> {
  while (isConverting) {
    await new Promise(r => setTimeout(r, 500));
  }
}

async function doBulkConvert(songs: NauticaSong[]): Promise<{ ok: number; failed: number }> {
  const gameRoot = U.GetConfig('sdvx_eg_root_dir');
  const voxchargerPath = U.GetConfig('sdvx_voxcharger_path');
  const mixName = U.GetConfig('sdvx_custom_mix_name') || 'asphyxia_custom';

  if (!gameRoot) throw new Error('Game Data Directory not configured');
  if (!voxchargerPath) throw new Error('VoxCharger path not configured');
  if (!fs.existsSync(voxchargerPath)) throw new Error(`VoxCharger not found at: ${voxchargerPath}`);

  console.log(`[Nautica] Bulk reconvert starting: ${songs.length} chart(s)`);
  const startedAt = Date.now();

  // Phase 1: download + extract all zips in parallel (throttled).
  const CONCURRENT_PREPS = 4;
  const prepared: PreparedSong[] = [];
  const prepFailedIds: string[] = [];

  const todo = [...songs];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENT_PREPS, todo.length); i++) {
    workers.push((async () => {
      while (todo.length > 0) {
        const song = todo.shift()!;
        const p = await prepareForConversion(song);
        if (p) prepared.push(p);
        else prepFailedIds.push(song.nauticaId);
      }
    })());
  }
  await Promise.all(workers);

  if (prepared.length === 0) {
    console.error('[Nautica] Bulk reconvert: all preparations failed');
    return { ok: 0, failed: prepFailedIds.length };
  }

  // Phase 2: write manifest <mid>\t<code>\t<kshPath> per line.
  const manifestPath = path.join(os.tmpdir(), `asphyxia_bulk_manifest_${Date.now()}.txt`);
  const manifestLines = prepared.map(
    p => `${p.song.mid}\t${sanitizeAscii(p.song.title)}\t${p.kshFile}`
  );
  fs.writeFileSync(manifestPath, manifestLines.join('\n'), 'utf8');
  console.log(`[Nautica] Manifest written (${prepared.length} entries): ${manifestPath}`);

  // Phase 3: one VoxCharger invocation for all charts.
  try {
    const voxArgs = [
      '--bulk-import',
      '--manifest', manifestPath,
      '--game-path', gameRoot,
      '--mix', mixName,
    ];
    console.log(`[Nautica] Running: "${voxchargerPath}" ${voxArgs.map(a => `"${a}"`).join(' ')}`);

    // Cap at 5 min per chart (ffmpeg dominates, and parallel parsing is fast).
    // Stream output live so the user sees VoxCharger's per-chart progress
    // instead of a 10-minute silence followed by a wall of text.
    const timeoutMs = Math.max(600_000, 300_000 * prepared.length);
    await runCommand(voxchargerPath, voxArgs, {
      timeout: timeoutMs,
      streamPrefix: '[VoxCharger]',
    });
  } catch (err: any) {
    // If bulk import itself fails, mark every prepared song as error — we
    // have no way to know which charts were imported before the failure.
    console.error(`[Nautica] Bulk VoxCharger run failed: ${err.message}`);
    for (const p of prepared) {
      try { fs.rmSync(p.tmpDir, { recursive: true, force: true }); } catch {}
      await DB.Update<NauticaSong>(
        { collection: 'nautica_song', nauticaId: p.song.nauticaId },
        { $set: { status: 'error' as const, errorMessage: `bulk import failed: ${err.message}` } }
      );
    }
    try { fs.unlinkSync(manifestPath); } catch {}
    return { ok: 0, failed: prepared.length + prepFailedIds.length };
  }
  try { fs.unlinkSync(manifestPath); } catch {}

  // Phase 4: per-song post-processing.
  //   - patchMergedXml applies the global (leading-zero / illustrator) fixes
  //     to the WHOLE document on every call, so running it for each song is
  //     idempotent (the last call wins for the global parts anyway).
  //   - updateCustomMusicDb rewrites the json once per song.
  //   - cleanup the per-song tmp dir.
  for (const p of prepared) {
    try {
      patchMergedXml(p.song, gameRoot, mixName);
      updateCustomMusicDb(p.song);
    } catch (err: any) {
      console.error(`[Nautica] Post-process failed for ${p.song.title}: ${err.message}`);
    }
    try { fs.rmSync(p.tmpDir, { recursive: true, force: true }); } catch {}
  }
  invalidateMusicDbCache();

  // Phase 5: mark everything ready.
  let ok = 0;
  for (const p of prepared) {
    try {
      await DB.Update<NauticaSong>(
        { collection: 'nautica_song', nauticaId: p.song.nauticaId },
        { $set: { status: 'ready' as const, convertedAt: Date.now() } }
      );
      ok++;
    } catch (err: any) {
      console.error(`[Nautica] Status update failed for ${p.song.title}: ${err.message}`);
    }
  }

  // Phase 6: Drive uploads — throttled + retry. Firing all N at once caused
  // Google to reset most of the connections mid-upload (read ECONNRESET).
  // 3 concurrent uploads keeps the pipe busy without tripping rate limits,
  // and a small retry with backoff handles transient resets.
  if (isDriveEnabled()) {
    const DRIVE_CONCURRENCY = 3;
    const uploadQueue = prepared.slice();

    const runOne = async (p: PreparedSong) => {
      const latest = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: p.song.nauticaId });
      if (!latest) return;
      const upStart = Date.now();
      console.log(`[Nautica] Uploading to Drive: ${latest.title} (ID ${latest.mid})...`);

      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const result = await uploadSongZip(latest);
          if (!result) {
            console.log(`[Nautica] Drive upload skipped for ${latest.title}.`);
            return;
          }
          await DB.Update<NauticaSong>(
            { collection: 'nautica_song', nauticaId: latest.nauticaId },
            { $set: {
              driveFileId: result.fileId,
              driveFileSize: result.size,
              driveUploadedAt: Date.now(),
            } }
          );
          const mb = (result.size / (1024 * 1024)).toFixed(2);
          const secs = ((Date.now() - upStart) / 1000).toFixed(1);
          console.log(`[Nautica] Uploaded to Drive: ${latest.title} — ${mb} MB in ${secs}s`);
          return;
        } catch (err: any) {
          const msg = (err && err.message) || String(err);
          const transient = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|EAI_AGAIN/i.test(msg);
          if (transient && attempt < MAX_ATTEMPTS) {
            const backoff = 2000 * attempt + Math.floor(Math.random() * 1000);
            console.log(`[Nautica] Drive upload transient error for ${latest.title} (attempt ${attempt}/${MAX_ATTEMPTS}): ${msg}; retrying in ${backoff}ms`);
            await new Promise(r => setTimeout(r, backoff));
            continue;
          }
          console.error(`[Nautica] Drive upload failed for ${latest.title}: ${msg}`);
          return;
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(DRIVE_CONCURRENCY, uploadQueue.length); i++) {
      workers.push((async () => {
        while (uploadQueue.length > 0) {
          const next = uploadQueue.shift()!;
          await runOne(next);
        }
      })());
    }
    // Fire and forget the overall wait so the function can return to its
    // caller promptly; uploads continue in the background and log on their
    // own. Errors never reject the promise (runOne swallows them).
    Promise.all(workers).catch(() => {});
  }

  const totalSecs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[Nautica] Bulk reconvert done: ${ok} converted, ${prepFailedIds.length} prep-failed in ${totalSecs}s`);
  return { ok, failed: prepFailedIds.length };
}

// Prefetched artifacts for a song whose zip has already been downloaded and
// extracted, ready for VoxCharger to run on it. `null` means prep failed —
// the error was already logged and DB status updated by prepareForConversion.
interface PreparedSong {
  song: NauticaSong;
  kshFile: string;
  tmpDir: string;
}

async function processQueue() {
  if (isConverting || conversionQueue.length === 0) return;
  isConverting = true;

  try {
    await processQueueLoop();
  } finally {
    isConverting = false;
  }
}

// Kept separate so the outer processQueue can reliably reset isConverting
// via try/finally even if an unhandled exception sneaks through.
async function processQueueLoop() {
  // 1-ahead prefetch: while VoxCharger runs on song N, download/extract for
  // song N+1 in the background. Downloads are ~5s, VoxCharger ~20-60s, so
  // the next song's zip is already staged by the time we need it. Conversion
  // itself stays serial — VoxCharger writes music_db.merged.xml, and racing
  // writes would corrupt it.
  let nextPrepared: Promise<PreparedSong | null> | null = null;

  while (conversionQueue.length > 0 || nextPrepared) {
    let prepared: PreparedSong | null;
    if (nextPrepared) {
      prepared = await nextPrepared;
      nextPrepared = null;
    } else {
      prepared = await prepareForConversion(conversionQueue.shift()!);
    }

    // Kick off the download for the song after the one we're about to run.
    if (conversionQueue.length > 0) {
      nextPrepared = prepareForConversion(conversionQueue.shift()!);
    }

    if (!prepared) continue; // prep failed; DB already marked 'error'

    const song = prepared.song;
    try {
      await executeConversion(prepared);
      await DB.Update<NauticaSong>(
        { collection: 'nautica_song', nauticaId: song.nauticaId },
        { $set: { status: 'ready' as const, convertedAt: Date.now() } }
      );
      console.log(`[Nautica] Converted: ${song.title} (ID ${song.mid})`);

      if (isDriveEnabled()) {
        const latest = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: song.nauticaId });
        if (latest) {
          console.log(`[Nautica] Uploading to Drive: ${latest.title} (ID ${latest.mid})...`);
          const startedAt = Date.now();
          uploadSongZip(latest).then(async (result) => {
            if (!result) {
              console.log(`[Nautica] Drive upload skipped for ${latest.title} (no zip produced — check Drive config / game directory).`);
              return;
            }
            await DB.Update<NauticaSong>(
              { collection: 'nautica_song', nauticaId: latest.nauticaId },
              { $set: {
                driveFileId: result.fileId,
                driveFileSize: result.size,
                driveUploadedAt: Date.now(),
              }}
            );
            const mb = (result.size / (1024 * 1024)).toFixed(2);
            const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
            const viewUrl = `https://drive.google.com/file/d/${result.fileId}/view`;
            console.log(`[Nautica] Uploaded to Drive: ${latest.title} (ID ${latest.mid}) — ${mb} MB in ${secs}s`);
            console.log(`[Nautica]   \u2192 ${viewUrl}`);
          }).catch((err: any) => {
            console.error(`[Nautica] Drive upload failed for ${latest.title}: ${err.message}`);
          });
        }
      }
    } catch (err: any) {
      console.error(`[Nautica] Conversion error for ${song.title}: ${err.message}`);
      await DB.Update<NauticaSong>(
        { collection: 'nautica_song', nauticaId: song.nauticaId },
        { $set: { status: 'error' as const, errorMessage: err.message } }
      );
    }
  }
}

// Phase 1 of conversion: allocate mid, download the Nautica zip, extract it,
// and locate the .ksh file. Runs in parallel across songs (network-bound).
// On failure marks the song as 'error' and returns null so the caller can
// skip it without aborting the whole batch.
async function prepareForConversion(song: NauticaSong): Promise<PreparedSong | null> {
  try {
    if (!song.mid || song.mid === 0) {
      song.mid = await GetNextNauticaId();
    }
    await DB.Update<NauticaSong>(
      { collection: 'nautica_song', nauticaId: song.nauticaId },
      { $set: { status: 'converting' as const, mid: song.mid } }
    );

    const tmpDir = path.join(os.tmpdir(), `nautica_${song.nauticaId}`);
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    console.log(`[Nautica] Downloading: ${song.title}`);
    const zipPath = path.join(tmpDir, 'chart.zip');
    await downloadFile(song.downloadUrl, zipPath);

    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZip(zipPath, extractDir);

    const kshFiles = findFiles(extractDir, '.ksh');
    if (kshFiles.length === 0) throw new Error('No .ksh files found in downloaded chart');
    const kshFile = kshFiles[0];
    console.log(`[Nautica] Prepared: ${song.title} (${path.basename(kshFile)})`);

    return { song, kshFile, tmpDir };
  } catch (err: any) {
    console.error(`[Nautica] Prep failed for ${song.title}: ${err.message}`);
    await DB.Update<NauticaSong>(
      { collection: 'nautica_song', nauticaId: song.nauticaId },
      { $set: { status: 'error' as const, errorMessage: err.message } }
    );
    return null;
  }
}

// Phase 2 of conversion: run VoxCharger on the prepared KSH, patch the
// merged XML, update the asphyxia-side custom music DB, invalidate caches,
// and clean up the temp directory. Must run serially — VoxCharger writes
// music_db.merged.xml and concurrent writes would corrupt it.
async function executeConversion(prepared: PreparedSong): Promise<void> {
  const { song, kshFile, tmpDir } = prepared;
  const gameRoot = U.GetConfig('sdvx_eg_root_dir');
  const voxchargerPath = U.GetConfig('sdvx_voxcharger_path');
  const mixName = U.GetConfig('sdvx_custom_mix_name') || 'asphyxia_custom';

  if (!gameRoot) throw new Error('Game Data Directory not configured');
  if (!voxchargerPath) throw new Error('VoxCharger path not configured');
  if (!fs.existsSync(voxchargerPath)) throw new Error(`VoxCharger not found at: ${voxchargerPath}`);

  const ascii = sanitizeAscii(song.title);

  try {
    const voxArgs = [
      '--full-import', kshFile,
      '--game-path', gameRoot,
      '--mix', mixName,
      '--music-id', String(song.mid),
      '--music-code', ascii,
    ];
    console.log(`[Nautica] Running: "${voxchargerPath}" ${voxArgs.map(a => `"${a}"`).join(' ')}`);

    // 10 minute cap — VoxCharger runs ffmpeg internally and heavy remixes can
    // take a few minutes on slower CPUs.
    const output = await runCommand(voxchargerPath, voxArgs, { timeout: 600000 });
    console.log(`[Nautica] VoxCharger output:\n${output}`);

    patchMergedXml(song, gameRoot, mixName);
    updateCustomMusicDb(song);
    invalidateMusicDbCache();
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = (url: string, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const proto = url.startsWith('https') ? https : require('http');
      proto.get(url, (res: any) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doGet(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    doGet(url);
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const psCommand = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
  await runCommand('powershell', ['-NoProfile', '-Command', psCommand], { timeout: 60000 });
}

// Promise-wrapped spawn. Unlike execSync this does NOT block the Node event
// loop, so the server stays responsive while external tools (VoxCharger,
// PowerShell) run. Collects stdout/stderr and rejects on non-zero exit or
// timeout.
//
// When `streamPrefix` is set, each line of the child's stdout/stderr is
// forwarded to the parent console in real time — required for long-running
// tools (VoxCharger bulk mode can run 10+ minutes) so the user can see
// progress without waiting for the process to exit.
function runCommand(
  command: string,
  args: string[],
  options: { timeout?: number; cwd?: string; streamPrefix?: string } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const prefix = options.streamPrefix;
    let stdoutCarry = '';
    let stderrCarry = '';
    const forwardLines = (carry: string, chunk: string, write: (line: string) => void): string => {
      const combined = carry + chunk;
      const lines = combined.split(/\r?\n/);
      const tail = lines.pop() || '';
      for (const line of lines) {
        if (line.length > 0) write(line);
      }
      return tail;
    };

    child.stdout.on('data', (d: Buffer) => {
      stdoutChunks.push(d);
      if (prefix) stdoutCarry = forwardLines(stdoutCarry, d.toString('utf8'), line => console.log(`${prefix} ${line}`));
    });
    child.stderr.on('data', (d: Buffer) => {
      stderrChunks.push(d);
      if (prefix) stderrCarry = forwardLines(stderrCarry, d.toString('utf8'), line => console.error(`${prefix} ${line}`));
    });

    let timedOut = false;
    const timer = options.timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeout)
      : null;

    child.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      // Flush any pending partial line without a trailing newline.
      if (prefix) {
        if (stdoutCarry.length > 0) console.log(`${prefix} ${stdoutCarry}`);
        if (stderrCarry.length > 0) console.error(`${prefix} ${stderrCarry}`);
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        return reject(new Error(`Command timed out after ${options.timeout}ms`));
      }
      if (code !== 0) {
        return reject(new Error(`Command exited ${code ?? signal}: ${stderr || stdout}`));
      }
      resolve(stdout);
    });
  });
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.toLowerCase().endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function sanitizeAscii(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 16)
    .toLowerCase() || 'custom';
}

export function updateCustomMusicDb(song: NauticaSong): void {
  // Absolute path via IO.Resolve — using a relative 'plugins/...' string broke
  // when node was started from dist/ (cwd = dist/, so writes landed in
  // dist/plugins/... and the real webui asset never got updated).
  const customDbPath = IO.Resolve('webui/asset/json/custom_music_db.json');

  let data: any = { mdb: { music: [] } };
  if (fs.existsSync(customDbPath)) {
    try { data = JSON.parse(fs.readFileSync(customDbPath, 'utf8')); }
    catch { data = { mdb: { music: [] } }; }
  }
  if (!data.mdb) data.mdb = { music: [] };
  if (!data.mdb.music) data.mdb.music = [];

  // Remove existing entry for this ID
  data.mdb.music = data.mdb.music.filter((s: any) => String(s.id) !== String(song.mid));

  // Map Nautica chart difficulties
  // Nautica: 1=NOV, 2=ADV, 3=EXH, 4=INF/MXM
  // For custom charts, Nautica difficulty 4 maps to MXM (maximum) since INF requires inf_ver
  const diffLevels: Record<string, string> = {
    novice: '0', advanced: '0', exhaust: '0', infinite: '0', maximum: '0', ultimate: '0',
  };
  const diffMap = ['novice', 'advanced', 'exhaust', 'maximum', 'maximum'];
  for (const chart of song.charts) {
    const idx = chart.difficulty - 1;
    if (idx >= 0 && idx < diffMap.length) {
      diffLevels[diffMap[idx]] = String(chart.level);
    }
  }

  data.mdb.music.push({
    id: String(song.mid),
    info: {
      title_name: song.title,
      version: '7',
      inf_ver: '0',
      distribution_date: parseInt(formatDate()),
    },
    difficulty: diffLevels,
  });

  fs.writeFileSync(customDbPath, JSON.stringify(data, null, 2), 'utf8');
}

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function toShiftJIS(utf8str: string): string {
  const encoded = iconv.encode(utf8str, 'Shift_JIS');
  return encoded.toString('binary');
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function patchMergedXml(song: NauticaSong, gameRoot: string, mixName: string): void {
  try {
    const xmlPath = path.join(gameRoot, 'data_mods', mixName, 'others', 'music_db.merged.xml');
    if (!fs.existsSync(xmlPath)) return;

    let xml = fs.readFileSync(xmlPath, 'binary');

    const idStr = String(song.mid);
    const entryStart = xml.indexOf(`music id="${idStr}"`);
    if (entryStart === -1) return;
    const entryEnd = xml.indexOf('</music>', entryStart);
    if (entryEnd === -1) return;

    let entry = xml.slice(entryStart, entryEnd + 8);

    // Fix title and artist with correct text from ksm.dev (convert UTF-8 to Shift-JIS)
    const sjisTitle = toShiftJIS(escapeXml(song.title));
    const sjisArtist = toShiftJIS(escapeXml(song.artist));

    entry = entry.replace(/<title_name>[^<]*<\/title_name>/, `<title_name>${sjisTitle}</title_name>`);
    entry = entry.replace(/<artist_name>[^<]*<\/artist_name>/, `<artist_name>${sjisArtist}</artist_name>`);

    // Fix yomigana with safe placeholder (Shift-JIS for ダミー)
    const sjisDummy = '\x83\x5F\x83\x7E\x81\x5B';
    entry = entry.replace(/<title_yomigana>[^<]*<\/title_yomigana>/, `<title_yomigana>${sjisDummy}</title_yomigana>`);
    entry = entry.replace(/<artist_yomigana>[^<]*<\/artist_yomigana>/, `<artist_yomigana>${sjisDummy}</artist_yomigana>`);

    // Splice the per-entry edits back in, then apply global fixes to the
    // WHOLE document. VoxCharger re-serializes every entry on every import,
    // so leading-zero BPMs and empty illustrator tags re-appear for older
    // songs whenever a new one is imported. Fixing per-entry only patches
    // the current song — global fixes keep all entries clean.
    xml = xml.slice(0, entryStart) + entry + xml.slice(entryEnd + 8);

    // Strip leading zeros in typed numeric values — otherwise the game's
    // prop parser reads values like "06380" as octal and aborts music_db
    // parsing (error 80092209), which breaks chart selection and scores.
    xml = xml.replace(/__type="(u\d+|s\d+)">0+(\d)/g, '__type="$1">$2');

    // Fix empty illustrator tags across all entries.
    xml = xml.replace(/<illustrator><\/illustrator>/g, '<illustrator>-</illustrator>');

    fs.writeFileSync(xmlPath, xml, 'binary');

    console.log(`[Nautica] Patched XML for ${song.title} (ID ${song.mid})`);
  } catch (err: any) {
    console.error(`[Nautica] Failed to patch XML: ${err.message}`);
  }
}
