var urlParams;
var currentVersion;
var currentProfile;
var refid;
var versionText = [
  '',
  'BOOTH',
  'INFINTE INFECTION',
  'GRAVITY WARS',
  'HEAVENLY HAVEN',
  'VIVIDWAVE',
  'EXCEED GEAR',
  '∇',
];

function getDifficulty(songData, difficultyNum) {
  switch (difficultyNum) {
    case 0:
      return 'NOV';
    case 1:
      return 'ADV';
    case 2:
      return 'EXH';
    case 3:
      switch (songData['info']['inf_ver']) {
        case '2':
          return 'INF';
        case '3':
          return 'GRV';
        case '4':
          return 'HVN';
        case '5':
          return 'VVD';
        case '6':
          return 'XCD';
      }
    case 4:
      return 'MXM';
  }
}

function populateTable(yourScore, rivalScore, music_db) {
  const translate_table = {
    龕: '€',
    釁: '🍄',
    驩: 'Ø',
    曦: 'à',
    齷: 'é',
    骭: 'ü',
    齶: '♡',
    彜: 'ū',
    罇: 'ê',
    雋: 'Ǜ',
    鬻: '♃',
    鬥: 'Ã',
    鬆: 'Ý',
    曩: 'è',
    驫: 'ā',
    齲: '♥',
    騫: 'á',
    趁: 'Ǣ',
    鬮: '¡',
    盥: '⚙︎',
    隍: '︎Ü',
    頽: 'ä',
    餮: 'Ƶ',
    黻: '*',
    蔕: 'ũ',
    闃: 'Ā',
    饌: '²',
    煢: 'ø',
    鑷: 'ゔ',
    墸: '͟͟͞ ',
    鹹: 'Ĥ',
    瀑: 'À',
    疉: 'Ö',
    鑒: '₩',
  };
  let table_data = [];
  for (let ind in yourScore) {
    let songData = music_db['mdb']['music'].filter(
      m => parseInt(m['id']) === yourScore[ind].mid
    )[0];
    let songName = songData['info']['title_name'];
    let difficulty = getDifficulty(songData, yourScore[ind].type);
    let rivalIndivScore = rivalScore.filter(
      s => s.mid === yourScore[ind].mid && s.type === yourScore[ind].type
    );
    if (rivalIndivScore.length > 0) {
      table_data.push({
        mid: yourScore[ind].mid,
        songname: songName.replace(
          /[龕釁驩曦齷骭齶彜罇雋鬻鬥鬆曩驫齲騫趁鬮盥隍頽餮黻蔕闃饌煢鑷墸鹹瀑疉鑒]/g,
          m => translate_table[m]
        ),
        difficulty: difficulty,
        yourScore: yourScore[ind].score,
        rivalScore: rivalIndivScore[0].score,
        time: Date.parse(yourScore[ind]['updatedAt']),
      });
    }
  }

  $('#scorecompare').DataTable({
    searching: false,
    data: table_data,
    columns: [
      { data: 'mid' },
      { data: 'songname' },
      { data: 'difficulty' },
      { data: 'yourScore' },
      { data: 'rivalScore' },
      { data: 'time' },
    ],
    columnDefs: [
      {
        targets: [0, 1, 2, 3, 4, 5],
        orderable: false,
      },
      {
        targets: [5],
        visible: false,
      },
    ],
    order: [[5, 'desc']],
    responsive: {
      details: {
        display: $.fn.dataTable.Responsive.display.modal({
          header: function (row) {
            var data = row.data();
            return 'Details for ' + data.songname;
          },
        }),
      },
    },
  });
}

$(document).ready(async function () {
  var music_db;
  $.getJSON('static/asset/json/music_db.json', function (json) {
    music_db = json;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'static/asset/json/custom_music_db.json', false);
      xhr.send();
      if (xhr.status === 200) {
        var custom = JSON.parse(xhr.responseText);
        if (custom && custom.mdb && custom.mdb.music)
          music_db.mdb.music = music_db.mdb.music.concat(custom.mdb.music);
      }
    } catch (e) {}
  });

  rivals_data = JSON.parse(document.getElementById('rivals-pass').innerText);
  profiles_data = JSON.parse(document.getElementById('profiles-pass').innerText);

  your_profile_data = JSON.parse(document.getElementById('profile-pass').innerText);
  urlParams = new URLSearchParams(window.location.search);
  currentVersion =
    urlParams.has('version') && urlParams.get('version') !== ''
      ? parseInt(urlParams.get('version'))
      : your_profile_data[your_profile_data.length - 1].version;
  currentProfile = your_profile_data.find(p => p.version === currentVersion);
  refid = currentProfile.__refid;

  // ── Defensive profile lookup ──────────────────────────────────────────
  // A rival entry can outlive the profile it points at: if the rival's
  // profile gets deleted (or saved at a different version with no row at
  // the current version), `profiles_data.filter(...)[0]` returns undefined.
  // The previous code blindly dereferenced `.name`, which threw mid-loop
  // and bricked the whole rivals tab — the dropdown ended up empty and
  // nothing could be selected. Treat that case as an orphan: keep the
  // entry visible so the user can remove it, but stub the name in.
  function profileForRefid(rivalRefid, version) {
    var match = profiles_data.find(
      p => p.__refid === rivalRefid && (version == null || p.version === version)
    );
    if (match) return match;
    // Fall back to any version of that refid — the profile still exists,
    // just not at the current version.
    return profiles_data.find(p => p.__refid === rivalRefid) || null;
  }

  function rivalDisplayName(rival) {
    var prof = profileForRefid(rival.refid, currentVersion);
    if (prof && prof.name) return prof.name;
    // Last resort: whatever was stored on the rival doc when it was
    // created. Stale, but better than "undefined".
    if (rival.name) return rival.name + ' (profile missing)';
    return '(unknown profile)';
  }

  function formatSdvxId(id) {
    if (id == null) return '';
    var padded = String(id).padStart(8, '0');
    return padded.slice(0, 4) + '-' + padded.slice(4);
  }

  // Filter to rivals on the current version only. Entries from other
  // versions are stored in the same collection and shouldn't pollute the
  // UI for the version you're browsing.
  function rivalsForVersion() {
    return rivals_data.filter(r => r.version === currentVersion);
  }

  profiles_data_filtered = profiles_data.filter(
    p =>
      p.__refid !== refid &&
      rivals_data.filter(r => refid === p.__refid && r.version === currentVersion).length === 0
  );
  for (var p of your_profile_data) {
    $('#version_select').append(
      $('<option>', {
        value: p.version,
        text: versionText[p.version],
        selected: p.version === currentVersion,
      })
    );
  }

  for (let ind in profiles_data_filtered) {
    if (profiles_data_filtered[ind].__refid !== refid) {
      $('#profilelist').append(
        $('<option>', {
          value: profiles_data_filtered[ind].__refid,
          text: profiles_data_filtered[ind].name,
        })
      );
    }
  }

  // Populate the compare-with dropdown using defensive name lookups so a
  // single bad entry doesn't kill the whole list.
  rivalsForVersion().forEach(function (rival) {
    $('#rivallist').append(
      $('<option>', {
        value: rival.refid,
        text: rivalDisplayName(rival),
      })
    );
  });

  // ── "Your Rivals" list ─────────────────────────────────────────────────
  function renderRivalsList() {
    var list = rivalsForVersion();
    var $body = $('#rivals-list-body').empty();
    if (list.length === 0) {
      $('#rivals-empty').show();
      $('#rivals-list-table').hide();
      return;
    }
    $('#rivals-empty').hide();
    $('#rivals-list-table').show();

    list.forEach(function (rival) {
      var prof = profileForRefid(rival.refid, currentVersion);
      var isOrphan = !prof || !prof.name;
      var $row = $('<tr>');
      $row.append($('<td>').text(formatSdvxId(rival.sdvxID || (prof && prof.id) || '')));
      var $name = $('<td>').text(rivalDisplayName(rival));
      if (isOrphan) {
        $name.append(
          $('<span class="tag is-warning is-light ml-2" style="margin-left:0.5em">orphan</span>')
        );
      }
      $row.append($name);
      $row.append(
        $('<td>').html(
          rival.mutual
            ? '<span class="tag is-success is-light">Mutual</span>'
            : '<span class="tag is-light">One-way</span>'
        )
      );
      var $btn = $('<button class="button is-small is-danger is-light">Remove</button>')
        .on('click', function () { removeRival(rival.refid); });
      $row.append($('<td>').append($btn));
      $body.append($row);
    });
  }
  renderRivalsList();

  // ── Status banner ──────────────────────────────────────────────────────
  // Replaces the previous alert() popups. Auto-dismisses after a few
  // seconds for success messages; errors stay until the next action.
  var bannerTimer = null;
  function showBanner(kind, message) {
    var $b = $('#rival-status-banner')
      .removeClass()
      .addClass('notification is-' + kind)
      .empty();
    var $delete = $('<button class="delete">').on('click', function () {
      $b.hide();
    });
    $b.append($delete).append(document.createTextNode(message)).show();
    if (bannerTimer) clearTimeout(bannerTimer);
    if (kind !== 'danger' && kind !== 'warning') {
      bannerTimer = setTimeout(function () { $b.fadeOut(400); }, 6000);
    }
  }

  // ── Add / remove flows ─────────────────────────────────────────────────
  // The server's `addRival` event toggles add/remove based on whether the
  // rival exists. We expose two button entrypoints (the Add/Remove toggle
  // on the form and a per-row Remove button on the list) but both go
  // through the same handler — we just frame the message to the user
  // based on what was supposed to happen.
  function reloadAfter(delayMs) {
    setTimeout(function () { location.reload(); }, delayMs);
  }

  async function addRivalRequest(rivalRefid, expectedAction) {
    try {
      var response = await emit('addRival', {
        rivalId: rivalRefid,
        refid: refid,
        version: currentVersion,
      });
      var d = response && response.data;
      if (!d) {
        showBanner('danger', 'Server returned no response. Please try again.');
        return;
      }
      if (d.success === false || d.error) {
        showBanner('danger', d.error || d.msg || 'Operation failed.');
        return;
      }
      // Backwards compat: handler used to send only { msg }. Treat a
      // present msg without explicit success as a soft success.
      var action = d.action || expectedAction || 'changed';
      var msg = d.msg ||
        (action === 'added' ? 'Rival added.' :
         action === 'removed' ? 'Rival removed.' :
         'Rival list updated.');
      showBanner(action === 'removed' ? 'info' : 'success', msg);
      reloadAfter(800);
    } catch (err) {
      showBanner('danger', 'Network error: ' + (err && err.message ? err.message : err));
    }
  }

  function removeRival(rivalRefid) {
    addRivalRequest(rivalRefid, 'removed');
  }

  $('#profilelist').change(function () {
    var picked = $('#profilelist').val();
    var alreadyRival = rivals_data.some(
      r => r.refid === picked && r.version === currentVersion
    );
    $('#rival-button').text(alreadyRival ? 'Delete Rival' : 'Add Rival');
  });

  $('#rivallist').change(async function () {
    $('#scorecompare').DataTable().clear().destroy();
    if ($('#rivallist').val() === '0') return;
    try {
      var response = await emit('getRivalScores', {
        rivalId: $('#rivallist').val(),
        refid: refid,
        version: currentVersion,
      });
      if (!response || !response.data) {
        showBanner('danger', 'Could not load rival scores.');
        return;
      }
      if (response.data.error) {
        showBanner('danger', response.data.error);
        return;
      }
      populateTable(response.data.yourScores, response.data.rivalScores, music_db);
    } catch (err) {
      showBanner('danger', 'Failed to load rival scores: ' + err.message);
    }
  });

  $('#addrival').click(function () {
    var picked = $('#profilelist').val();
    if (!picked || picked === '0') {
      showBanner('warning', 'Pick a profile from the dropdown first.');
      return;
    }
    var alreadyRival = rivals_data.some(
      r => r.refid === picked && r.version === currentVersion
    );
    addRivalRequest(picked, alreadyRival ? 'removed' : 'added');
  });

  $('#version_select').change(function () {
    const urlParams = new URLSearchParams(location.search);
    urlParams.set('version', $('#version_select').val());
    location.search = urlParams;
  });
});
