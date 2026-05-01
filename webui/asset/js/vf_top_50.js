/* VF Top 50 page — computes the top-50 volforce chart entries for the current
 * profile version and renders them into a Tachi-style grid. The same DOM node
 * is then rasterized client-side with html2canvas to produce a downloadable
 * PNG, so no server-side headless browser is needed. */

var vfProfileData;
var vfScoreDb;
var vfMusicDb;
var vfCurrentVersion;

var VF_VERSION_NAMES = {
  6: 'EXCEED GEAR',
  7: '∇ (NABLA)',
};

function vfFmtNumber(n, digits) {
  var s = n.toFixed(digits);
  return s;
}

function vfPadScore(n) {
  var s = String(Math.max(0, Math.floor(n)));
  while (s.length < 8) s = '0' + s;
  return s;
}

function vfSplitScoreHead(padded) {
  // Find the first non-zero digit so we can dim the leading zeros.
  for (var i = 0; i < padded.length; i++) {
    if (padded[i] !== '0') {
      return {head: padded.slice(0, i), tail: padded.slice(i)};
    }
  }
  return {head: padded.slice(0, padded.length - 1), tail: padded.slice(-1)};
}

// --- Grade / clear / difficulty lookups (mirror of detail.js) ------------

function vfGradeAttr(grade) {
  switch (grade) {
    case 1: return 0.80;
    case 2: return 0.82;
    case 3: return 0.85;
    case 4: return 0.88;
    case 5: return 0.91;
    case 6: return 0.94;
    case 7: return 0.97;
    case 8: return 1.00;
    case 9: return 1.02;
    case 10: return 1.05;
    default: return 0;
  }
}

function vfMedalAttr(clear, version) {
  switch (clear) {
    case 0: return 0;
    case 1: return 0.5;
    case 2: return 1.0;
    case 3: return 1.02;
    case 4: return version === 6 ? 1.05 : 1.04;
    case 5: return version === 6 ? 1.10 : 1.06;
    case 6: return version === 6 ? 1.04 : 1.10;
    default: return 0;
  }
}

// Tachi-style short clear labels (v7/Nabla lamp order differs from v6/EG)
function vfClearLabel(clear, version) {
  if (version === 7) {
    switch (clear) {
      case 1: return 'PLAY';
      case 2: return 'CLR';
      case 3: return 'EXC';
      case 4: return 'MXV';
      case 5: return 'UC';
      case 6: return 'PUC';
    }
  } else {
    switch (clear) {
      case 1: return 'FAIL';
      case 2: return 'CLR';
      case 3: return 'EXC';
      case 4: return 'UC';
      case 5: return 'PUC';
      case 6: return 'MXV';
    }
  }
  return '-';
}

function vfClearBadgeClass(label) {
  return 'vf-clear-badge vf-clear-' + (label === '-' ? 'FAIL' : label.replace(/[^A-Z]/g, ''));
}

function vfGetSongEntry(mid) {
  if (!vfMusicDb || !vfMusicDb.mdb || !vfMusicDb.mdb.music) return null;
  for (var i = 0; i < vfMusicDb.mdb.music.length; i++) {
    if (parseInt(vfMusicDb.mdb.music[i].id) === mid) return vfMusicDb.mdb.music[i];
  }
  return null;
}

function vfGetDifficulty(mid, type) {
  var song = vfGetSongEntry(mid);
  var infVer = song && song.info && song.info.inf_ver ? String(song.info.inf_ver) : '5';
  switch (type) {
    case 0: return 'NOV';
    case 1: return 'ADV';
    case 2: return 'EXH';
    case 3:
      switch (infVer) {
        case '2': return 'INF';
        case '3': return 'GRV';
        case '4': return 'HVN';
        case '5': return 'VVD';
        case '6': return 'XCD';
        default:  return 'INF';
      }
    case 4: return 'MXM';
    case 5: return 'ULT';
  }
  return '-';
}

function vfGetLevel(mid, type) {
  var song = vfGetSongEntry(mid);
  if (!song || !song.difficulty) return 0;
  var key = ['novice', 'advanced', 'exhaust', 'infinite', 'maximum', 'ultimate'][type];
  var raw = song.difficulty[key];
  var n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

function vfSingleScoreVolforce(sc) {
  // For v7 scores the engine now stores the authoritative volforce on the
  // record; fall back to the classic formula when it's missing.
  if (vfCurrentVersion === 7 && typeof sc.volforce === 'number') return sc.volforce;
  var level = vfGetLevel(sc.mid, sc.type);
  return level * (sc.score / 10000000) * vfGradeAttr(sc.grade) * vfMedalAttr(sc.clear, vfCurrentVersion) * 2;
}

// ------------------------------------------------------------------------

function vfSongTitle(mid) {
  var song = vfGetSongEntry(mid);
  return song && song.info && song.info.title_name ? song.info.title_name : ('#' + mid);
}

function vfBuildTop50() {
  var filtered = (vfScoreDb || []).filter(function (s) { return s.version === vfCurrentVersion; });
  var rows = filtered.map(function (sc) {
    var vfRaw = vfSingleScoreVolforce(sc);
    // Display VF is divided by 1000 (v7) or 100 (v6) to match the in-game
    // convention; keep three decimals.
    var vfDisplay = vfRaw / (vfCurrentVersion === 7 ? 1000 : 100);
    return {
      mid: sc.mid,
      type: sc.type,
      score: sc.score,
      exscore: sc.exscore,
      grade: sc.grade,
      clear: sc.clear,
      vfRaw: vfRaw,
      vfDisplay: vfDisplay,
      diffName: vfGetDifficulty(sc.mid, sc.type),
      level: vfGetLevel(sc.mid, sc.type),
      title: vfSongTitle(sc.mid),
      clearLabel: vfClearLabel(sc.clear, vfCurrentVersion),
    };
  });
  rows.sort(function (a, b) { return b.vfRaw - a.vfRaw; });
  return rows.slice(0, 50);
}

function vfTotalVF(top50) {
  var total = 0;
  for (var i = 0; i < top50.length; i++) total += top50[i].vfRaw;
  return total / (vfCurrentVersion === 7 ? 1000 : 100);
}

function vfFormatDate() {
  var d = new Date();
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

// Ordered low→high. emblem index matches em6_NN_i_eab.png in static/asset/force/.
var VF_CLASSES = [
  { name: 'SIENNA',    threshold:  0.0, gate: 2.5,  emblem:  1 },
  { name: 'COBALT',    threshold: 10.0, gate: 0.5,  emblem:  2 },
  { name: 'DANDELION', threshold: 12.0, gate: 0.5,  emblem:  3 },
  { name: 'CYAN',      threshold: 14.0, gate: 0.25, emblem:  4 },
  { name: 'SCARLET',   threshold: 15.0, gate: 0.25, emblem:  5 },
  { name: 'CORAL',     threshold: 16.0, gate: 0.25, emblem:  6 },
  { name: 'ARGENTO',   threshold: 17.0, gate: 0.25, emblem:  7 },
  { name: 'ELDORA',    threshold: 18.0, gate: 0.25, emblem:  8 },
  { name: 'CRIMSON',   threshold: 19.0, gate: 0.25, emblem:  9 },
  { name: 'IMPERIAL',  threshold: 20.0, gate: 1.0,  emblem: 10 },
];
var VF_GATE_ROMAN = ['I', 'II', 'III', 'IV'];

function vfGetClass(vfTotal) {
  var cls = VF_CLASSES[0];
  for (var i = 0; i < VF_CLASSES.length; i++) {
    if (vfTotal >= VF_CLASSES[i].threshold) cls = VF_CLASSES[i];
    else break;
  }
  var gateIdx = Math.min(Math.floor((vfTotal - cls.threshold) / cls.gate), 3);
  if (gateIdx < 0) gateIdx = 0;
  return {
    name: cls.name,
    gate: VF_GATE_ROMAN[gateIdx],
    emblemUrl: 'static/asset/force/em6_' + (cls.emblem < 10 ? '0' : '') + cls.emblem + '_i_eab.png',
  };
}

function vfRenderHeader(top50) {
  var prof = (vfProfileData || []).find(function (p) { return p.version === vfCurrentVersion; })
           || (vfProfileData && vfProfileData[0]) || {};
  var playerName = (prof.name || 'PLAYER').toString();
  var vfTotal = vfTotalVF(top50);
  var cls = vfGetClass(vfTotal);

  document.getElementById('vf_header_playername').textContent = playerName;
  document.getElementById('vf_header_total_vf').textContent = vfFmtNumber(vfTotal, 3) + ' VF — ' + (VF_VERSION_NAMES[vfCurrentVersion] || ('v' + vfCurrentVersion));
  document.getElementById('vf_header_class_name').textContent = cls.name + ' ' + cls.gate;
  var emblem = document.getElementById('vf_header_class_emblem');
  emblem.src = cls.emblemUrl;
  emblem.alt = cls.name + ' ' + cls.gate;
  document.getElementById('vf_header_date').textContent = vfFormatDate();
}

function vfRenderGrid(top50) {
  var grid = document.getElementById('vf_grid');
  grid.innerHTML = '';

  if (top50.length === 0) {
    var empty = document.createElement('div');
    empty.style.gridColumn = '1 / span 3';
    empty.style.textAlign = 'center';
    empty.style.padding = '40px 0';
    empty.style.color = '#7fbf7f';
    empty.textContent = 'No scores yet for this version.';
    grid.appendChild(empty);
    return;
  }

  for (var i = 0; i < top50.length; i++) {
    var r = top50[i];
    var rank = String(i + 1).padStart(2, '0');
    var scoreSplit = vfSplitScoreHead(vfPadScore(r.score));

    var entry = document.createElement('div');
    entry.className = 'vf-entry';

    var jacket = document.createElement('div');
    jacket.className = 'vf-entry-jacket';
    var img = document.createElement('img');
    img.alt = '';
    // crossOrigin lets html2canvas rasterize it even though we're on a
    // same-origin endpoint; harmless either way.
    img.crossOrigin = 'anonymous';
    // Pass the chart's `type` so the route can pick the matching
    // per-difficulty jacket (NOV/ADV/EXH/INF/MXM each have their own art
    // in s_jacket*_ifs/tex/jk_<padded>_<typeIdx>_t.png).
    img.src = '/api/sdvx/jacket/' + r.mid + '.png?type=' + (r.type != null ? r.type : '');
    img.onerror = (function (el) {
      return function () {
        el.innerHTML = '<span class="vf-nojk">no jacket</span>';
      };
    })(jacket);
    jacket.appendChild(img);

    var info = document.createElement('div');
    info.className = 'vf-entry-info';
    var title = document.createElement('div');
    title.className = 'vf-entry-title';
    title.textContent = r.title;
    title.title = r.title;
    var badges = document.createElement('div');
    badges.className = 'vf-entry-badges';
    var diff = document.createElement('span');
    diff.className = 'vf-diff-badge vf-diff-' + r.diffName.toLowerCase();
    diff.textContent = r.diffName + ' ' + (r.level || '?');
    var clear = document.createElement('span');
    clear.className = vfClearBadgeClass(r.clearLabel);
    clear.textContent = r.clearLabel;
    badges.appendChild(diff);
    badges.appendChild(clear);
    info.appendChild(title);
    info.appendChild(badges);

    var vfVal = document.createElement('div');
    vfVal.className = 'vf-entry-vf';
    vfVal.textContent = vfFmtNumber(r.vfDisplay, 3);

    var score = document.createElement('div');
    score.className = 'vf-entry-score';
    score.innerHTML =
      '<span class="vf-score-head">' + scoreSplit.head + '</span>' +
      '<span class="vf-score-tail">' + scoreSplit.tail + '</span>';

    var rankEl = document.createElement('div');
    rankEl.className = 'vf-entry-rank';
    rankEl.textContent = rank;

    entry.appendChild(jacket);
    entry.appendChild(info);
    entry.appendChild(vfVal);
    entry.appendChild(score);
    entry.appendChild(rankEl);
    grid.appendChild(entry);
  }
}

function vfPopulateVersionSelector() {
  var sel = document.getElementById('vf_version_select');
  sel.innerHTML = '';
  var versionsInData = {};
  (vfProfileData || []).forEach(function (p) { if (p.version) versionsInData[p.version] = true; });
  (vfScoreDb || []).forEach(function (s) { if (s.version) versionsInData[s.version] = true; });
  var versions = Object.keys(versionsInData).map(Number).sort(function (a, b) { return a - b; });
  if (versions.length === 0) versions = [7];

  versions.forEach(function (v) {
    var opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = VF_VERSION_NAMES[v] || ('Version ' + v);
    if (v === vfCurrentVersion) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.onchange = function () {
    vfCurrentVersion = parseInt(sel.value);
    vfRefresh();
  };
}

function vfRefresh() {
  var top50 = vfBuildTop50();
  vfRenderHeader(top50);
  vfRenderGrid(top50);
}

function vfShowStatus(msg, kind) {
  var el = document.getElementById('vf_status');
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.className = 'notification is-' + (kind || 'light');
  el.textContent = msg;
}

function vfWaitForImages(root) {
  var imgs = root.querySelectorAll('img');
  var pending = [];
  imgs.forEach(function (img) {
    if (img.complete) return;
    pending.push(new Promise(function (resolve) {
      // We resolve on both load and error so a missing jacket doesn't block
      // the screenshot forever.
      img.onload = img.onerror = function () { resolve(); };
    }));
  });
  return Promise.all(pending);
}

function vfDownloadPNG() {
  var root = document.getElementById('vf_top50_canvas_root');
  var btn = document.getElementById('vf_download_btn');
  btn.classList.add('is-loading');
  vfShowStatus('Rendering image…', 'info');

  // Wait for both images AND web fonts. html2canvas rasterizes with whatever
  // fonts are loaded at the moment of capture; without this wait the first
  // PNG often falls back to the generic sans-serif and the subsequent retry
  // picks up Rajdhani/Share Tech Mono once the browser has cached them.
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all([vfWaitForImages(root), fontsReady]).then(function () {
    return html2canvas(root, {
      backgroundColor: '#14171c',
      scale: 2,
      useCORS: true,
      logging: false,
    });
  }).then(function (canvas) {
    var name = (document.getElementById('vf_header_playername').textContent || 'player').replace(/[^A-Za-z0-9_-]+/g, '_');
    var link = document.createElement('a');
    link.download = 'vf_top50_' + name + '_v' + vfCurrentVersion + '.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    btn.classList.remove('is-loading');
    vfShowStatus('');
  }).catch(function (err) {
    btn.classList.remove('is-loading');
    vfShowStatus('Failed to render PNG: ' + (err && err.message ? err.message : err), 'danger');
  });
}

$(function () {
  try {
    vfProfileData = JSON.parse(document.getElementById('vf-profile-pass').innerText);
    vfScoreDb = JSON.parse(document.getElementById('vf-score-pass').innerText);
  } catch (e) {
    vfShowStatus('Failed to load profile data: ' + e.message, 'danger');
    return;
  }

  vfProfileData = (vfProfileData || []).sort(function (a, b) { return a.version - b.version; });

  // Default to the latest version we have either a profile or any score for.
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('version') && urlParams.get('version') !== '') {
    vfCurrentVersion = parseInt(urlParams.get('version'));
  } else {
    var versions = {};
    vfProfileData.forEach(function (p) { if (p.version) versions[p.version] = true; });
    (vfScoreDb || []).forEach(function (s) { if (s.version) versions[s.version] = true; });
    var list = Object.keys(versions).map(Number).sort(function (a, b) { return a - b; });
    vfCurrentVersion = list.length > 0 ? list[list.length - 1] : 7;
  }

  $.getJSON('static/asset/json/music_db.json').done(function (json) {
    vfMusicDb = json;

    // Also merge custom charts if present — matches detail.js behavior.
    $.getJSON('static/asset/json/custom_music_db.json').done(function (custom) {
      if (custom && custom.mdb && custom.mdb.music) {
        vfMusicDb.mdb.music = vfMusicDb.mdb.music.concat(custom.mdb.music);
      }
    }).always(function () {
      vfPopulateVersionSelector();
      vfRefresh();
    });
  }).fail(function () {
    vfShowStatus('Failed to load music database.', 'danger');
  });

  document.getElementById('vf_download_btn').addEventListener('click', vfDownloadPNG);
});
