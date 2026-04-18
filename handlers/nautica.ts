import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { NauticaSong } from '../models/nautica_song';
import { NominationFeedback } from '../models/nomination_feedback';
import { DeletedNauticaSong } from '../models/deleted_nautica_song';
import { MusicRecord } from '../models/music_record';
import { invalidateMusicDbCache } from '../utils';
import { convertNauticaSong } from './converter';
import { deleteDriveFile } from './drive';
import { WebUISend } from '../../../src/eamuse/EamusePlugin';

function nauticaGet(urlPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://ksm.dev${urlPath}`;
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Failed to parse Nautica response')); }
      });
    }).on('error', reject);
  });
}

// ─── Browse Nautica API ─────────────────────────────────────────────────────

function parseSearch(input: string): { text: string; levels: string | null } {
  let text = input;
  let levels: string | null = null;

  // Extract level:X or levels:X,Y,Z from the query
  const levelMatch = text.match(/\blevels?:(\d+(?:,\d+)*)\b/i);
  if (levelMatch) {
    levels = levelMatch[1];
    text = text.replace(levelMatch[0], '').trim();
  }

  return { text, levels };
}

export const nauticaBrowse = async (data: { page?: number; search?: string }, send: WebUISend) => {
  try {
    const page = data.page || 1;
    const raw = (data.search || '').trim();

    if (!raw) {
      const result = await nauticaGet(`/app/songs?page=${page}`);
      send.json(result);
      return;
    }

    const { text, levels } = parseSearch(raw);
    const levelParam = levels ? `&levels=${levels}` : '';

    // No text query — just filter by level
    if (!text) {
      const result = await nauticaGet(`/app/songs?page=${page}${levelParam}`);
      send.json(result);
      return;
    }

    // Search by title/artist AND effector, merge results
    const [titleResult, effectorResult] = await Promise.all([
      nauticaGet(`/app/songs?page=${page}&q=${encodeURIComponent(text)}${levelParam}`),
      nauticaGet(`/app/songs?page=${page}&effector=${encodeURIComponent(text)}${levelParam}`),
    ]);

    const seen = new Set<string>();
    const merged: any[] = [];
    for (const song of [...(titleResult.data || []), ...(effectorResult.data || [])]) {
      if (!seen.has(song.id)) {
        seen.add(song.id);
        merged.push(song);
      }
    }

    const titleMeta = titleResult.meta || {};
    const effectorMeta = effectorResult.meta || {};
    send.json({
      data: merged,
      meta: {
        current_page: page,
        last_page: Math.max(titleMeta.last_page || 1, effectorMeta.last_page || 1),
      },
    });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to fetch from Nautica' });
  }
};

// ─── Nomination (any user) ──────────────────────────────────────────────────

export const nauticaNominate = async (data: any, send: WebUISend) => {
  try {
    const username = data.__username;
    if (!username) { send.json({ error: 'Not authenticated' }); return; }

    if (!data.nauticaId || !data.title) {
      send.json({ error: 'Missing required fields' }); return;
    }

    // Validate downloadUrl
    if (!data.downloadUrl || !data.downloadUrl.match(/^https:\/\/[a-z0-9.]*cdn\.digitaloceanspaces\.com\/ksm\.dev\//)) {
      send.json({ error: 'Invalid download URL' }); return;
    }

    const existing = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    if (existing) {
      send.json({ error: 'This chart has already been ' + existing.status, status: existing.status });
      return;
    }

    const note = data.nominationNote ? String(data.nominationNote).substring(0, 500) : undefined;

    const song: any = {
      collection: 'nautica_song',
      nauticaId: data.nauticaId,
      mid: 0,
      title: data.title,
      artist: data.artist || '',
      jacketUrl: data.jacketUrl || '',
      downloadUrl: data.downloadUrl,
      charts: data.charts || [],
      tags: data.tags || [],
      status: 'nominated',
      curatedAt: Date.now(),
      nominatedBy: username,
      nominatedAt: Date.now(),
      nominationNote: note,
    };

    await DB.Insert(song);
    send.json({ success: true, nauticaId: data.nauticaId });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to nominate' });
  }
};

export const nauticaMyNominations = async (data: any, send: WebUISend) => {
  try {
    const username = data.__username;
    if (!username) { send.json({ error: 'Not authenticated' }); return; }

    const songs = await DB.Find<NauticaSong>({ collection: 'nautica_song', nominatedBy: username });
    send.json({ success: true, songs: songs || [] });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to fetch nominations' });
  }
};

// ─── Playtesting Feedback (any user, testing charts only) ───────────────────

export const nauticaSubmitFeedback = async (data: any, send: WebUISend) => {
  try {
    const username = data.__username;
    if (!username) { send.json({ error: 'Not authenticated' }); return; }
    if (!data.nauticaId) { send.json({ error: 'Missing nauticaId' }); return; }

    const song = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    if (!song || song.status !== 'testing') {
      send.json({ error: 'Feedback can only be submitted for charts in testing' }); return;
    }

    if (data.vote !== 'up' && data.vote !== 'down') {
      send.json({ error: 'Vote must be up or down' }); return;
    }

    const comment = data.comment ? String(data.comment).substring(0, 200) : undefined;
    const suggestedLevels = Array.isArray(data.suggestedLevels) ? data.suggestedLevels : undefined;

    await DB.Upsert<NominationFeedback>(
      { collection: 'nomination_feedback', nauticaId: data.nauticaId, username },
      { $set: {
        vote: data.vote,
        comment,
        suggestedLevels,
        updatedAt: Date.now(),
      }}
    );

    // Set createdAt only on first insert
    const existing = await DB.FindOne<NominationFeedback>({ collection: 'nomination_feedback', nauticaId: data.nauticaId, username });
    if (existing && !existing.createdAt) {
      await DB.Update<NominationFeedback>(
        { collection: 'nomination_feedback', nauticaId: data.nauticaId, username },
        { $set: { createdAt: Date.now() } }
      );
    }

    send.json({ success: true });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to submit feedback' });
  }
};

// ─── Admin: Nomination Queue ────────────────────────────────────────────────

export const nauticaNominationQueue = async (data: any, send: WebUISend) => {
  try {
    const allSongs = await DB.Find<NauticaSong>({ collection: 'nautica_song' });
    const nominations = (allSongs || []).filter(
      (s: any) => s.status === 'nominated' || s.status === 'testing'
    );

    // Aggregate feedback for each nomination
    const allFeedback = await DB.Find<NominationFeedback>({ collection: 'nomination_feedback' });
    const feedbackByNauticaId: Record<string, NominationFeedback[]> = {};
    for (const fb of (allFeedback || [])) {
      if (!feedbackByNauticaId[fb.nauticaId]) feedbackByNauticaId[fb.nauticaId] = [];
      feedbackByNauticaId[fb.nauticaId].push(fb);
    }

    const result = nominations.map((s: any) => {
      const fb = feedbackByNauticaId[s.nauticaId] || [];
      return {
        ...s,
        feedback: {
          up: fb.filter((f: any) => f.vote === 'up').length,
          down: fb.filter((f: any) => f.vote === 'down').length,
          comments: fb.filter((f: any) => f.comment).map((f: any) => ({
            username: f.username,
            vote: f.vote,
            comment: f.comment,
            suggestedLevels: f.suggestedLevels,
          })),
        },
      };
    });

    send.json({ success: true, nominations: result });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to fetch nominations' });
  }
};

export const nauticaGetFeedback = async (data: { nauticaId: string }, send: WebUISend) => {
  try {
    const feedback = await DB.Find<NominationFeedback>({ collection: 'nomination_feedback', nauticaId: data.nauticaId });
    send.json({ success: true, feedback: feedback || [] });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to fetch feedback' });
  }
};

// ─── Admin: Set Testing ─────────────────────────────────────────────────────

export const nauticaSetTesting = async (data: any, send: WebUISend) => {
  try {
    const song = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    if (!song) { send.json({ error: 'Song not found' }); return; }
    if (song.status !== 'nominated') {
      send.json({ error: 'Only nominated charts can be moved to testing' }); return;
    }

    await DB.Update<NauticaSong>(
      { collection: 'nautica_song', nauticaId: data.nauticaId },
      { $set: { status: 'testing' as const } }
    );

    // On staging servers, auto-convert for playtesting
    const mode = U.GetConfig('sdvx_nomination_mode') || 'production';
    if (mode === 'staging' && song.mid === 0) {
      convertNauticaSong(song).catch((err) => {
        console.error(`[Nautica] Staging conversion failed for ${song.title}: ${err.message}`);
      });
    }

    send.json({ success: true });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to set testing' });
  }
};

// ─── Admin: Reject ──────────────────────────────────────────────────────────

export const nauticaReject = async (data: any, send: WebUISend) => {
  try {
    const song = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    if (!song) { send.json({ error: 'Song not found' }); return; }

    const reason = data.reason ? String(data.reason).substring(0, 500) : 'No reason given';
    const rejectedBy = data.__username || 'admin';

    await DB.Update<NauticaSong>(
      { collection: 'nautica_song', nauticaId: data.nauticaId },
      { $set: {
        status: 'rejected' as const,
        rejectedReason: reason,
        rejectedBy,
        rejectedAt: Date.now(),
      }}
    );

    send.json({ success: true });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to reject' });
  }
};

// ─── Admin: Approve (modified to handle nominations) ────────────────────────

export const nauticaApprove = async (data: any, send: WebUISend) => {
  try {
    // Validate downloadUrl
    if (!data.downloadUrl || !data.downloadUrl.match(/^https:\/\/[a-z0-9.]*cdn\.digitaloceanspaces\.com\/ksm\.dev\//)) {
      send.json({ error: 'Invalid download URL: must be from ksm.dev CDN' });
      return;
    }

    const existing = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });

    // Approving an existing nomination
    if (existing && (existing.status === 'nominated' || existing.status === 'testing')) {
      await DB.Update<NauticaSong>(
        { collection: 'nautica_song', nauticaId: data.nauticaId },
        { $set: {
          status: 'pending' as const,
          curatedBy: data.__username || 'admin',
          curatedAt: Date.now(),
        }}
      );

      const song = { ...existing, status: 'pending' as const };
      convertNauticaSong(song as any).catch((err) => {
        console.error(`[Nautica] Conversion failed for ${song.title}: ${err.message}`);
      });

      send.json({ success: true, title: existing.title });
      return;
    }

    // Direct approval (existing flow from admin browse)
    if (existing) {
      send.json({ error: 'Song already exists', mid: existing.mid, status: existing.status });
      return;
    }

    const song: any = {
      collection: 'nautica_song',
      nauticaId: data.nauticaId,
      mid: 0,
      title: data.title,
      artist: data.artist,
      jacketUrl: data.jacketUrl,
      downloadUrl: data.downloadUrl,
      charts: data.charts,
      tags: data.tags || [],
      status: 'pending',
      curatedBy: data.__username || 'admin',
      curatedAt: Date.now(),
    };

    await DB.Insert(song);

    convertNauticaSong(song).catch((err) => {
      console.error(`[Nautica] Conversion failed for ${song.title}: ${err.message}`);
    });

    send.json({ success: true, title: data.title });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to approve song' });
  }
};

// ─── List + Remove + Status (existing) ──────────────────────────────────────

export const nauticaList = async (data: any, send: WebUISend) => {
  try {
    let query: any = { collection: 'nautica_song' };
    if (data.status) query.status = data.status;
    const songs = await DB.Find<NauticaSong>(query);
    send.json({ success: true, songs: songs || [] });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to list curated songs' });
  }
};

export const nauticaDeletedList = async (data: any, send: WebUISend) => {
  try {
    const deleted = await DB.Find<DeletedNauticaSong>({ collection: 'deleted_nautica_song' });
    const rejected = await DB.Find<NauticaSong>({ collection: 'nautica_song', status: 'rejected' });

    const deletedItems = (deleted || []).map((r: any) => ({
      nauticaId: r.nauticaId,
      title: r.title,
      artist: r.artist,
      jacketUrl: r.jacketUrl,
      mid: r.mid || 0,
      previousStatus: r.previousStatus || '',
      deletedReason: r.deletedReason || '',
      deletedBy: r.deletedBy || '',
      deletedAt: r.deletedAt || 0,
      source: 'deleted',
    }));

    const rejectedItems = (rejected || []).map((r: any) => ({
      nauticaId: r.nauticaId,
      title: r.title,
      artist: r.artist,
      jacketUrl: r.jacketUrl,
      mid: r.mid || 0,
      previousStatus: 'rejected',
      deletedReason: r.rejectedReason || 'No reason given',
      deletedBy: r.rejectedBy || '',
      deletedAt: r.rejectedAt || 0,
      source: 'rejected',
    }));

    const all = [...deletedItems, ...rejectedItems];
    all.sort((a: any, b: any) => (b.deletedAt || 0) - (a.deletedAt || 0));
    send.json({ success: true, deleted: all });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to list deleted charts' });
  }
};

export const nauticaRemove = async (data: { nauticaId: string; reason?: string; __username?: string }, send: WebUISend) => {
  try {
    const reason = data.reason ? String(data.reason).trim().substring(0, 500) : '';
    if (!reason) { send.json({ error: 'A deletion reason is required' }); return; }

    const song = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    if (!song) { send.json({ error: 'Song not found' }); return; }

    const auditRecord: DeletedNauticaSong = {
      collection: 'deleted_nautica_song',
      nauticaId: song.nauticaId,
      title: song.title || '',
      artist: song.artist || '',
      jacketUrl: song.jacketUrl || '',
      mid: song.mid || 0,
      previousStatus: song.status,
      deletedReason: reason,
      deletedBy: data.__username || 'admin',
      deletedAt: Date.now(),
    };
    await DB.Upsert<DeletedNauticaSong>(
      { collection: 'deleted_nautica_song', nauticaId: song.nauticaId },
      { $set: auditRecord }
    );

    if (song.driveFileId) {
      deleteDriveFile(song.driveFileId).catch((err: any) => {
        console.error(`[Nautica] Drive delete failed for ${song.title}: ${err.message}`);
      });
    }

    await DB.Remove<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    await DB.Remove<NominationFeedback>({ collection: 'nomination_feedback', nauticaId: data.nauticaId });

    if (song.mid > 0) {
      // Delete all player scores for this music ID so it can be reused
      await DB.Remove<MusicRecord>(null, { collection: 'music', mid: song.mid });

      removeFromCustomMusicDb(song.mid);

      const gameRoot = U.GetConfig('sdvx_eg_root_dir');
      const mixName = U.GetConfig('sdvx_custom_mix_name') || 'asphyxia_custom';
      if (gameRoot) {
        removeFromMergedXml(song.mid, gameRoot, mixName);

        const idStr = String(song.mid).padStart(4, '0');
        const musicDir = path.join(gameRoot, 'data_mods', mixName, 'music', `${idStr}_nautica`);
        if (fs.existsSync(musicDir)) {
          fs.rmSync(musicDir, { recursive: true, force: true });
        }
        const thumbDir = path.join(gameRoot, 'data_mods', mixName, 'graphics', 's_jacket00_ifs');
        const thumbPath = path.join(thumbDir, `jk_${idStr}_0_t.png`);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }

      invalidateMusicDbCache();
    }

    send.json({ success: true });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to remove song' });
  }
};

export const nauticaReconvert = async (data: { nauticaId: string }, send: WebUISend) => {
  try {
    if (!data.nauticaId) { send.json({ error: 'Missing nauticaId' }); return; }

    const song = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    if (!song) { send.json({ error: 'Song not found' }); return; }
    if (!song.mid || song.mid === 0) {
      send.json({ error: 'Chart has not been converted yet' });
      return;
    }
    if (song.status === 'nominated' || song.status === 'testing' || song.status === 'rejected') {
      send.json({ error: `Cannot reconvert a ${song.status} chart` });
      return;
    }

    await DB.Update<NauticaSong>(
      { collection: 'nautica_song', nauticaId: data.nauticaId },
      { $set: { status: 'pending' as const, errorMessage: '' } }
    );
    convertNauticaSong(song as any).catch((err) => {
      console.error(`[Nautica] Reconversion failed for ${song.title}: ${err.message}`);
    });

    send.json({ success: true });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to queue reconversion' });
  }
};

export const nauticaReconvertAll = async (data: any, send: WebUISend) => {
  try {
    const allSongs = await DB.Find<NauticaSong>({ collection: 'nautica_song' });
    // Include ready, error, and orphaned pending/converting charts. The conversion
    // queue is in-memory, so a server restart or crash mid-convert leaves DB rows
    // stuck on 'pending' or 'converting' with no runner behind them. Reconvert
    // should sweep those up too.
    const toReconvert = (allSongs || []).filter(
      (s: any) =>
        s.mid && s.mid > 0 &&
        (s.status === 'ready' ||
          s.status === 'error' ||
          s.status === 'pending' ||
          s.status === 'converting')
    );

    for (const song of toReconvert) {
      await DB.Update<NauticaSong>(
        { collection: 'nautica_song', nauticaId: song.nauticaId },
        { $set: { status: 'pending' as const, errorMessage: '' } }
      );
      convertNauticaSong(song as any).catch((err) => {
        console.error(`[Nautica] Reconversion failed for ${song.title}: ${err.message}`);
      });
    }

    send.json({ success: true, count: toReconvert.length });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to queue reconversion' });
  }
};

export const nauticaConvertStatus = async (data: { nauticaId: string }, send: WebUISend) => {
  try {
    const song = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', nauticaId: data.nauticaId });
    if (!song) { send.json({ error: 'Song not found' }); return; }
    send.json({ success: true, status: song.status, errorMessage: song.errorMessage });
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to get status' });
  }
};

export const nauticaDownloadSong = async (data: { mid: number }, send: WebUISend) => {
  try {
    const song = await DB.FindOne<NauticaSong>({ collection: 'nautica_song', mid: data.mid });
    if (!song || song.status !== 'ready') {
      send.json({ error: 'Song not available for download' }); return;
    }

    const gameRoot = U.GetConfig('sdvx_eg_root_dir');
    const mixName = U.GetConfig('sdvx_custom_mix_name') || 'asphyxia_custom';
    if (!gameRoot) { send.json({ error: 'Game directory not configured' }); return; }

    const modBase = path.join(gameRoot, 'data_mods', mixName);
    const idStr = String(song.mid).padStart(4, '0');
    const musicBase = path.join(modBase, 'music');
    if (!fs.existsSync(musicBase)) { send.json({ error: 'No converted files found' }); return; }

    const songFolder = fs.readdirSync(musicBase).find(d => d.startsWith(idStr + '_'));
    if (!songFolder) { send.json({ error: 'Converted song folder not found' }); return; }

    const zipBuffer = await createSongZip(modBase, mixName, songFolder, idStr);
    send.buffer(zipBuffer);
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to create download' });
  }
};

export const nauticaDownloadAll = async (data: any, send: WebUISend) => {
  try {
    const gameRoot = U.GetConfig('sdvx_eg_root_dir');
    const mixName = U.GetConfig('sdvx_custom_mix_name') || 'asphyxia_custom';
    if (!gameRoot) { send.json({ error: 'Game directory not configured' }); return; }

    const modBase = path.join(gameRoot, 'data_mods', mixName);
    if (!fs.existsSync(modBase)) { send.json({ error: 'No custom charts folder found' }); return; }

    const zipBuffer = await createFullMixZip(modBase, mixName);
    send.buffer(zipBuffer);
  } catch (err: any) {
    send.json({ error: err.message || 'Failed to create download' });
  }
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function createSongZip(modBase: string, mixName: string, songFolder: string, idStr: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 5 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    const prefix = `data_mods/${mixName}`;
    const musicDir = path.join(modBase, 'music', songFolder);
    if (fs.existsSync(musicDir)) archive.directory(musicDir, `${prefix}/music/${songFolder}`);
    const thumbDir = path.join(modBase, 'graphics', 's_jacket00_ifs');
    if (fs.existsSync(thumbDir)) {
      for (const t of fs.readdirSync(thumbDir).filter(f => f.startsWith(`jk_${idStr}_`))) {
        archive.file(path.join(thumbDir, t), { name: `${prefix}/graphics/s_jacket00_ifs/${t}` });
      }
    }
    const xmlPath = path.join(modBase, 'others', 'music_db.merged.xml');
    if (fs.existsSync(xmlPath)) archive.file(xmlPath, { name: `${prefix}/others/music_db.merged.xml` });
    archive.finalize();
  });
}

function createFullMixZip(modBase: string, mixName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 5 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.directory(modBase, `data_mods/${mixName}`);
    archive.finalize();
  });
}

function removeFromCustomMusicDb(musicId: number) {
  try {
    const customDbPath = IO.Resolve('webui/asset/json/custom_music_db.json');
    if (!fs.existsSync(customDbPath)) return;
    const data = JSON.parse(fs.readFileSync(customDbPath, 'utf8'));
    if (!data?.mdb?.music) return;
    data.mdb.music = data.mdb.music.filter((s: any) => String(s.id) !== String(musicId));
    fs.writeFileSync(customDbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

function removeFromMergedXml(musicId: number, gameRoot: string, mixName: string) {
  try {
    const xmlPath = path.join(gameRoot, 'data_mods', mixName, 'others', 'music_db.merged.xml');
    if (!fs.existsSync(xmlPath)) return;
    let xml = fs.readFileSync(xmlPath, 'binary');
    const pattern = new RegExp(`\\s*<music id="${musicId}">[\\s\\S]*?</music>`, 'g');
    const updated = xml.replace(pattern, '');
    if (updated !== xml) {
      fs.writeFileSync(xmlPath, updated, 'binary');
    }
  } catch {}
}
