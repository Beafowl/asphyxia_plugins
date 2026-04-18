var currentPage = 1;
var totalPages = 1;
var existingNauticaIds = new Set();
var adminPreviewAudio = null;

var diffNames = ['', 'NOV', 'ADV', 'EXH', 'MXM'];
var diffClasses = ['', 'chip-nov', 'chip-adv', 'chip-exh', 'chip-mxm'];

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

// ─── Nautica Browse (Direct Approve) ────────────────────────────────────────

var debounceTimer = null;
document.getElementById('nautica-search').addEventListener('input', function () {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function () {
    currentPage = 1;
    document.getElementById('admin-page-input').value = 1;
    browseNautica(1);
  }, 500);
});

document.getElementById('admin-prev-btn').addEventListener('click', function () {
  if (currentPage > 1) browseNautica(currentPage - 1);
});

document.getElementById('admin-next-btn').addEventListener('click', function () {
  if (currentPage < totalPages) browseNautica(currentPage + 1);
});

document.getElementById('admin-page-input').addEventListener('change', function () {
  var p = parseInt(this.value) || 1;
  p = Math.max(1, Math.min(p, totalPages));
  this.value = p;
  browseNautica(p);
});

function browseNautica(page) {
  var searchInput = document.getElementById('nautica-search');
  searchInput.classList.add('is-loading');

  var searchText = searchInput.value || '';
  var resultsEl = document.getElementById('nautica-results');
  var h = resultsEl.offsetHeight;
  if (h > 0) resultsEl.style.minHeight = h + 'px';
  resultsEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:' + (h || 200) + 'px"><span class="icon is-large" style="color:#555"><i class="mdi mdi-loading mdi-spin mdi-48px"></i></span></div>';
  emit('nauticaBrowse', { page: page, search: searchText }).then(function (response) {
    searchInput.classList.remove('is-loading');

    var result = response.data;
    if (!result || result.error) {
      document.getElementById('nautica-results').innerHTML =
        '<div class="notification is-danger is-light">' + (result ? result.error : 'No response') + '</div>';
      return;
    }

    var songs = result.data || [];
    var meta = result.meta || {};
    currentPage = meta.current_page || page;
    totalPages = meta.last_page || 1;

    var filtered = songs.filter(function (s) { return !existingNauticaIds.has(s.id); });
    renderNauticaResults(filtered);
    updateAdminPagination();
  });
}

function renderNauticaResults(songs) {
  var container = document.getElementById('nautica-results');
  if (!songs || songs.length === 0) {
    container.innerHTML = '<p class="has-text-grey">No results found.</p>';
    return;
  }

  var html = '<div class="nautica-grid">';
  for (var i = 0; i < songs.length; i++) {
    var s = songs[i];
    var charts = s.charts || [];
    var chipHtml = '';
    for (var j = 0; j < charts.length; j++) {
      var c = charts[j];
      var d = c.difficulty || 0;
      chipHtml += '<span class="chip ' + (diffClasses[d] || 'chip-exh') + '">' +
        (diffNames[d] || '?') + ' ' + (c.level || '?') + '</span>';
    }

    var tags = (s.tags || []).map(function (t) { return t.value || t; }).slice(0, 3);
    var tagHtml = tags.length > 0
      ? '<div style="font-size:0.75em;color:#777;margin-top:0.3rem">' + tags.join(', ') + '</div>'
      : '';

    var effectors = charts.map(function (c) { return c.effector; }).filter(Boolean);
    var uniqueEffectors = effectors.filter(function (v, i, a) { return a.indexOf(v) === i; });
    var effectorHtml = uniqueEffectors.length > 0
      ? '<div class="effector" style="font-size:0.8em;color:#aaa;padding:0 0.5rem"><i class="mdi mdi-account" style="font-size:0.9em"></i> ' + escapeHtml(uniqueEffectors.join(', ')) + '</div>'
      : '';

    html += '<div class="nautica-card" data-id="' + s.id + '">' +
      '<img class="jacket" src="' + (s.jacket_url || '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
      '<div class="card-body">' +
      '<div class="info">' +
        '<div class="title" title="' + escapeAttr(s.title || '') + '">' + escapeHtml(s.title || 'Untitled') + '</div>' +
        '<div class="artist">' + escapeHtml(s.artist || 'Unknown') + '</div>' +
      '</div>' +
      effectorHtml +
      tagHtml +
      '<div class="charts">' + chipHtml + '</div>' +
      '<div class="actions">' +
        (s.preview_url ?
          '<button class="button is-small is-info admin-preview-btn" data-url="' + escapeAttr(s.preview_url) + '">' +
            '<span class="icon"><i class="mdi mdi-play"></i></span>' +
          '</button> ' : '') +
        '<button class="button is-small is-success nautica-approve-btn" ' +
          'data-nautica=\'' + escapeAttr(JSON.stringify({
            nauticaId: s.id,
            title: s.title,
            artist: s.artist,
            jacketUrl: s.jacket_url,
            downloadUrl: s.cdn_download_url,
            charts: charts.map(function (c) { return { difficulty: c.difficulty, level: c.level, effector: c.effector || '' }; }),
            tags: tags,
          })) + '\'>' +
          '<span class="icon"><i class="mdi mdi-check"></i></span>' +
          '<span>Approve</span>' +
        '</button>' +
      '</div>' +
      '</div>' +
    '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
  container.style.minHeight = '';

  var btns = container.querySelectorAll('.nautica-approve-btn');
  for (var k = 0; k < btns.length; k++) {
    btns[k].addEventListener('click', handleApprove);
  }

  var previewBtns = container.querySelectorAll('.admin-preview-btn');
  for (var p = 0; p < previewBtns.length; p++) {
    previewBtns[p].addEventListener('click', handleAdminPreview);
  }
}

function handleAdminPreview(e) {
  var btn = e.currentTarget;
  var url = btn.getAttribute('data-url');
  var icon = btn.querySelector('i');

  if (adminPreviewAudio && !adminPreviewAudio.paused) {
    adminPreviewAudio.pause();
    adminPreviewAudio = null;
    var allBtns = document.querySelectorAll('.admin-preview-btn i');
    for (var i = 0; i < allBtns.length; i++) {
      allBtns[i].className = 'mdi mdi-play';
    }
    if (btn._playing) { btn._playing = false; return; }
  }

  adminPreviewAudio = new Audio(url);
  adminPreviewAudio.volume = 0.5;
  adminPreviewAudio.play();
  icon.className = 'mdi mdi-stop';
  btn._playing = true;
  adminPreviewAudio.addEventListener('ended', function () {
    icon.className = 'mdi mdi-play';
    btn._playing = false;
  });
}

function handleApprove(e) {
  var btn = e.currentTarget;
  var data = JSON.parse(btn.getAttribute('data-nautica'));
  btn.classList.add('is-loading');
  btn.disabled = true;

  emit('nauticaApprove', data).then(function (response) {
    var result = response.data;
    btn.classList.remove('is-loading');
    if (result.error) {
      btn.classList.remove('is-success');
      btn.classList.add('is-warning');
      btn.innerHTML = '<span>' + escapeHtml(result.error) + '</span>';
    } else {
      btn.classList.remove('is-success');
      btn.classList.add('is-info');
      btn.innerHTML = '<span class="icon"><i class="mdi mdi-check-all"></i></span><span>Approved — converting...</span>';
      loadExistingIds();
      refreshCuratedList();
      refreshNominationQueue();
    }
  });
}

function updateAdminPagination() {
  document.getElementById('admin-page-input').value = currentPage;
  document.getElementById('admin-page-total').textContent = '/ ' + totalPages;
  document.getElementById('admin-prev-btn').disabled = (currentPage <= 1);
  document.getElementById('admin-next-btn').disabled = (currentPage >= totalPages);
}

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
    if (!confirm('Re-run VoxCharger on every converted chart? This re-downloads source ZIPs from Nautica and overwrites existing converted files. It may take a while.')) return;

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

// ─── Curated Charts List ────────────────────────────────────────────────────

function refreshCuratedList() {
  emit('nauticaList', {}).then(function (response) {
    var result = response.data;
    var container = document.getElementById('curated-list');
    if (!result || result.error) {
      container.innerHTML = '<div class="notification is-danger is-light">' + (result ? result.error : 'Error') + '</div>';
      return;
    }

    var songs = (result.songs || []).filter(function(s) {
      return s.status !== 'nominated' && s.status !== 'testing' && s.status !== 'rejected';
    });
    if (songs.length === 0) {
      container.innerHTML = '<p class="has-text-grey">No curated charts yet.</p>';
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
        chipHtml += '<span class="chip ' + (diffClasses[d] || '') + '">' +
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
          if (result && result.error) {
            alert(result.error);
            return;
          }
          refreshCuratedList();
        }).catch(function () {
          btn.classList.remove('is-loading');
          btn.disabled = false;
          alert('Failed to queue reconversion.');
        });
      });
    }
  });
}

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
