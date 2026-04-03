// Shared Tachi utilities used by both Import and Export tabs
window.Tachi = (function() {
  var music_db = null;
  var music_db_loaded = false;
  var music_db_error = false;

  // Load music_db - use fetch as fallback if jQuery isn't available yet
  if (typeof $ !== 'undefined' && $.getJSON) {
    $.getJSON("static/asset/json/music_db.json")
      .done(function(json) {
        music_db = json;
        music_db_loaded = true;
        console.log('music_db loaded, entries:', music_db["mdb"]["music"].length);
      })
      .fail(function(jqxhr, textStatus, error) {
        music_db_error = true;
        console.error('Failed to load music_db.json:', textStatus, error);
      });
  } else {
    fetch("static/asset/json/music_db.json")
      .then(function(r) { return r.json(); })
      .then(function(json) {
        music_db = json;
        music_db_loaded = true;
        console.log('music_db loaded, entries:', music_db["mdb"]["music"].length);
      })
      .catch(function(err) {
        music_db_error = true;
        console.error('Failed to load music_db.json:', err);
      });
  }

  // Clear type to Tachi lamp mapping
  // SDVX EG (version 6): 0=none, 1=played, 2=clear, 3=excessive, 4=uc, 5=puc, 6=mxv
  // SDVX Nabla (version 7+): 0=none, 1=played, 2=clear, 3=excessive, 4=mxv, 5=uc, 6=puc
  var CLEAR_TO_LAMP_EG = {
    1: 'FAILED', 2: 'CLEAR', 3: 'EXCESSIVE CLEAR',
    4: 'ULTIMATE CHAIN', 5: 'PERFECT ULTIMATE CHAIN', 6: 'MAXXIVE CLEAR'
  };
  var CLEAR_TO_LAMP_NABLA = {
    1: 'FAILED', 2: 'CLEAR', 3: 'EXCESSIVE CLEAR',
    4: 'MAXXIVE CLEAR', 5: 'ULTIMATE CHAIN', 6: 'PERFECT ULTIMATE CHAIN'
  };
  var CLEAR_NAMES_EG = { 1: 'FAILED', 2: 'CLEAR', 3: 'EXC', 4: 'UC', 5: 'PUC', 6: 'MXV' };
  var CLEAR_NAMES_NABLA = { 1: 'FAILED', 2: 'CLEAR', 3: 'EXC', 4: 'MXV', 5: 'UC', 6: 'PUC' };

  function getSongName(musicid) {
    if (!music_db) return "(DB not loaded)";
    var result = music_db["mdb"]["music"].filter(function(obj) { return obj["id"] == musicid; });
    if (result.length == 0) return "Custom Song";
    return result[0]["info"]["title_name"];
  }

  function getDifficulty(musicid, type) {
    if (type === 0) return 'NOV';
    if (type === 1) return 'ADV';
    if (type === 2) return 'EXH';
    if (type === 4) return 'MXM';
    if (type === 5) return 'ULT';
    if (type === 3) {
      if (!music_db) return 'MXM';
      var result = music_db["mdb"]["music"].filter(function(obj) { return obj["id"] == musicid; });
      if (result.length == 0) return 'MXM';
      var inf_ver = String(result[0]["info"]["inf_ver"] || "0");
      switch (inf_ver) {
        case "2": return "INF";
        case "3": return "GRV";
        case "4": return "HVN";
        case "5": return "VVD";
        case "6": return "XCD";
        case "0": default: return "MXM";
      }
    }
    return null;
  }

  function getDiffLevel(musicid, type) {
    if (!music_db) return 0;
    var result = music_db["mdb"]["music"].filter(function(obj) { return obj["id"] == musicid; });
    if (result.length == 0) return 0;
    var d = result[0]["difficulty"];
    if (type === 0) return parseInt(d["novice"]) || 0;
    if (type === 1) return parseInt(d["advanced"]) || 0;
    if (type === 2) return parseInt(d["exhaust"]) || 0;
    if (type === 3) return parseInt(d["infinite"]) || 0;
    if (type === 4) return parseInt(d["maximum"] || d["infinite"]) || 0;
    return 0;
  }

  function computeVF(score, level, clear, version) {
    var clearFactorsEG = { 1: 0.5, 2: 1.0, 3: 1.02, 6: 1.05, 4: 1.05, 5: 1.10 };
    var clearFactorsNabla = { 1: 0.5, 2: 1.0, 3: 1.02, 4: 1.04, 5: 1.06, 6: 1.10 };
    var factors = version === 7 ? clearFactorsNabla : clearFactorsEG;
    var cf = factors[clear] || 0.5;
    var gf = 1.0;
    if (score >= 9900000) gf = 1.05;
    else if (score >= 9800000) gf = 1.02;
    else if (score >= 9700000) gf = 1.0;
    else if (score >= 9500000) gf = 0.97;
    else if (score >= 9300000) gf = 0.94;
    else if (score >= 9000000) gf = 0.91;
    else if (score >= 8700000) gf = 0.88;
    else gf = 0.85;
    return (score / 10000000) * level * cf * gf;
  }

  function parseTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') { var d = new Date(ts).getTime(); return isNaN(d) ? null : d; }
    if (ts.$$date != null) return ts.$$date;
    if (ts instanceof Date || (typeof ts === 'object' && ts.getTime)) { var d = ts.getTime(); return isNaN(d) ? null : d; }
    return null;
  }

  function renderPBTable(scores) {
    var html = '<div style="max-height:500px;overflow:auto;">';
    html += '<table class="table is-narrow is-fullwidth is-striped" style="font-size:0.8em;">';
    html += '<thead><tr><th>#</th><th>Song</th><th>Diff</th><th>Score</th><th>Lamp</th></tr></thead><tbody>';
    for (var i = 0; i < scores.length; i++) {
      var s = scores[i];
      html += '<tr><td>' + (i + 1) + '</td><td>' + s.name + '</td><td>' + s.diff + ' ' + s.level + '</td><td>' + s.score.toLocaleString() + '</td><td>' + s.lamp + '</td></tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  function buildTachiScores(since) {
    var scoresRaw = JSON.parse(document.getElementById('data-pass-scores').textContent);
    var versionCounts = {};
    var skippedCount = 0;
    for (var i = 0; i < scoresRaw.length; i++) {
      var v = scoresRaw[i].version;
      versionCounts[v] = (versionCounts[v] || 0) + 1;
    }
    var tachiScores = [];
    for (var i = 0; i < scoresRaw.length; i++) {
      var s = scoresRaw[i];
      if (s.version !== 6 && s.version !== 7) continue;
      var lampMap = s.version === 7 ? CLEAR_TO_LAMP_NABLA : CLEAR_TO_LAMP_EG;
      var lamp = lampMap[s.clear];
      if (!lamp) continue;
      var diff = getDifficulty(s.mid, s.type);
      if (!diff) continue;
      var timeAchieved = parseTimestamp(s.updatedAt || s.createdAt);
      if (since && timeAchieved && timeAchieved <= since) {
        skippedCount++;
        continue;
      }
      tachiScores.push({
        score: s.score, lamp: lamp, matchType: 'sdvxInGameID',
        identifier: String(s.mid), difficulty: diff, timeAchieved: timeAchieved,
        _songName: getSongName(s.mid)
      });
    }
    return { tachiScores: tachiScores, totalRaw: scoresRaw.length, versionCounts: versionCounts, skippedCount: skippedCount };
  }

  function initTachiConfig(notAuthorizedEl) {
    var clientId = '';
    fetch('/tachi/config')
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        clientId = cfg.clientId || '';
        if (!clientId && notAuthorizedEl) {
          notAuthorizedEl.style.display = '';
          notAuthorizedEl.innerHTML =
            '<div class="notification is-warning is-light">Tachi Client ID is not configured. Set it in the Asphyxia settings page.</div>';
        }
      });
    return { getClientId: function() { return clientId; } };
  }

  function checkStatus(statusEl, onAuthorized, onNotAuthorized) {
    fetch('/tachi/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (statusEl) statusEl.style.display = 'none';
        if (data.authorized) {
          onAuthorized();
        } else {
          onNotAuthorized();
        }
      })
      .catch(function() {
        if (statusEl) statusEl.innerHTML =
          '<div class="notification is-danger is-light">Failed to check Tachi status.</div>';
      });
  }

  function initAuth(authorizeBtn, disconnectBtn, configHandle, onStatusChange) {
    if (authorizeBtn) {
      authorizeBtn.addEventListener('click', function() {
        var clientId = configHandle.getClientId();
        var url = 'https://kamai.tachi.ac/oauth/request-auth?clientID=' + clientId;
        console.log('[Tachi] Authorize clicked, clientId:', clientId, 'url:', url);
        var popup = window.open(url, 'tachi_auth', 'width=600,height=700');
        if (!popup) {
          console.error('[Tachi] Popup was blocked by browser');
          alert('Popup was blocked. Please allow popups for this site.');
        }
      });
    }
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', function() {
        if (!confirm('Disconnect from Tachi?')) return;
        fetch('/tachi/disconnect', { method: 'POST' })
          .then(function() { if (onStatusChange) onStatusChange(); });
      });
    }
    window.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'tachi-auth' && event.data.code) {
        console.log('[Tachi] Received auth code via postMessage');
        fetch('/tachi/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: event.data.code })
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            console.log('[Tachi] Exchange result:', data);
            if (data.success) {
              if (onStatusChange) onStatusChange();
            } else {
              console.error('[Tachi] Exchange failed:', data.description);
              alert('Tachi authorization failed: ' + (data.description || 'Unknown error'));
            }
          })
          .catch(function(err) {
            console.error('[Tachi] Exchange error:', err);
          });
      }
    });
  }

  function importFromTachi(refid) {
    return fetch('/tachi/pbs')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success) {
          return { success: false, description: data.description || 'Failed to fetch PBs from Tachi' };
        }
        if (!data.scores || data.scores.length === 0) {
          return { success: true, imported: 0, skipped: 0, message: 'No scores found on Tachi.' };
        }
        return fetch('/tachi/save-scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refid: refid, scores: data.scores.map(function(s) {
            return { mid: s.mid, type: s.type, score: s.score, clear: s.clear, grade: s.grade, exscore: s.exscore, timeAchieved: s.timeAchieved || null, version: 6 };
          })})
        })
          .then(function(r) { return r.json(); })
          .then(function(saveResult) {
            if (!saveResult.success) {
              return { success: false, description: saveResult.description || 'Failed to save scores' };
            }
            return { success: true, imported: saveResult.saved, skipped: saveResult.skipped, scores: data.scores };
          });
      });
  }

  function exportToTachi(refid, forceAll) {
    return fetch('/tachi/export-ts?refid=' + encodeURIComponent(refid))
      .then(function(r) { return r.json(); })
      .then(function(tsData) {
        var since = (!forceAll && tsData.success && tsData.timestamp) ? tsData.timestamp : null;
        var result = buildTachiScores(since);
        var tachiScores = result.tachiScores;

        if (tachiScores.length === 0) {
          var msg = 'No scores to upload.';
          if (since) msg = 'No new scores since last export (' + new Date(since).toLocaleString() + '). ' + result.skippedCount + ' scores already exported.';
          return { success: true, _skipped: true, _message: msg, _result: result };
        }

        var cleanScores = tachiScores.map(function(s) { var c = Object.assign({}, s); delete c._songName; return c; });
        console.log('Sending ' + cleanScores.length + ' scores to Tachi' + (result.skippedCount > 0 ? ' (skipped ' + result.skippedCount + ' already exported)' : ''));

        return fetch('/tachi/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scores: cleanScores })
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success) {
              return fetch('/tachi/save-export-ts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refid: refid })
              }).then(function() { return data; });
            }
            return data;
          })
          .then(function(data) {
            return { success: data.success, data: data, scoresSent: tachiScores.length, skippedCount: result.skippedCount, _result: result };
          });
      });
  }

  function loadAsphyxiaPBs(containerId) {
    function doLoad() {
      if (!music_db_loaded) {
        if (music_db_error) {
          document.getElementById(containerId).innerHTML = '<p class="has-text-danger">Failed to load song database.</p>';
          return;
        }
        setTimeout(doLoad, 500);
        return;
      }
      var scoresRaw = JSON.parse(document.getElementById('data-pass-scores').textContent);
      var supported = scoresRaw.filter(function(s) { return s.version === 6 || s.version === 7; });
      var enriched = supported.map(function(s) {
        var diff = getDifficulty(s.mid, s.type) || '?';
        var level = getDiffLevel(s.mid, s.type);
        var vf = computeVF(s.score, level, s.clear, s.version);
        var clearNames = s.version === 7 ? CLEAR_NAMES_NABLA : CLEAR_NAMES_EG;
        return { mid: s.mid, type: s.type, name: getSongName(s.mid), diff: diff, level: level, score: s.score, lamp: clearNames[s.clear] || String(s.clear), vf: vf };
      });
      var bestByChart = {};
      for (var i = 0; i < enriched.length; i++) {
        var key = enriched[i].mid + '_' + enriched[i].type;
        if (!bestByChart[key] || enriched[i].vf > bestByChart[key].vf) {
          bestByChart[key] = enriched[i];
        }
      }
      var deduped = [];
      for (var k in bestByChart) deduped.push(bestByChart[k]);
      deduped.sort(function(a, b) { return b.vf - a.vf; });
      var top50 = deduped.slice(0, 50);
      document.getElementById(containerId).innerHTML = top50.length > 0 ? renderPBTable(top50) : '<p class="has-text-grey">No scores found.</p>';
    }
    doLoad();
  }

  function loadTachiPBs(containerId) {
    fetch('/tachi/pbs/best')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success || !data.scores || data.scores.length === 0) {
          document.getElementById(containerId).innerHTML = '<p class="has-text-grey">No scores found on Tachi.</p>';
          return;
        }
        var scores = data.scores.slice(0, 50).map(function(s) {
          return { name: s.songName, diff: s.difficulty, level: s.level, score: s.score, lamp: s.lamp, vf: s.vf };
        });
        document.getElementById(containerId).innerHTML = renderPBTable(scores);
      })
      .catch(function() {
        document.getElementById(containerId).innerHTML = '<p class="has-text-danger">Failed to load Tachi PBs.</p>';
      });
  }

  return {
    isMusicDBLoaded: function() { return music_db_loaded; },
    hasMusicDBError: function() { return music_db_error; },
    getSongName: getSongName,
    getDifficulty: getDifficulty,
    buildTachiScores: buildTachiScores,
    initTachiConfig: initTachiConfig,
    checkStatus: checkStatus,
    initAuth: initAuth,
    importFromTachi: importFromTachi,
    exportToTachi: exportToTachi,
    loadAsphyxiaPBs: loadAsphyxiaPBs,
    loadTachiPBs: loadTachiPBs,
    renderPBTable: renderPBTable
  };
})();
