(function() {
  // Method selector
  var tachiBtn = document.getElementById('method-tachi-btn');
  var serverBtn = document.getElementById('method-server-btn');
  var tachiSection = document.getElementById('method-tachi');
  var serverSection = document.getElementById('method-server');

  tachiBtn.addEventListener('click', function() {
    tachiBtn.classList.add('is-link');
    serverBtn.classList.remove('is-link');
    tachiSection.style.display = '';
    serverSection.style.display = 'none';
  });
  serverBtn.addEventListener('click', function() {
    serverBtn.classList.add('is-link');
    tachiBtn.classList.remove('is-link');
    serverSection.style.display = '';
    tachiSection.style.display = 'none';
  });

  if (localStorage.getItem('tachi-warning-dismissed') === '1') {
    var w = document.getElementById('tachi-controller-warning');
    if (w) w.style.display = 'none';
  }

  if (typeof isOwner !== 'undefined' && !isOwner) {
    document.getElementById('tachi-status').style.display = 'none';
    document.getElementById('tachi-not-authorized').style.display = 'none';
    document.getElementById('tachi-authorized').style.display = 'none';
    document.querySelector('#method-tachi .card-content .content').innerHTML =
      '<div class="notification is-warning is-light"><span class="icon"><i class="mdi mdi-lock"></i></span> Exporting is only available on your own profile.</div>';
    document.getElementById('export-section').style.display = 'none';
    return;
  }

  // --- Tachi Export ---
  var configHandle = Tachi.initTachiConfig(document.getElementById('tachi-not-authorized'));

  function refreshStatus() {
    Tachi.checkStatus(
      document.getElementById('tachi-status'),
      function onAuthorized() {
        document.getElementById('tachi-authorized').style.display = '';
        document.getElementById('tachi-not-authorized').style.display = 'none';
        loadAutoExportState();
      },
      function onNotAuthorized() {
        document.getElementById('tachi-not-authorized').style.display = '';
        document.getElementById('tachi-authorized').style.display = 'none';
      }
    );
  }

  Tachi.initAuth(
    document.getElementById('tachi-authorize-btn'),
    document.getElementById('tachi-disconnect-btn'),
    configHandle,
    refreshStatus
  );
  refreshStatus();

  function showResult(type, html) {
    var resultDiv = document.getElementById('tachi-result');
    var contentDiv = document.getElementById('tachi-result-content');
    resultDiv.style.display = '';
    contentDiv.innerHTML = '<div class="notification is-' + type + ' is-light">' + html + '</div>';
  }

  function showExportResult(exportResult) {
    if (exportResult._skipped) {
      showResult('info', exportResult._message);
      return;
    }
    var data = exportResult.data;
    var html = '';
    if (data.success) {
      var body = data.body || {};
      html += '<p class="has-text-success"><strong>Export successful!</strong></p>';
      html += '<p>Scores sent: ' + exportResult.scoresSent + '</p>';
      if (exportResult.skippedCount > 0) html += '<p>Skipped (already exported): ' + exportResult.skippedCount + '</p>';
      if (body.scoreIDs) html += '<p>Scores imported: ' + body.scoreIDs.length + '</p>';
      if (body.errors) html += '<p>Errors: ' + body.errors.length + '</p>';
      if (body.errors && body.errors.length > 0) {
        html += '<details><summary>Error details</summary><ul>';
        for (var j = 0; j < Math.min(body.errors.length, 50); j++) {
          html += '<li>' + (body.errors[j].message || JSON.stringify(body.errors[j])) + '</li>';
        }
        if (body.errors.length > 50) html += '<li>... and ' + (body.errors.length - 50) + ' more</li>';
        html += '</ul></details>';
      }
    } else {
      html += '<p class="has-text-danger"><strong>Export failed</strong></p>';
      html += '<p>' + (data.description || 'Unknown error') + '</p>';
    }
    html += '<details class="mt-3"><summary>Raw API Response</summary>';
    html += '<pre style="max-height:300px;overflow:auto;font-size:0.75em;background:#1a1a1e;color:#ddd;padding:0.5em;border-radius:4px;white-space:pre-wrap;">' + JSON.stringify(data, null, 2) + '</pre>';
    html += '</details>';
    showResult(data.success ? 'success' : 'danger', html);
  }

  // Export to Tachi (new scores only)
  document.getElementById('tachi-export-btn').addEventListener('click', function() {
    var btn = this;
    btn.classList.add('is-loading');
    btn.disabled = true;
    Tachi.exportToTachi(refid, false)
      .then(function(result) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        showExportResult(result);
      })
      .catch(function(err) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        showResult('danger', '<strong>Error:</strong> ' + err.message);
      });
  });

  // Force full export
  document.getElementById('tachi-export-all-btn').addEventListener('click', function() {
    var btn = this;
    btn.classList.add('is-loading');
    btn.disabled = true;
    Tachi.exportToTachi(refid, true)
      .then(function(result) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        showExportResult(result);
      })
      .catch(function(err) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        showResult('danger', '<strong>Error:</strong> ' + err.message);
      });
  });

  // Auto-export toggle
  function loadAutoExportState() {
    fetch('/tachi/auto-export?refid=' + encodeURIComponent(refid))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          document.getElementById('tachi-auto-export-check').checked = data.enabled;
        }
      })
      .catch(function() {});
  }

  document.getElementById('tachi-auto-export-check').addEventListener('change', function() {
    var enabled = this.checked;
    fetch('/tachi/auto-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refid: refid, enabled: enabled })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success) {
          document.getElementById('tachi-auto-export-check').checked = !enabled;
        }
      })
      .catch(function() {
        document.getElementById('tachi-auto-export-check').checked = !enabled;
      });
  });

  // --- Migrate to Another Server ---
  document.getElementById('export-savedata-btn').addEventListener('click', function() {
    var btn = this;
    btn.classList.add('is-loading');
    btn.disabled = true;
    window.location.href = '/migrate/export-savedata?refid=' + encodeURIComponent(refid);
    setTimeout(function() {
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }, 3000);
  });
})();
