(function() {
  var scores = JSON.parse(document.getElementById('data-nabla-scores').textContent);
  document.getElementById('nabla-score-count').textContent = scores.length + ' version 7 scores';

  var btn = document.getElementById('nabla-recalc-btn');
  btn.addEventListener('click', function() {
    btn.classList.add('is-loading');
    btn.disabled = true;
    var resultDiv = document.getElementById('nabla-result');
    resultDiv.style.display = 'none';

    fetch('/nabla/recalculate-vf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refid: refid })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      resultDiv.style.display = 'block';
      if (data.success) {
        resultDiv.className = 'notification is-success is-light';
        var msg = '';
        if (data.migrated) {
          msg += '<strong>Migration complete!</strong> Your Exceed Gear (v6) data has been migrated to Nabla (v7).<br>';
        }
        msg += '<strong>Done!</strong> Processed ' + data.total + ' scores, updated ' + data.updated + ' volforce values.';
        if (data.migrated) {
          msg += '<br><br><em>Reload the page to see Nabla in the version selector on the Detail tab.</em>';
        }
        resultDiv.innerHTML = msg;
      } else {
        resultDiv.className = 'notification is-danger is-light';
        resultDiv.innerHTML = '<strong>Error:</strong> ' + (data.description || 'Unknown error');
      }
    })
    .catch(function(err) {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      resultDiv.style.display = 'block';
      resultDiv.className = 'notification is-danger is-light';
      resultDiv.innerHTML = '<strong>Error:</strong> ' + err.message;
    });
  });
})();
