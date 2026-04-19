var existingNauticaIds = new Set();

var diffNames = ['', 'NOV', 'ADV', 'EXH', 'MXM'];
var diffClasses = ['', 'chip-nov', 'chip-adv', 'chip-exh', 'chip-mxm'];

// v7 (Valkyrie/∇) chart levels: integer 1–17, plus 17.5, plus any 0.1 step
// between 18.0 and 20.0 inclusive. The game's music_db stores `difnum` as
// level*10 (u8), so we work in tenths to avoid float compare pitfalls.
function isValidV7Level(level) {
  if (typeof level !== 'number' || !isFinite(level)) return false;
  var tenths = Math.round(level * 10);
  if (Math.abs(tenths - level * 10) > 1e-6) return false;   // more than 1dp
  if (tenths < 10 || tenths > 200) return false;
  if (tenths <= 170) return tenths % 10 === 0;              // 1.0–17.0 whole
  if (tenths === 175) return true;                          // 17.5
  if (tenths < 180) return false;                           // 17.1–17.4, 17.6–17.9 rejected
  return true;                                              // 18.0–20.0
}

function loadExistingIds() {
  Promise.all([
    emit('nauticaList', {}),
    emit('nauticaDeletedList', {}),
  ]).then(function (responses) {
    var ids = new Set();
    var listResult = responses[0] && responses[0].data;
    if (listResult && listResult.songs) {
      listResult.songs.forEach(function (s) { ids.add(s.nauticaId); });
    }
    var deletedResult = responses[1] && responses[1].data;
    if (deletedResult && deletedResult.deleted) {
      deletedResult.deleted.forEach(function (d) { ids.add(d.nauticaId); });
    }
    existingNauticaIds = ids;
  });
}
loadExistingIds();

// ─── Nominations Queue ──────────────────────────────────────────────────────

function refreshNominationQueue() {
  emit('nauticaNominationQueue', {}).then(function (response) {
    var result = response.data;
    var container = document.getElementById('nominations-queue');
    if (!result || result.error) {
      container.innerHTML = '<p class="has-text-grey">' + (result ? result.error : 'Failed to load') + '</p>';
      return;
    }

    var nominations = result.nominations || [];
    if (nominations.length === 0) {
      container.innerHTML = '<p class="has-text-grey">No pending nominations.</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < nominations.length; i++) {
      var s = nominations[i];
      var fb = s.feedback || { up: 0, down: 0, comments: [] };
      var chipHtml = '';
      for (var j = 0; j < (s.charts || []).length; j++) {
        var c = s.charts[j];
        var d = c.difficulty || 0;
        chipHtml += '<span class="chip ' + (diffClasses[d] || '') + '">' +
          (diffNames[d] || '?') + ' ' + (c.level || '?') + '</span> ';
      }

      var statusClass = 'status-' + s.status;

      html += '<div class="box">' +
        '<div class="columns">' +
          '<div class="column is-narrow">' +
            '<img src="' + (s.jacketUrl || '') + '" style="width:80px;height:80px;border-radius:4px;object-fit:cover" onerror="this.style.display=\'none\'">' +
          '</div>' +
          '<div class="column">' +
            '<strong>' + escapeHtml(s.title) + '</strong>' +
            ' <a href="https://ksm.dev/songs/' + s.nauticaId + '" target="_blank" style="color:#666;font-size:0.8em"><i class="mdi mdi-open-in-new"></i></a>' +
            '<br><span class="has-text-grey">' + escapeHtml(s.artist) + '</span>' +
            '<br>' + chipHtml +
            '<br><span style="font-size:0.85em">Nominated by <strong>' + escapeHtml(s.nominatedBy || '?') + '</strong>' +
            (s.nominationNote ? ' — <em>' + escapeHtml(s.nominationNote) + '</em>' : '') +
            '</span>' +
            '<br><span class="curated-status ' + statusClass + '">' + s.status + '</span>' +
          '</div>' +
          '<div class="column is-narrow">' +
            // Feedback summary
            '<div style="margin-bottom:0.5rem">' +
              '<span class="has-text-success"><i class="mdi mdi-thumb-up"></i> ' + fb.up + '</span> ' +
              '<span class="has-text-danger"><i class="mdi mdi-thumb-down"></i> ' + fb.down + '</span>' +
            '</div>' +
            // Actions
            '<div class="buttons are-small">' +
              (s.status === 'nominated' ?
                '<button class="button is-info nom-action-btn" data-id="' + s.nauticaId + '" data-action="testing">' +
                  '<span class="icon"><i class="mdi mdi-test-tube"></i></span><span>Testing</span></button>' : '') +
              '<button class="button is-success nom-action-btn" data-id="' + s.nauticaId + '" data-action="approve" ' +
                'data-song=\'' + escapeAttr(JSON.stringify({
                  nauticaId: s.nauticaId, title: s.title, artist: s.artist,
                  jacketUrl: s.jacketUrl, downloadUrl: s.downloadUrl,
                  charts: s.charts, tags: s.tags,
                })) + '\'>' +
                '<span class="icon"><i class="mdi mdi-check"></i></span><span>Approve</span></button>' +
              '<button class="button is-danger nom-action-btn" data-id="' + s.nauticaId + '" data-action="reject">' +
                '<span class="icon"><i class="mdi mdi-close"></i></span><span>Reject</span></button>' +
            '</div>' +
          '</div>' +
        '</div>';

      // Feedback comments (expandable)
      if (fb.comments && fb.comments.length > 0) {
        html += '<details style="margin-top:0.5rem"><summary style="cursor:pointer;font-size:0.85em;color:#888">' +
          fb.comments.length + ' comment(s)</summary><div style="margin-top:0.5rem">';
        for (var k = 0; k < fb.comments.length; k++) {
          var fbItem = fb.comments[k];
          var voteIcon = fbItem.vote === 'up' ? '<i class="mdi mdi-thumb-up has-text-success"></i>' : '<i class="mdi mdi-thumb-down has-text-danger"></i>';
          html += '<div style="padding:0.25rem 0;font-size:0.85em;border-bottom:1px solid #333">' +
            voteIcon + ' <strong>' + escapeHtml(fbItem.username) + '</strong>: ' + escapeHtml(fbItem.comment || '') +
            (fbItem.suggestedLevels && fbItem.suggestedLevels.length > 0 ?
              ' <em>(suggests: ' + fbItem.suggestedLevels.map(function(sl) {
                return (diffNames[sl.difficulty] || '?') + ' ' + sl.level;
              }).join(', ') + ')</em>' : '') +
          '</div>';
        }
        html += '</div></details>';
      }

      html += '</div>';
    }

    container.innerHTML = html;

    // Bind action buttons
    var actionBtns = container.querySelectorAll('.nom-action-btn');
    for (var m = 0; m < actionBtns.length; m++) {
      actionBtns[m].addEventListener('click', handleNominationAction);
    }
  });
}

function handleNominationAction(e) {
  var btn = e.currentTarget;
  var nauticaId = btn.getAttribute('data-id');
  var action = btn.getAttribute('data-action');

  btn.classList.add('is-loading');
  btn.disabled = true;

  if (action === 'testing') {
    emit('nauticaSetTesting', { nauticaId: nauticaId }).then(function (response) {
      btn.classList.remove('is-loading');
      refreshNominationQueue();
    });
  } else if (action === 'approve') {
    var songData = JSON.parse(btn.getAttribute('data-song'));
    emit('nauticaApprove', songData).then(function (response) {
      btn.classList.remove('is-loading');
      refreshNominationQueue();
      refreshCuratedList();
    });
  } else if (action === 'reject') {
    var reason = prompt('Reason for rejection:');
    if (reason === null) { btn.classList.remove('is-loading'); btn.disabled = false; return; }
    emit('nauticaReject', { nauticaId: nauticaId, reason: reason }).then(function (response) {
      btn.classList.remove('is-loading');
      refreshNominationQueue();
    });
  }
}

// ─── Bulk Nomination Actions ────────────────────────────────────────────────

function handleBulkNominationAction(action) {
  emit('nauticaNominationQueue', {}).then(function (response) {
    var result = response.data;
    if (!result || !result.nominations) {
      alert((result && result.error) || 'Failed to load nominations.');
      return;
    }

    var queue = result.nominations || [];
    var targets = action === 'testing'
      ? queue.filter(function (n) { return n.status === 'nominated'; })
      : queue;

    if (targets.length === 0) {
      alert('No charts to ' + (action === 'testing' ? 'test' : action) + '.');
      return;
    }

    var sharedReason = null;
    if (action === 'reject') {
      sharedReason = prompt('Reason for rejecting ' + targets.length + ' chart(s) (required):');
      if (sharedReason === null) return;
      sharedReason = sharedReason.trim();
      if (!sharedReason) { alert('A rejection reason is required.'); return; }
    }

    var verb = action === 'testing' ? 'move to testing' : action;
    if (!confirm('Are you sure you want to ' + verb + ' ' + targets.length + ' chart(s)?')) return;

    setBulkButtonsDisabled(true);

    var ok = 0, failed = 0, idx = 0;
    function next() {
      if (idx >= targets.length) {
        setBulkButtonsDisabled(false);
        if (failed > 0) alert('Done: ' + ok + ' succeeded, ' + failed + ' failed.');
        loadExistingIds();
        refreshNominationQueue();
        refreshCuratedList();
        refreshDeletedList();
        return;
      }
      var n = targets[idx++];
      var call;
      if (action === 'testing') {
        call = emit('nauticaSetTesting', { nauticaId: n.nauticaId });
      } else if (action === 'approve') {
        call = emit('nauticaApprove', {
          nauticaId: n.nauticaId,
          title: n.title,
          artist: n.artist,
          jacketUrl: n.jacketUrl,
          downloadUrl: n.downloadUrl,
          charts: n.charts,
          tags: n.tags,
        });
      } else {
        call = emit('nauticaReject', { nauticaId: n.nauticaId, reason: sharedReason });
      }
      call.then(function (resp) {
        var r = resp && resp.data;
        if (r && r.error) failed++; else ok++;
        next();
      }).catch(function () { failed++; next(); });
    }
    next();
  });
}

function setBulkButtonsDisabled(disabled) {
  var ids = ['bulk-test-btn', 'bulk-approve-btn', 'bulk-reject-btn'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) {
      el.disabled = disabled;
      if (disabled) el.classList.add('is-loading');
      else el.classList.remove('is-loading');
    }
  }
}

(function () {
  var testBtn = document.getElementById('bulk-test-btn');
  var approveBtn = document.getElementById('bulk-approve-btn');
  var rejectBtn = document.getElementById('bulk-reject-btn');
  if (testBtn) testBtn.addEventListener('click', function () { handleBulkNominationAction('testing'); });
  if (approveBtn) approveBtn.addEventListener('click', function () { handleBulkNominationAction('approve'); });
  if (rejectBtn) rejectBtn.addEventListener('click', function () { handleBulkNominationAction('reject'); });
})();

// ─── Reconvert All ──────────────────────────────────────────────────────────

(function () {
  var btn = document.getElementById('bulk-reconvert-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (!confirm('Re-run conversion on every converted chart? This re-downloads source ZIPs from Nautica and overwrites existing converted files. It may take a while.')) return;

    btn.disabled = true;
    btn.classList.add('is-loading');

    emit('nauticaReconvertAll', {}).then(function (response) {
      btn.disabled = false;
      btn.classList.remove('is-loading');

      var result = response && response.data;
      if (!result || result.error) {
        alert((result && result.error) || 'Failed to queue reconversion.');
        return;
      }

      if (result.count === 0) {
        alert('No charts to reconvert.');
      } else {
        alert('Queued ' + result.count + ' chart(s) for reconversion. Watch the Curated Charts list for status updates.');
      }
      refreshCuratedList();
    }).catch(function () {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      alert('Failed to queue reconversion.');
    });
  });
})();

// ─── Curated Charts Import / Export ────────────────────────────────────────

(function () {
  var exportBtn = document.getElementById('curated-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      exportBtn.disabled = true;
      exportBtn.classList.add('is-loading');
      emit('nauticaExportList', {}).then(function (response) {
        exportBtn.disabled = false;
        exportBtn.classList.remove('is-loading');
        var result = response && response.data;
        if (!result || result.error) {
          alert((result && result.error) || 'Export failed.');
          return;
        }
        // Trigger browser download
        var blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var d = new Date(result.exportedAt || Date.now());
        var stamp = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0') +
                    '_' + String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0');
        a.href = url;
        a.download = 'asphyxia-curated-' + stamp + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }).catch(function () {
        exportBtn.disabled = false;
        exportBtn.classList.remove('is-loading');
        alert('Export failed.');
      });
    });
  }

  var importBtn = document.getElementById('curated-import-btn');
  var importInput = document.getElementById('curated-import-file');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', function () { importInput.click(); });

    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      importInput.value = ''; // allow re-selecting the same file
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function () {
        var payload;
        try { payload = JSON.parse(reader.result); }
        catch (e) { alert('Could not parse file as JSON: ' + e.message); return; }

        if (!payload || !Array.isArray(payload.songs)) {
          alert('File does not look like an exported curated-chart list (missing "songs" array).');
          return;
        }
        if (!confirm('Import ' + payload.songs.length + ' chart entr(ies)? Existing charts with the same nauticaId will be left untouched. New entries land as "pending" and need Reconvert All to actually build audio.')) {
          return;
        }

        importBtn.disabled = true;
        importBtn.classList.add('is-loading');
        emit('nauticaImportList', { songs: payload.songs }).then(function (response) {
          importBtn.disabled = false;
          importBtn.classList.remove('is-loading');
          var result = response && response.data;
          if (!result || result.error) {
            alert((result && result.error) || 'Import failed.');
            return;
          }
          alert('Import done: ' + result.added + ' new, ' +
                result.skippedExisting + ' already existed, ' +
                result.skippedInvalid + ' invalid.');
          loadExistingIds();
          refreshCuratedList();
          refreshNominationQueue();
        }).catch(function () {
          importBtn.disabled = false;
          importBtn.classList.remove('is-loading');
          alert('Import failed.');
        });
      };
      reader.onerror = function () { alert('Could not read file.'); };
      reader.readAsText(file);
    });
  }
})();

// ─── Curated Charts List ────────────────────────────────────────────────────

// Cached songs + current search term. Filtering is entirely client-side: the
// admin list rarely exceeds a few hundred entries, and filtering locally lets
// the server handler stay a single cheap Find() without any pagination query
// layer. refreshCuratedList() refetches; renderCuratedList() redraws from
// whatever the cache currently holds.
var curatedSongs = [];
var curatedSearchTerm = '';

function refreshCuratedList() {
  emit('nauticaList', {}).then(function (response) {
    var result = response.data;
    var container = document.getElementById('curated-list');
    if (!result || result.error) {
      container.innerHTML = '<div class="notification is-danger is-light">' + (result ? result.error : 'Error') + '</div>';
      return;
    }

    curatedSongs = (result.songs || []).filter(function(s) {
      return s.status !== 'nominated' && s.status !== 'testing' && s.status !== 'rejected';
    });
    renderCuratedList();
  });
}

function renderCuratedList() {
  var container = document.getElementById('curated-list');
  if (!container) return;

  var term = (curatedSearchTerm || '').toLowerCase().trim();
  var songs = curatedSongs;
  if (term) {
    songs = songs.filter(function (s) {
      if (String(s.mid || '').indexOf(term) !== -1) return true;
      if (s.title && s.title.toLowerCase().indexOf(term) !== -1) return true;
      if (s.artist && s.artist.toLowerCase().indexOf(term) !== -1) return true;
      return false;
    });
  }

  if (curatedSongs.length === 0) {
    container.innerHTML = '<p class="has-text-grey">No curated charts yet.</p>';
    return;
  }
  if (songs.length === 0) {
    container.innerHTML = '<p class="has-text-grey">No curated charts match "' + escapeHtml(curatedSearchTerm) + '".</p>';
    return;
  }

  var html = '<table class="table is-fullwidth is-striped"><thead><tr>' +
    '<th>ID</th><th>Title</th><th>Artist</th><th>Charts</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < songs.length; i++) {
    var s = songs[i];
    var chipHtml = '';
    for (var j = 0; j < (s.charts || []).length; j++) {
      var c = s.charts[j];
      var d = c.difficulty || 0;
      // Each chip doubles as a "rerate this difficulty" button so the admin
      // can correct the level without leaving the list.
      chipHtml += '<span class="chip ' + (diffClasses[d] || '') + ' nautica-rerate-btn" ' +
        'data-id="' + escapeAttr(s.nauticaId) + '" data-difficulty="' + d + '" data-level="' + (c.level || 0) + '" ' +
        'title="Click to rerate ' + (diffNames[d] || '?') + '" style="cursor:pointer">' +
        (diffNames[d] || '?') + ' ' + (c.level || '?') + '</span> ';
    }

    var statusClass = 'status-' + (s.status || 'pending');
    html += '<tr>' +
      '<td>' + (s.mid || '-') + '</td>' +
      '<td>' + escapeHtml(s.title) + '</td>' +
      '<td>' + escapeHtml(s.artist) + '</td>' +
      '<td>' + chipHtml + '</td>' +
      '<td><span class="curated-status ' + statusClass + '">' + (s.status || 'pending') +
        (s.errorMessage ? ' — ' + escapeHtml(s.errorMessage) : '') + '</span></td>' +
      '<td><div class="buttons are-small" style="flex-wrap:nowrap">' +
        '<button class="button is-warning nautica-reconvert-btn" data-id="' + s.nauticaId + '" title="Reconvert this chart">' +
          '<span class="icon"><i class="mdi mdi-refresh"></i></span>' +
        '</button>' +
        '<button class="button is-danger nautica-remove-btn" data-id="' + s.nauticaId + '" title="Delete this chart">' +
          '<span class="icon"><i class="mdi mdi-delete"></i></span>' +
        '</button>' +
      '</div></td>' +
      '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  var removeBtns = container.querySelectorAll('.nautica-remove-btn');
  for (var k = 0; k < removeBtns.length; k++) {
    removeBtns[k].addEventListener('click', function () {
      var id = this.getAttribute('data-id');
      var reason = prompt('Reason for deletion (required):');
      if (reason === null) return;
      reason = reason.trim();
      if (!reason) { alert('A deletion reason is required.'); return; }
      emit('nauticaRemove', { nauticaId: id, reason: reason }).then(function (response) {
        var result = response.data;
        if (result && result.error) {
          alert(result.error);
          return;
        }
        loadExistingIds();
        refreshCuratedList();
        refreshDeletedList();
      });
    });
  }

  var reconvertBtns = container.querySelectorAll('.nautica-reconvert-btn');
  for (var rc = 0; rc < reconvertBtns.length; rc++) {
    reconvertBtns[rc].addEventListener('click', function () {
      var btn = this;
      var id = btn.getAttribute('data-id');
      btn.disabled = true;
      btn.classList.add('is-loading');
      emit('nauticaReconvert', { nauticaId: id }).then(function (response) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        var result = response && response.data;
        if (!result) {
          alert('Server returned no response. The nauticaReconvert event is likely not registered — restart the Asphyxia server after rebuilding.');
          return;
        }
        if (result.error) {
          alert(result.error);
          return;
        }
        if (!result.success) {
          alert('Reconvert did not confirm success. Check the server log.');
          return;
        }
        refreshCuratedList();
      }).catch(function (err) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        alert('Failed to queue reconversion: ' + (err && err.message ? err.message : err));
      });
    });
  }

  var rerateBtns = container.querySelectorAll('.nautica-rerate-btn');
  for (var rr = 0; rr < rerateBtns.length; rr++) {
    rerateBtns[rr].addEventListener('click', function () {
      var btn = this;
      var id = btn.getAttribute('data-id');
      var difficulty = parseInt(btn.getAttribute('data-difficulty'), 10);
      var current = parseFloat(btn.getAttribute('data-level')) || 0;
      var diffName = diffNames[difficulty] || '?';
      var input = prompt(
        'New level for ' + diffName + ' (current: ' + current + ').\n' +
        'Allowed: 1–17, 17.5, 18.0–20.0 in 0.1 steps.',
        String(current)
      );
      if (input === null) return;
      var newLevel = parseFloat(String(input).trim().replace(',', '.'));
      if (!isValidV7Level(newLevel)) {
        alert('Level must be one of: 1–17 (whole), 17.5, or 18.0–20.0 in 0.1 steps.');
        return;
      }
      if (newLevel === current) return;
      btn.style.opacity = '0.5';
      emit('nauticaRerate', { nauticaId: id, difficulty: difficulty, level: newLevel }).then(function (response) {
        btn.style.opacity = '';
        var result = response && response.data;
        if (!result) {
          alert('Server returned no response. The nauticaRerate event is likely not registered — restart the Asphyxia server after rebuilding.');
          return;
        }
        if (result.error) { alert(result.error); return; }
        var msg = 'Rerated to ' + newLevel + '.';
        if (typeof result.volforceUpdated === 'number') {
          msg += ' Volforce recalculated for ' + result.volforceUpdated + ' existing score record(s).';
        }
        alert(msg);
        refreshCuratedList();
      }).catch(function (err) {
        btn.style.opacity = '';
        alert('Rerate failed: ' + (err && err.message ? err.message : err));
      });
    });
  }
}

// Hook the search input up once (idempotent guard for future hot-reloads).
(function () {
  var searchInput = document.getElementById('curated-search');
  if (!searchInput || searchInput._bound) return;
  searchInput._bound = true;
  searchInput.addEventListener('input', function () {
    curatedSearchTerm = this.value || '';
    renderCuratedList();
  });
})();

// ─── Deleted Charts List ────────────────────────────────────────────────────

function refreshDeletedList() {
  var container = document.getElementById('deleted-list');
  if (!container) return;
  emit('nauticaDeletedList', {}).then(function (response) {
    var result = response.data;
    if (!result || result.error) {
      container.innerHTML = '<div class="notification is-danger is-light">' + (result ? result.error : 'Error') + '</div>';
      return;
    }

    var rows = result.deleted || [];
    if (rows.length === 0) {
      container.innerHTML = '<p class="has-text-grey">No deleted charts.</p>';
      return;
    }

    var html = '<table class="table is-fullwidth is-striped"><thead><tr>' +
      '<th>Title</th><th>Artist</th><th>Previous Status</th><th>Reason</th><th>Deleted By</th><th>Deleted At</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var when = r.deletedAt ? new Date(r.deletedAt).toLocaleString() : '';
      var titleCell = r.jacketUrl
        ? '<img src="' + escapeAttr(r.jacketUrl) + '" style="width:32px;height:32px;border-radius:3px;object-fit:cover;vertical-align:middle;margin-right:0.4rem" onerror="this.style.display=\'none\'">' +
          '<a href="https://ksm.dev/songs/' + encodeURIComponent(r.nauticaId) + '" target="_blank">' + escapeHtml(r.title || '(untitled)') + '</a>'
        : '<a href="https://ksm.dev/songs/' + encodeURIComponent(r.nauticaId) + '" target="_blank">' + escapeHtml(r.title || '(untitled)') + '</a>';

      html += '<tr>' +
        '<td>' + titleCell + '</td>' +
        '<td>' + escapeHtml(r.artist || '') + '</td>' +
        '<td><span class="curated-status status-' + escapeAttr(r.previousStatus || '') + '">' + escapeHtml(r.previousStatus || '') + '</span></td>' +
        '<td>' + escapeHtml(r.deletedReason || '') + '</td>' +
        '<td>' + escapeHtml(r.deletedBy || '') + '</td>' +
        '<td>' + escapeHtml(when) + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  });
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Init ───────────────────────────────────────────────────────────────────

refreshNominationQueue();
refreshCuratedList();
refreshDeletedList();
