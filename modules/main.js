import * as EQGraph from './eq-graph.js';
import * as EQMath from './eq-math.js';
import * as Visualizer from './visualizer.js';
import * as Presets from './presets.js';

let isFirstLoad = true;
const PRO_LIMIT = 5;
const MAX_PRESETS = null; // No hard limit by default

document.addEventListener("DOMContentLoaded", () => {
    initUI();
    initMessaging();

    // Refresh state
    chrome.runtime.sendMessage({ type: "onPopupOpen" });
    chrome.runtime.sendMessage({ type: "getFullRefresh" });

    // NOTE: Don't auto-capture on popup open - wait for user to click "EQ This Tab"
    // The workspace status message will tell us if we're already streaming

    // Check initial visualizer state
    Visualizer.init(null);
    if (Visualizer.isVisualizerOn()) {
        Visualizer.startOrStopVisualizer();
    }

    // EQ Graph callbacks
    EQGraph.init({
        onGainChangeStart: () => { },
        onGainChange: (gain) => {
            chrome.runtime.sendMessage({ type: "modifyGain", gain: gain });
        },
        onGainChangeEnd: (gain) => {
            chrome.runtime.sendMessage({ type: "gainUpdated", gain: gain });
        },
        onFilterChange: (index, freq, gain, q, type) => {
            chrome.runtime.sendMessage({
                type: "modifyFilter",
                index: index,
                frequency: freq,
                gain: gain,
                q: q
            });
        },
        onFilterChangeEnd: (index, freq, gain, q, type) => {
            chrome.runtime.sendMessage({
                type: "filterUpdated",
                filterType: type,
                frequency: freq,
                gain: gain,
                q: q
            });
        },

        onResetFilter: (index) => {
            chrome.runtime.sendMessage({ type: "resetFilter", index: index });
        },
        onRefresh: () => {
            chrome.runtime.sendMessage({ type: "getFullRefresh" });
        }
    });

    // Start refresh loop
    refreshLoop();
});

function refreshLoop() {
    if (isFirstLoad) {
        chrome.runtime.sendMessage({ type: "getFullRefresh" });
        setTimeout(refreshLoop, 1000);
    }
}

function initMessaging() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === "sendCurrentTabStatus") {
            if (msg.streaming) {
                uiSetStopEq();
                if (Visualizer.isVisualizerOn()) {
                    Visualizer.startOrStopVisualizer();
                }
            } else {
                uiSetStartEq();
            }
        }
        else if (msg.type === "fftData") {
            if (msg.limiterReduction !== undefined) {
                updateLimiterIndicator(msg.limiterReduction);
            }
            if (msg.sbrActive) {
                document.getElementById('sbrIndicator').classList.add('active');
            } else {
                document.getElementById('sbrIndicator').classList.remove('active');
            }
        }
        else if (msg.type === "sendWorkspaceStatus") {
            isFirstLoad = false;
            updateWorkspace(msg);
            if (msg.qualityMode) updateQualityModeUI(msg.qualityMode);
        }
        else if (msg.type === "sendSampleRate") {
            EQGraph.setSampleRate(msg.Fs);
            console.log("Set sample rate to " + msg.Fs);
        }
        else if (msg.type === "wasmError") {
            showMessage(msg.message || "WASM DSP failed to load.");
        }
    });
}

function updateWorkspace(data) { // J
    // Convert filters format manually or trust passing?
    // Original converts `eqFilters` array to internal object format.
    // My `EQGraph.drawEQ` expects array of objects with {x, y, gain, frequency, q, t}.

    // I need to map data.eqFilters to this format!
    // Original `J` does exactly this: `s.push(r)` where `r` has x,y,w,t,gain,q,frequency.

    const rawFilters = data.eqFilters || [];
    const filters = rawFilters.map(f => {
        if (!f) return null;
        return {
            x: EQMath.freqToX(f.frequency || 1000),
            y: EQMath.gainToY(f.gain || 0),
            w: (f.frequency || 1000) / (f.q || 1), // w unused?
            t: f.type || 'peaking',
            gain: f.gain || 0,
            q: f.q || 1,
            frequency: f.frequency || 1000
        };
    }).filter(f => f !== null);

    const gainVal = (data.gain !== undefined) ? data.gain : 1;
    // Wait, original: `i.gain = e.gain || 1; i.y = F(fe(i.gain));`
    // `e.gain` seems to be linear gain (1.0 = 0dB).
    // `fe(i.gain)` converts to dB.
    // So `EQGraph.init` expects object `{y: ..., gain: ...}`.

    const gainObj = {
        gain: gainVal,
        y: EQMath.gainToY(EQMath.gainToDb(gainVal))
    };

    EQGraph.drawEQ(filters, gainObj);

    // Also update tabs list
    updateTabsList(data.streams || []);

    // Update Settings UI
    updateSettingsUI(data);

    // Update Presets UI (and check for match)
    if (data.presets && data.eqFilters) {
        // Convert eqFilters back to normalized form for comparison if needed?
        // No, eqFilters in data comes from SW in format:
        // { frequency, gain, type, q }
        // updatePresetsUI expects array of objects with {frequency, gain, q}.
        // data.eqFilters should work directly.
        Presets.updatePresetsUI(data.presets, (name, presetData) => {
            chrome.runtime.sendMessage({
                type: "preset",
                preset: name,
                presetData: presetData
            });
            // UI update handled by re-render via updatePresetsUI logic on next status
            // But we can also proactively set input here if we want immediate feedback
            // though the function clears input.
            // Wait, clicking option calls onPresetClick.
            // And sets input.value in presets.js onchange handler.
        }, data.eqFilters, gainVal);
    }
}

function updateTabsList(streams) {
    const container = document.getElementById("eqTabList");
    container.innerHTML = "";

    if (streams.length === 0) {
        container.innerHTML = `
            <div class="empty-tabs-message">
                No tabs active. Click <b>EQ This Tab</b> to start.
            </div>`;
        return;
    }

    streams.forEach(stream => {
        const row = document.createElement("div");
        row.className = "tab-row";

        // Info container (icon + title)
        const info = document.createElement("div");
        info.className = "tab-info";

        const img = document.createElement("img");
        img.className = "tab-favicon";
        img.src = stream.favIconUrl || 'assets/juraganaudio16.png';
        img.alt = "";

        const title = document.createElement("span");
        title.className = "tab-title";
        title.textContent = stream.title.length > 50 ? stream.title.substring(0, 50) + "..." : stream.title;
        title.title = stream.title;

        info.appendChild(img);
        info.appendChild(title);

        // Actions container
        const actions = document.createElement("div");
        actions.className = "tab-actions";

        const btn = document.createElement("button");
        btn.className = "stop-eq-btn";
        btn.textContent = "Stop EQ";
        btn.onclick = () => {
            chrome.runtime.sendMessage({ type: "disconnectTab", tab: stream });
        };

        actions.appendChild(btn);

        row.appendChild(info);
        row.appendChild(actions);
        container.appendChild(row);
    });
}

function initUI() {
    // EQ This Tab Button Default (in case message delays)
    document.getElementById("eqTabButton").onclick = setupTabCapture;

    // Preset Input
    const presetInput = document.getElementById("presetNameInput");
    const saveBtn = document.getElementById("savePresetButton");

    // Reset Filters
    document.getElementById("resetFiltersButton").onclick = () => {
        presetInput.value = "";
        chrome.runtime.sendMessage({ type: "resetFilters" });
    };

    // Bass Boost
    document.getElementById("bassBoostButton").onclick = () => {
        presetInput.value = "";
        chrome.runtime.sendMessage({ type: "preset", preset: "bassBoost" });
    };

    // Save Preset
    saveBtn.onclick = () => {
        const name = presetInput.value.trim();
        // MAX_PRESETS check removed
        if (name !== "") {
            chrome.runtime.sendMessage({ type: "savePreset", preset: name });
            showMessage("Preset '" + name + "' saved.");
        } else {
            showMessage("Type a name in the Preset Name box, then click Save Preset or press Enter.");
            presetInput.focus();
        }
    };

    // Delete Preset
    document.getElementById("deletePresetButton").onclick = () => {
        const name = presetInput.value.trim();
        if (name !== "") {
            chrome.runtime.sendMessage({ type: "deletePreset", preset: name });
            showMessage("Preset '" + name + "' deleted.");
        }
    };

    // Enter key support
    presetInput.onkeypress = (e) => {
        if (!e) e = window.event;
        if ((e.keyCode || e.which) == 13) {
            saveBtn.click();
            return false;
        }
    };

    // Export/Import
    document.getElementById("exportPresetsButton").onclick = () => {
        const name = document.getElementById("presetNameInput").value.trim();
        Presets.exportPresets(name).then(success => {
            if (!success) showMessage("No presets to export.");
        }).catch(err => {
            console.error("Export failed:", err);
            showMessage("Export failed: " + err);
        });
    };

    const fileInput = document.getElementById("importPresetsFile");
    document.getElementById("importPresetsButton").onclick = () => fileInput.click();

    fileInput.onchange = () => {
        for (let i = 0; i < fileInput.files.length; i++) {
            Presets.importPresets(fileInput.files[i], (presets) => {
                chrome.runtime.sendMessage({
                    type: "importPresets",
                    presets: presets
                });
            });
        }
    };

    // Visualizer Toggle
    const vizBtn = document.getElementById("vizButton");

    // Set initial state class
    if (Visualizer.isVisualizerOn()) vizBtn.classList.add("on");

    vizBtn.onclick = () => {
        // MAX_PRESETS check removed
        const isOn = Visualizer.toggleVisualizer();
        if (isOn) vizBtn.classList.add("on");
        else vizBtn.classList.remove("on");
    };

    // Quality Mode
    const qualitySelect = document.getElementById("qualityModeSelect");
    qualitySelect.onchange = function () {
        const mode = this.value;
        chrome.runtime.sendMessage({ type: "setQualityMode", mode: mode });
        updateQualityModeUI(mode);
    };

    // Tabs
    ["tab-1", "tab-2", "tab-3"].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener("change", function () {
            if (this.checked) localStorage["last-tab"] = id;
        });
    });

    // Theme Toggle
    const themeBtn = document.getElementById("themeToggle");
    const body = document.body;

    // Load saved theme
    if (localStorage["theme"] === "light") {
        body.classList.add("light-mode");
    }

    themeBtn.onclick = () => {
        body.classList.toggle("light-mode");
        const isLight = body.classList.contains("light-mode");
        localStorage["theme"] = isLight ? "light" : "dark";
        // Notify graph to redraw with new theme colors if necessary
        chrome.runtime.sendMessage({ type: "getFullRefresh" });
    };

    // Fullscreen link hide
    if (window.innerWidth && window.innerWidth > 1000) {
        const fsLink = document.getElementById("fullscreen-link");
        if (fsLink) fsLink.style.display = "none";
    }

    initSettingsUI();
}

function updateQualityModeUI(mode) {
    const qualitySelect = document.getElementById("qualityModeSelect");
    qualitySelect.value = mode;
    qualitySelect.className = mode;
}

function updateLimiterIndicator(reduction) {
    const el = document.getElementById("limiterIndicator");
    if (!el) return;

    if (reduction < 0.99) { // Or reduction < -0.5 dB? Original had two logics!
        // Line 123: if (reduction < 0.99)
        // Line 186: if (reduction < -0.5)
        // The one attached to window.updateLimiterIndicator (line 184) uses -0.5 (dB).
        // The one attached to window.updateLimiterIndicator (line 117) uses 0.99 (linear).
        // `visualizer.js` calls callback with `limiterReduction`.
        // The FFT data likely sends reduction in dB because `audio-processor.js` (if standard) sends dB optionally.
        // But original code at line 184 comments: "reduction is negative dB".

        // I will assume dB.
        if (reduction < -0.5) {
            el.classList.add("active");
            el.title = "Limiter active: " + reduction.toFixed(1) + " dB reduction";
        } else {
            el.classList.remove("active");
            el.title = "Limiter idle";
        }
    } else {
        el.classList.remove("active");
    }
}

function showMessage(msg) { // a(e)
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => {
        el.classList.remove("show");
    }, 3000);
}

function setupTabCapture() { // a()
    // Used when clicking "EQ This Tab"
    // Check if tab is already streaming first to avoid duplicate capture errors
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        const currentTabId = tabs[0].id;

        // First check if this tab is already being EQ'd
        chrome.runtime.sendMessage({ type: "isTabStreaming", tabId: currentTabId }, (response) => {
            if (chrome.runtime.lastError) {
                // Ignore error if service worker not ready, proceed with capture
            }

            if (response && response.streaming) {
                console.log("Tab already streaming, skipping capture");
                return;
            }

            // Not streaming yet, get stream ID
            chrome.tabCapture.getMediaStreamId({ targetTabId: currentTabId }, (streamId) => {
                if (chrome.runtime.lastError) {
                    console.error("Error getting stream ID:", chrome.runtime.lastError.message);
                    return;
                }
                chrome.runtime.sendMessage({
                    type: "eqTab",
                    on: true,
                    streamId: streamId,
                    tabId: currentTabId
                });
            });
        });
    });
}

function uiSetStartEq() { // W
    const btn = document.getElementById("eqTabButton");
    btn.onclick = () => setupTabCapture();
    // btn.textContent = "EQ"; 
    btn.innerHTML = '<span class="power-icon">⏻</span> EQ';
    btn.classList.remove("active");
    btn.title = "Enable EQ for this tab";
}

function uiSetStopEq() { // G
    const btn = document.getElementById("eqTabButton");
    btn.onclick = () => {
        chrome.runtime.sendMessage({ type: "eqTab", on: false });
    };
    // btn.textContent = "EQ";
    btn.innerHTML = '<span class="power-icon">⏻</span> EQ';
    btn.classList.add("active");
    btn.title = "Disable EQ for this tab";
}

// --- Settings Modal Logic ---

function initSettingsUI() {
    const modal = document.getElementById("settingsModal");
    const toggleBtn = document.getElementById("settingsToggle");
    const okBtn = document.getElementById("settingsOkBtn");
    const defaultBtn = document.getElementById("settingsDefaultBtn");

    // Inputs
    const sbrToggle = document.getElementById("sbrToggle");
    const sbrGain = document.getElementById("sbrGain");
    const sbrGainValue = document.getElementById("sbrGainValue");
    const limiterToggle = document.getElementById("limiterToggle");
    const limiterAttack = document.getElementById("limiterAttack");
    const limiterAttackValue = document.getElementById("limiterAttackValue");
    const limiterThreshold = document.getElementById("limiterThreshold");
    const limiterThresholdValue = document.getElementById("limiterThresholdValue");
    const limiterKnee = document.getElementById("limiterKnee");
    const limiterKneeValue = document.getElementById("limiterKneeValue");
    const limiterLookahead = document.getElementById("limiterLookahead");
    const limiterLookaheadValue = document.getElementById("limiterLookaheadValue");
    const limiterDetectorMode = document.getElementById("limiterDetectorMode");
    const limiterRmsTime = document.getElementById("limiterRmsTime");
    const limiterRmsTimeValue = document.getElementById("limiterRmsTimeValue");
    const vizFps = document.getElementById("visualizerFps");
    const vizFpsValue = document.getElementById("visualizerFpsValue");

    // Open Modal
    toggleBtn.onclick = () => modal.classList.add("show");

    // Close on click outside (Cancel)
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.remove("show");
            // Revert changes by requesting full refresh? 
            // Or just do nothing, next open will refresh from state.
            // But if user modified inputs, they remain modified in DOM? 
            // Yes, so we should arguably reset them to current actual state.
            chrome.runtime.sendMessage({ type: "getFullRefresh" });
        }
    };

    // Live UI updates (visual only)
    sbrGain.oninput = () => sbrGainValue.textContent = sbrGain.value + "db";
    limiterAttack.oninput = () => limiterAttackValue.textContent = limiterAttack.value + "ms";
    limiterThreshold.oninput = () => limiterThresholdValue.textContent = limiterThreshold.value;
    limiterKnee.oninput = () => limiterKneeValue.textContent = limiterKnee.value;
    limiterLookahead.oninput = () => limiterLookaheadValue.textContent = limiterLookahead.value + "ms";
    limiterRmsTime.oninput = () => limiterRmsTimeValue.textContent = limiterRmsTime.value + "ms";
    vizFps.oninput = () => vizFpsValue.textContent = vizFps.value + " fps";

    // OK Button - Save and Close
    okBtn.onclick = () => {
        // Send all updates
        chrome.runtime.sendMessage({
            type: "setSbrOptions",
            options: {
                enabled: sbrToggle.checked,
                gain: parseFloat(sbrGain.value)
            }
        });

        chrome.runtime.sendMessage({
            type: "setLimiterOptions",
            options: {
                enabled: limiterToggle.checked,
                attack: parseFloat(limiterAttack.value) / 1000, // Convert to seconds
                threshold: parseFloat(limiterThreshold.value),
                knee: parseFloat(limiterKnee.value),
                lookaheadMs: parseFloat(limiterLookahead.value),
                detectorMode: limiterDetectorMode.value,
                rmsTimeMs: parseFloat(limiterRmsTime.value)
            }
        });

        chrome.runtime.sendMessage({
            type: "setVisualizerFps",
            fps: parseInt(vizFps.value)
        });

        modal.classList.remove("show");
        showMessage("Settings saved.");
    };

    // Defaults
    defaultBtn.onclick = () => {
        sbrToggle.checked = false;
        sbrGain.value = 1;
        sbrGainValue.textContent = "1db";

        limiterToggle.checked = true;
        limiterAttack.value = 100;
        limiterAttackValue.textContent = "100ms";
        limiterThreshold.value = 0.95;
        limiterThresholdValue.textContent = "0.95";
        limiterKnee.value = 0.05;
        limiterKneeValue.textContent = "0.05";
        limiterLookahead.value = 2;
        limiterLookaheadValue.textContent = "2ms";
        limiterDetectorMode.value = "peak";
        limiterRmsTime.value = 50;
        limiterRmsTimeValue.textContent = "50ms";

        vizFps.value = 30;
        vizFpsValue.textContent = "30 fps";
    };

    // Full Reset
    const fullResetBtn = document.getElementById("settingsFullResetBtn");
    if (fullResetBtn) {
        fullResetBtn.onclick = () => {
            if (window.confirm("Are you sure you want to perform a FULL RESET? This will delete ALL saved presets and restore all settings to default.")) {
                chrome.runtime.sendMessage({ type: "fullReset" });
                modal.classList.remove("show");
                showMessage("Performing full reset...");
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        };
    }
}

// Hook into existing updateWorkspace
function updateSettingsUI(data) {
    if (data.sbrOptions) {
        document.getElementById("sbrToggle").checked = data.sbrOptions.enabled;
        document.getElementById("sbrGain").value = data.sbrOptions.gain;
        document.getElementById("sbrGainValue").textContent = data.sbrOptions.gain + "db";
    }
    if (data.limiterOptions) {
        document.getElementById("limiterToggle").checked = data.limiterOptions.enabled;
        document.getElementById("limiterAttack").value = data.limiterOptions.attack * 1000; // to ms
        document.getElementById("limiterAttackValue").textContent = (data.limiterOptions.attack * 1000) + "ms";
        document.getElementById("limiterThreshold").value = data.limiterOptions.threshold ?? 0.95;
        document.getElementById("limiterThresholdValue").textContent = data.limiterOptions.threshold ?? 0.95;
        document.getElementById("limiterKnee").value = data.limiterOptions.knee ?? 0.05;
        document.getElementById("limiterKneeValue").textContent = data.limiterOptions.knee ?? 0.05;
        document.getElementById("limiterLookahead").value = data.limiterOptions.lookaheadMs ?? 2;
        document.getElementById("limiterLookaheadValue").textContent = (data.limiterOptions.lookaheadMs ?? 2) + "ms";
        document.getElementById("limiterDetectorMode").value = data.limiterOptions.detectorMode ?? "peak";
        document.getElementById("limiterRmsTime").value = data.limiterOptions.rmsTimeMs ?? 50;
        document.getElementById("limiterRmsTimeValue").textContent = (data.limiterOptions.rmsTimeMs ?? 50) + "ms";
    }
    if (data.visualizerFps) {
        document.getElementById("visualizerFps").value = data.visualizerFps;
        document.getElementById("visualizerFpsValue").textContent = data.visualizerFps + " fps";
    }
}

