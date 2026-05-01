// data\graphics\game_nemsys -- nemsys
// data\graphics\ap_card -- appeal card
// data\graphics\submonitor_bg -- subbg
$(document).ready(async function() {
    $('.collapse').click(function(){
        console.log($('.collapsible-card').css('display'))
        if($('.collapsible-card').css('display') == 'none') {
            $('.collapsible-card').css('display', 'block')
        } else $('.collapsible-card').css('display', 'none')
    })
    
    $( "#updateResources" ).click(async function() {
        document.getElementById("logtextarea").textContent = ''
        
        document.getElementById("logtextarea").textContent += 'NOTE:\n- For converting s3p files to mp3, check guide in the notes section above.\n'
        document.getElementById("logtextarea").textContent += '- When running asphyxia in dev mode, you should see copy logs and/or errors on the console in realtime.\n\n'

        document.getElementById("logtextarea").textContent += 'Running....\n\n'
        await emit("copyResourcesFromGame").then(
            function(response){
                document.getElementById("logtextarea").textContent += 'Done.\n\n'
                if(response['data']['errors'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[Errors]" + '\n'
                    $.each(response['data']['errors'], function(key, val) {
                        document.getElementById("logtextarea").textContent += val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\nIf you\'re getting "error reading" logs, check if you\'ve configured "Exceed Gear Data Directory" properly in the plugin settings.\n'
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['course']) {
                    document.getElementById("logtextarea").textContent += "[Skill Analyzer courses]" + '\n'
                    document.getElementById("logtextarea").textContent += "Updated course_data.json from data/exg.ts!"
                }
                document.getElementById("logtextarea").textContent += '\n\n\n'

                if(response['data']['jsonSongs'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[Songs]" + '\n'
                    $.each(response['data']['jsonSongs'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val[1] + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['infSongs'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[INF charts]" + '\n'
                    $.each(response['data']['infSongs'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val[1] + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['ultSongs'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[ULT charts]" + '\n'
                    $.each(response['data']['ultSongs'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val[1] + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['nemsys'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[NEMSYS]" + '\n'
                    $.each(response['data']['nemsys'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " + val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['bgm'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[BGM]" + '\n'
                    $.each(response['data']['bgm'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['apCard'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[Appeal cards]" + '\n'
                    $.each(response['data']['apCard'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['subbg'].length > 0) {                        
                    document.getElementById("logtextarea").textContent += "[Submonitor BGs]" + '\n'
                    $.each(response['data']['subbg'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }


                if(response['data']['chatStamp'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[Appeal Stamps]" + '\n'
                    $.each(response['data']['chatStamp'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }


                if(response['data']['valgeneItemFiles'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[valgene_item]" + '\n'
                    $.each(response['data']['valgeneItemFiles'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['akaname'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[Appeal titles]" + '\n'
                    $.each(response['data']['akaname'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }

                if(response['data']['ifs'].length > 0) {
                    document.getElementById("logtextarea").textContent += "[IFS textures]" + '\n'
                    $.each(response['data']['ifs'], function(key, val) {
                        document.getElementById("logtextarea").textContent += "- " +  val + '\n'
                    })
                    document.getElementById("logtextarea").textContent += '\n\n'
                }
            }
        )
    });

    // Extract Jackets button — runs the extractJackets WebUI event which
    // shells out to ifstools on the server. Live progress goes to the
    // server console (streamPrefix '[ifstools]'); the page just shows a
    // running status and the per-archive summary when the run finishes.
    var $jacketLog = document.getElementById('jacketlog');
    function jlog(line) { if ($jacketLog) $jacketLog.textContent += line + '\n'; }

    $('#extractJackets').click(async function () {
        var $btn = $('#extractJackets');
        if ($jacketLog) $jacketLog.textContent = '';
        jlog('Running ifstools on every s_jacket*.ifs in the configured game directory.');
        jlog('This can take 30-60 seconds per archive — see the asphyxia console for live ifstools output.\n');

        $btn.prop('disabled', true).addClass('is-loading');
        try {
            var response = await emit('extractJackets');
            var data = response && response.data;
            if (!data) {
                jlog('No response from server.');
                return;
            }

            var archives = data.archives || [];
            if (archives.length === 0 && (!data.errors || data.errors.length === 0)) {
                jlog('No s_jacket*.ifs files found in the configured game directory.');
            }

            archives.forEach(function (a) {
                var prefix = a.ok ? '[OK]   ' : '[FAIL] ';
                jlog(prefix + a.name + '  —  ' + a.message);
            });

            if (data.errors && data.errors.length > 0) {
                jlog('\nErrors:');
                data.errors.forEach(function (e) { jlog('- ' + e); });
            }

            var statusMsg =
                data.status === 'ok' ? '\nDone. Reload the VF Top 50 page to see jackets.' :
                data.status === 'partial' ? '\nDone with errors. Some archives extracted, see above.' :
                '\nFailed.';
            jlog(statusMsg);
        } catch (err) {
            jlog('Network / event error: ' + (err && err.message ? err.message : err));
        } finally {
            $btn.prop('disabled', false).removeClass('is-loading');
        }
    });
})