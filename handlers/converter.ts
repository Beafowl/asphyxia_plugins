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

  isConverting = false;
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
function runCommand(
  command: string,
  args: string[],
  options: { timeout?: number; cwd?: string } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
    child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

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

function updateCustomMusicDb(song: NauticaSong): void {
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
