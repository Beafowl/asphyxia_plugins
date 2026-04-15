var currentVersion, currentProfile
var versionText = ['', 'BOOTH', 'INFINTE INFECTION', 'GRAVITY WARS', 'HEAVENLY HAVEN', 'VIVIDWAVE', 'EXCEED GEAR', '∇']

function zeroPad(num, places) {
    var zero = places - num.toString().length + 1;
    return Array(+(zero > 0 && zero)).join("0") + num;
}

function getImageFileFormat(assetType, id) {
    return '.png'
}

function getStampSrc(stamp) {
    if (stamp == 0 || stamp == null) return "static/asset/nostamp.png";
    var group = Math.trunc((stamp - 1) / 4 + 1);
    var item = stamp % 4;
    if (item == 0) item = 4;
    return "static/asset/chat_stamp/stamp_" + zeroPad(group, 4) + "/stamp_" + zeroPad(group, 4) + "_" + zeroPad(item, 2) + ".png";
}

function getNemsysSrc(val, version) {
    if (val == 30) return "static/asset/nemsys/nemsys_aprilfool.png";
    var nem = (version === 7 && val === 0) ? 47 : val;
    return "static/asset/nemsys/nemsys_" + zeroPad(nem, 4) + ".png";
}

function getSubbgSrc(val, type) {
    if (type === 'video') return null; // handled separately
    if (type === 'slideshow') {
        return "static/asset/submonitor_bg/subbg_" + zeroPad(val, 4) + "_0" + (Math.floor(Math.random() * 3) + 1) + getImageFileFormat(0, parseInt(zeroPad(val, 4)));
    }
    return "static/asset/submonitor_bg/subbg_" + zeroPad(val, 4) + getImageFileFormat(0, parseInt(zeroPad(val, 4)));
}

// Change handlers — only load the single selected asset on demand

$('#nemsys_select').change(function() {
    $('#nemsys_pre').fadeOut(200, function() {
        $(this).attr("src", getNemsysSrc(parseInt($('#nemsys_select').val()), currentVersion));
    });
    $('#nemsys_pre').fadeIn(200);
});

$('[name="subbg"]').change(function() {
    var val = parseInt($(this).val());
    var entry = database['subbg'].filter(function(e) { return e.value === val; })[0];
    var subbgType = entry ? entry.type : 'normal';
    $('#sub_pre').fadeOut(200);
    $('#sub_pre_vid').fadeOut(200);
    if (subbgType === 'video') {
        $('#sub_pre_vid_src').attr('src', "static/asset/submonitor_bg/subbg_" + zeroPad(val, 4) + '.mp4');
        document.getElementById('sub_pre_vid').load();
        $('#sub_pre_vid').fadeIn(200);
    } else {
        $('#sub_pre').fadeOut(200, function() {
            $(this).attr("src", getSubbgSrc(val, subbgType));
        });
        $('#sub_pre').fadeIn(200);
    }
});

$('[name="bgm"]').change(function() {
    var val = $(this).val();
    if (val == 99) {
        $('#custom_0').attr("src", "static/asset/audio/special_00/0.mp3");
        $('#custom_1').attr("src", "static/asset/audio/custom_00/1.mp3");
    } else {
        $('#custom_0').attr("src", "static/asset/audio/custom_" + zeroPad(val, 2) + "/0.mp3");
        $('#custom_1').attr("src", "static/asset/audio/custom_" + zeroPad(val, 2) + "/1.mp3");
    }
    $('#custom_0').prop("volume", 0.5);
    $('#custom_1').prop("volume", 0.2);

    $('#play_sel').animate({ 'opacity': 0 }, 200, function() {
        $(this).text('Play').animate({ 'opacity': 1 }, 200);
    });
    play_sel = false;
    $('#play_bgm').animate({ 'opacity': 0 }, 200, function() {
        $(this).text('Play').animate({ 'opacity': 1 }, 200);
    });
    play_bgm = false;
});

// Stamp change handlers — use shared helper
var stampFields = ['stampA', 'stampB', 'stampC', 'stampD', 'stampRA', 'stampRB', 'stampRC', 'stampRD'];
var stampPreviews = { stampA: '#a_pre', stampB: '#b_pre', stampC: '#c_pre', stampD: '#d_pre', stampRA: '#ra_pre', stampRB: '#rb_pre', stampRC: '#rc_pre', stampRD: '#rd_pre' };

stampFields.forEach(function(field) {
    $('[name="' + field + '"]').change(function() {
        var previewEl = $(stampPreviews[field]);
        previewEl.fadeOut(200, function() {
            $(this).attr("src", getStampSrc(parseInt($('[name="' + field + '"]').val())));
        });
        previewEl.fadeIn(200);
    });
});

var profile_data, database;
var play_bgm = false;
var play_sel = false;

$(document).ready(function() {
    profile_data = JSON.parse(document.getElementById("data-pass").innerText);
    var urlParams = new URLSearchParams(window.location.search);
    currentVersion = (urlParams.has('version') && urlParams.get('version') !== "") ? parseInt(urlParams.get('version')) : profile_data[profile_data.length - 1].version;
    currentProfile = profile_data.find(function(p) { return p.version === currentVersion; });
    $('[name="version"]').val(currentVersion);

    var items_crew = JSON.parse(document.getElementById("data-pass-crew").innerText);
    var items_stamp = JSON.parse(document.getElementById("data-pass-stamp").innerText).filter(function(i) { return i.version === currentVersion; });
    var items_subbg = JSON.parse(document.getElementById("data-pass-subbg").innerText).filter(function(i) { return i.version === currentVersion; });
    var items_bgm = JSON.parse(document.getElementById("data-pass-bgm").innerText).filter(function(i) { return i.version === currentVersion; });
    var items_nemsys = JSON.parse(document.getElementById("data-pass-nemsys").innerText).filter(function(i) { return i.version === currentVersion; });
    var items_sysbg = JSON.parse(document.getElementById("data-pass-sysbg").innerText).filter(function(i) { return i.version === currentVersion; });
    var valgene_ticket = JSON.parse(document.getElementById("data-pass-valgeneticket").innerText);
    var courses = JSON.parse(document.getElementById("data-pass-courses").innerText).filter(function(i) { return i.version === currentVersion; });
    var skill = JSON.parse(document.getElementById("data-pass-skill").innerText).filter(function(i) { return i.version === currentVersion; });
    var unlock_all = (document.getElementById("data-pass-unlock-all").innerText === 'true');

    for (var p of profile_data) {
        $('#version_select').append($('<option>', {
            value: p.version,
            text: versionText[p.version],
            selected: (p.version === currentVersion)
        }));
    }

    // Load customize_data_ext.json first, then data.json (single load)
    $.getJSON("static/asset/json/customize_data_ext.json", function(extJson) {
        database = extJson;

        $('[name="name"]').attr('placeholder', currentProfile.name);
        $('[name="appeal"]').attr('placeholder', currentProfile.appeal);

        for (var i in extJson["supportTeams"]) {
            $('[name="bplSupport"]').append($('<option>', {
                value: extJson["supportTeams"][i].id,
                text: extJson["supportTeams"][i].name,
            }));
        }
        var bplSupport = currentProfile["bplSupport"] ? currentProfile["bplSupport"] % 10 : 0;
        $('[name="bplSupport"]').val(bplSupport);
        if (currentProfile["bplSupport"] >= 10) $('[name="bplPro"]').attr('checked', true);

        for (var i in extJson["sysbg"]) {
            if (unlock_all || (items_sysbg.find(function(x) { return x.id === extJson["sysbg"][i].id; }) || extJson["sysbg"][i].id === 0)) {
                $('[name="sysBG"]').append($('<option>', {
                    value: extJson["sysbg"][i].id,
                    text: extJson["sysbg"][i].name,
                }));
            }
        }
        $('[name="sysBG"]').val(currentProfile["sysBG"] ? currentProfile["sysBG"] : 0);

        for (var i in extJson["skilltitle"]) {
            var foundCourses = courses.filter(function(c) { return c.cid === extJson["skilltitle"][i].id && c.clear >= 2; });
            if (foundCourses.length > 0) {
                $('[name="skilltitle"]').append($('<option>', {
                    value: extJson["skilltitle"][i].id,
                    text: extJson["skilltitle"][i].name + ' (' + extJson["skilltitle"][i].info + ')',
                }));
            }
        }
        if (skill.length > 1) $('[name="skilltitle"]').val(skill[0]["name"]);
        else $('[name="skilltitle"]').attr('disabled', 'disabled');

        for (var i in extJson["appeal_frame"]) {
            $('[name="creatorItem"]').append($('<option>', {
                value: extJson["appeal_frame"][i].id,
                text: extJson["appeal_frame"][i].name,
            }));
        }
        $('[name="creatorItem"]').val(currentProfile["creatorItem"] ? currentProfile["creatorItem"] : 1);

        // Load data.json ONCE — populate dropdowns without preloading assets
        $.getJSON("static/asset/json/data.json", function(json) {
            database = json;

            // Nemsys — populate dropdown only
            for (var i in json["nemsys"]) {
                if (![8, 9, 10, 11, 47].includes(json["nemsys"][i].value) && (unlock_all || (json["nemsys"][i].value === 0 || items_nemsys.find(function(x) { return x.id === json["nemsys"][i].value; })))) {
                    $('#nemsys_select').append($('<option>', {
                        value: json["nemsys"][i].value,
                        text: json["nemsys"][i].name + ((json["nemsys"][i].value == '0') ? (currentVersion === 7 ? 'NABLA' : 'EXCEED') : ''),
                    }));
                }
            }
            $('#nemsys_select').val(currentProfile["nemsys"]);

            // Subbg — populate dropdown only
            for (var i in json["subbg"]) {
                if (unlock_all || (json["subbg"][i].value === 0 || items_subbg.find(function(x) { return x.id === json["subbg"][i].value; }))) {
                    $('[name="subbg"]').append($('<option>', {
                        value: json["subbg"][i].value,
                        type: json["subbg"][i].type,
                        text: json["subbg"][i].name,
                    }));
                }
            }
            $('[name="subbg"]').val(currentProfile["subbg"]);

            // BGM — populate dropdown only
            for (var i in json["bgm"]) {
                if (unlock_all || (json["bgm"][i].value === 0 || items_bgm.find(function(x) { return parseInt(x.id) === parseInt(json["bgm"][i].value); }))) {
                    $('[name="bgm"]').append($('<option>', {
                        value: json["bgm"][i].value,
                        text: json["bgm"][i].name,
                    }));
                }
            }
            $('[name="bgm"]').val(currentProfile["bgm"]);

            // Akaname
            for (var i in json["akaname"]) {
                $('[name="akaname"]').append($('<option>', {
                    value: json["akaname"][i].value,
                    text: json["akaname"][i].value + " - " + json["akaname"][i].name,
                }));
            }
            $('[name="akaname"]').val(currentProfile["akaname"]);

            var ticketNum = (valgene_ticket !== null) ? valgene_ticket.ticketNum : 0;
            $('[name="valgeneTicket"]').val(ticketNum);

            // Stamps — populate all 8 dropdowns, no image preloading
            for (var i in json["stamp"]) {
                if (unlock_all || (json["stamp"][i].value === 0 || items_stamp.find(function(x) { return x.id === json["stamp"][i].value; }))) {
                    stampFields.forEach(function(field) {
                        $('[name="' + field + '"]').append($('<option>', {
                            value: json["stamp"][i].value,
                            text: json["stamp"][i].name,
                        }));
                    });
                }
            }

            // Set stamp dropdown values
            stampFields.forEach(function(field) {
                $('[name="' + field + '"]').val(currentProfile[field]);
            });

            // Now set initial previews for currently-selected items only

            // Nemsys preview
            $('#nemsys_pre').attr("src", getNemsysSrc(currentProfile["nemsys"], currentVersion));

            // Subbg preview
            var subbgEntry = json['subbg'].filter(function(e) { return e.value === parseInt(currentProfile["subbg"]); })[0];
            var subbgType = subbgEntry ? subbgEntry.type : 'normal';
            $('#sub_pre').hide();
            $('#sub_pre_vid').hide();
            if (subbgType === 'video') {
                $('#sub_pre_vid').empty().append(
                    $("<source id='sub_pre_vid_src' src='static/asset/submonitor_bg/subbg_" + zeroPad(currentProfile["subbg"], 4) + ".mp4'>")
                );
                $('#sub_pre_vid').fadeIn(200);
            } else {
                $('#sub_pre').attr("src", getSubbgSrc(currentProfile["subbg"], subbgType));
                $('#sub_pre').fadeIn(200);
            }

            // BGM audio (only the selected one)
            if (currentProfile["bgm"] == 99) {
                $('#custom_0').attr("src", "static/asset/audio/special_00/0.mp3");
                $('#custom_1').attr("src", "static/asset/audio/custom_00/1.mp3");
            } else {
                $('#custom_0').attr("src", "static/asset/audio/custom_" + zeroPad(currentProfile["bgm"], 2) + "/0.mp3");
                $('#custom_1').attr("src", "static/asset/audio/custom_" + zeroPad(currentProfile["bgm"], 2) + "/1.mp3");
            }
            $('#custom_0').prop("volume", 0.5);
            $('#custom_1').prop("volume", 0.2);

            // Stamp previews (only the selected ones)
            stampFields.forEach(function(field) {
                $(stampPreviews[field]).attr("src", getStampSrc(currentProfile[field]));
            });

            // Build play buttons for BGM/selection
            $('#bgm_pre').append(
                $('<div class="buttons">').append(
                    $('<button class="button is-primary" type="button" id="play_bgm">')
                    .append("Play")
                    .click(function() {
                        if (play_bgm) {
                            $('#custom_0').trigger('pause');
                            $('#play_bgm').animate({ 'opacity': 0 }, 200, function() {
                                $(this).text('Play').animate({ 'opacity': 1 }, 200);
                            });
                            play_bgm = false;
                        } else {
                            $('#custom_0').trigger('play');
                            $('#play_bgm').animate({ 'opacity': 0 }, 200, function() {
                                $(this).text('Pause').animate({ 'opacity': 1 }, 200);
                            });
                            play_bgm = true;
                        }
                    })
                )
            );

            $('#sel_pre').append(
                $('<div class="buttons">').append(
                    $('<button class="button is-primary" type="button" id="play_sel">')
                    .append("Play")
                    .click(function() {
                        if (play_sel) {
                            $('#custom_1').trigger('pause');
                            $('#play_sel').animate({ 'opacity': 0 }, 200, function() {
                                $(this).text('Play').animate({ 'opacity': 1 }, 200);
                            });
                            play_sel = false;
                        } else {
                            $('#custom_1').trigger('play');
                            $('#play_sel').animate({ 'opacity': 0 }, 200, function() {
                                $(this).text('Pause').animate({ 'opacity': 1 }, 200);
                            });
                            play_sel = true;
                        }
                    })
                )
            );

            $('#custom_0').on('ended', function() {
                this.currentTime = 0;
                $('#play_bgm').animate({ 'opacity': 0 }, 200, function() {
                    $(this).text('Play').animate({ 'opacity': 1 }, 200);
                });
                play_bgm = false;
            });

            $('#custom_1').on('ended', function() {
                this.currentTime = 0;
                $('#play_sel').animate({ 'opacity': 0 }, 200, function() {
                    $(this).text('Play').animate({ 'opacity': 1 }, 200);
                });
                play_sel = false;
            });

            $('#custom_0').on('timeupdate', function() {
                var currentTime = parseInt($('#custom_0').prop('currentTime'));
                var duration = parseInt($('#custom_0').prop('duration'));
                var percent = currentTime / duration * 100;
            });

            $('#custom_1').on('timeupdate', function() {
                var currentTime = parseInt($('#custom_1').prop('currentTime'));
                var duration = parseInt($('#custom_1').prop('duration'));
                var percent = currentTime / duration * 100;
            });
        });
    });

    $('#version_select').change(function() {
        var urlParams = new URLSearchParams(location.search);
        urlParams.set('version', $('#version_select').val());
        location.search = urlParams;
    });
});
