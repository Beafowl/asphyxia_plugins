var diffNames = ['', 'NOV', 'ADV', 'EXH', 'MXM'];
var diffClasses = ['', 'chip-nov', 'chip-adv', 'chip-exh', 'chip-mxm'];

function loadCustomCharts() {
  emit('nauticaList', {}).then(function (response) {
    var result = response.data;
    var container = document.getElementById('custom-charts-list');
    if (!result || result.error) {
      container.innerHTML = '<div class="notification is-danger is-light">' + escapeHtml(result ? result.error : 'No response') + '</div>';
      return;
    }

    var songs = (result.songs || []).filter(function (s) { return s.status === 'ready'; });
    if (songs.length === 0) {
      container.innerHTML = '<p class="has-text-grey">No custom charts available yet.</p>';
      return;
    }

    var html = '<p class="mb-3"><strong>' + songs.length + '</strong> curated chart' + (songs.length !== 1 ? 's' : '') + ' available</p>';
    html += '<div class="charts-grid">';

    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      var chipHtml = '';
      for (var j = 0; j < (s.charts || []).length; j++) {
        var c = s.charts[j];
        var d = c.difficulty || 0;
        chipHtml += '<span class="chip ' + (diffClasses[d] || 'chip-exh') + '">' +
          (diffNames[d] || '?') + ' ' + (c.level || '?') + '</span>';
      }

      html += '<div class="chart-card">' +
        '<img class="jacket" src="' + (s.jacketUrl || '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
        '<div class="info">' +
          '<div class="title" title="' + escapeAttr(s.title || '') + '">' + escapeHtml(s.title || 'Untitled') +
            ' <a href="https://ksm.dev/songs/' + s.nauticaId + '" target="_blank" style="color:#666;text-decoration:none" title="View on ksm.dev"><i class="mdi mdi-open-in-new" style="font-size:0.75em"></i></a></div>' +
          '<div class="artist">' + escapeHtml(s.artist || 'Unknown') + '</div>' +
          (function() {
            var eff = (s.charts || []).map(function(c) { return c.effector; }).filter(Boolean);
            var unique = eff.filter(function(v, i, a) { return a.indexOf(v) === i; });
            return unique.length > 0 ? '<div style="font-size:0.8em;color:#aaa;margin-top:0.25rem"><i class="mdi mdi-account" style="font-size:0.9em"></i> ' + escapeHtml(unique.join(', ')) + '</div>' : '';
          })() +
          '<div class="charts">' + chipHtml + '</div>' +
          '<div class="id-badge">ID: ' + s.mid + '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<a class="button is-small is-link" href="/api/nautica/download/' + s.mid + '" target="_blank">' +
            '<span class="icon"><i class="mdi mdi-download"></i></span>' +
            '<span>Download</span>' +
          '</a>' +
        '</div>' +
      '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  });
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

loadCustomCharts();
