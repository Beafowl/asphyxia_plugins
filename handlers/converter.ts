import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { execSync } from 'child_process';
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

async function processQueue() {
  if (isConverting || conversionQueue.length === 0) return;
  isConverting = true;

  while (conversionQueue.length > 0) {
    const song = conversionQueue.shift()!;
    try {
      // Allocate music ID here inside the sequential queue to prevent duplicates
      if (!song.mid || song.mid === 0) {
        song.mid = await GetNextNauticaId();
      }
      await DB.Update<NauticaSong>(
        { collection: 'nautica_song', nauticaId: song.nauticaId },
        { $set: { status: 'converting' as const, mid: song.mid } }
      );
      await doConversion(song);
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

async function doConversion(song: NauticaSong): Promise<void> {
  const gameRoot = U.GetConfig('sdvx_eg_root_dir');
  const voxchargerPath = U.GetConfig('sdvx_voxcharger_path');
  const mixName = U.GetConfig('sdvx_custom_mix_name') || 'asphyxia_custom';

  if (!gameRoot) throw new Error('Game Data Directory not configured');
  if (!voxchargerPath) throw new Error('VoxCharger path not configured');
  if (!fs.existsSync(voxchargerPath)) throw new Error(`VoxCharger not found at: ${voxchargerPath}`);

  const ascii = sanitizeAscii(song.title);

  // Create temp directory for download/extraction
  const tmpDir = path.join(os.tmpdir(), `nautica_${song.nauticaId}`);
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Step 1: Download ZIP from Nautica
    console.log(`[Nautica] Downloading: ${song.title}`);
    const zipPath = path.join(tmpDir, 'chart.zip');
    await downloadFile(song.downloadUrl, zipPath);

    // Step 2: Extract ZIP
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    extractZip(zipPath, extractDir);

    // Step 3: Find the first KSH file
    const kshFiles = findFiles(extractDir, '.ksh');
    if (kshFiles.length === 0) throw new Error('No .ksh files found in downloaded chart');

    const kshFile = kshFiles[0];
    console.log(`[Nautica] Found KSH: ${path.basename(kshFile)}`);

    // Step 4: Run VoxCharger --full-import
    const cmd = `"${voxchargerPath}" --full-import "${kshFile}" --game-path "${gameRoot}" --mix "${mixName}" --music-id ${song.mid} --music-code "${ascii}"`;
    console.log(`[Nautica] Running: ${cmd}`);

    const output = execSync(cmd, {
      timeout: 120000,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    console.log(`[Nautica] VoxCharger output:\n${output}`);

    // Step 5: Fix VoxCharger XML output (garbled encoding + leading zeros)
    patchMergedXml(song, gameRoot, mixName);

    // Step 6: Update custom_music_db.json for asphyxia score tracking
    updateCustomMusicDb(song);

    // Step 7: Invalidate cache
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

function extractZip(zipPath: string, destDir: string): void {
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
    { timeout: 60000, stdio: 'pipe' }
  );
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
  const customDbPath = 'plugins/sdvx@asphyxia/webui/asset/json/custom_music_db.json';

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

    // Fix leading zeros in typed numeric values
    entry = entry.replace(/__type="(u\d+|s\d+)">0+(\d)/g, '__type="$1">$2');

    // Fix empty illustrator tags
    entry = entry.replace(/<illustrator><\/illustrator>/g, '<illustrator>-</illustrator>');

    xml = xml.slice(0, entryStart) + entry + xml.slice(entryEnd + 8);
    fs.writeFileSync(xmlPath, xml, 'binary');

    console.log(`[Nautica] Patched XML for ${song.title} (ID ${song.mid})`);
  } catch (err: any) {
    console.error(`[Nautica] Failed to patch XML: ${err.message}`);
  }
}
