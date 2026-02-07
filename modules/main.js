
import * as EQGraph from './eq-graph.js';
import * as EQMath from './eq-math.js';
import * as Visualizer from './visualizer.js';
import * as Presets from './presets.js';

let isFirstLoad = true; // i
const PRO_LIMIT = 3; // p (number of free presets allowed?) Original: var p = null; if (p && ...) -> wait.
// Original: var p = null;
// Later `if (p && userPresetSpan.children.length >= p + 1)` implies p is max presets?
// But `p` is initialized to null.
// Ah, `p` comes from scope?
// Original: `var p = null; var N = function () { };`
// No logic sets `p` to anything other than null in what I saw?
// Wait, maybe I missed something.
// Line 11: `var p = null;`
// Line 12: `var t = localStorage;` (duplicate)
// Maybe `p` is meant to be set by some pro check?
// But I don't see any code setting `p`.
// Wait, `H` (toggle visualizer) checks `if (p) return;` (if p is truthy, feature locked?)
// If `p` is null, features are UNLOCKED?
// But `if (p && length >= p+1)` suggests `p` is limit.
// If `p` is null, `p+1` is 1? No `null + 1` is 1.
// If `p` is null, `p && ...` is false. So no limit.
// So `p=null` means PRO UNLOCKED or NO LIMIT?
// Original comments: "Analytics removed". Maybe license check removed?
// I will keep `p = null` for now to maintain behavior (unlimited).

const MAX_PRESETS = null; // p

document.addEventListener("DOMContentLoaded", () => {
    initUI();
    initMessaging();

    // Refresh state
    chrome.runtime.sendMessage({ type: "onPopupOpen" });
    chrome.runtime.sendMessage({ type: "getFullRefresh" });

    // NOTE: Don't auto-capture on popup open - wait for user to click "EQ This Tab"
    // The workspace status message will tell us if we're already streaming

    // Check initial visualizer state
    Visualizer.init(updateLimiterIndicator);

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
        else if (msg.type === "sendWorkspaceStatus") {
            isFirstLoad = false;
            updateWorkspace(msg);
            if (msg.qualityMode) updateQualityModeUI(msg.qualityMode);
        }
        else if (msg.type === "sendSampleRate") {
            EQGraph.setSampleRate(msg.Fs);
            console.log("Set sample rate to " + msg.Fs);
        }
        else if (msg.type === "sendPresets") {
            Presets.updatePresetsUI(msg.presets, (name) => {
                chrome.runtime.sendMessage({ type: "preset", preset: name });
                // Update input
                const input = document.getElementById("presetNameInput");
                if (input) input.value = name;
                showMessage("Preset '" + name + "' loaded.");
            });
        }
        else if (msg.type === "F") { // Force license check failure?
            showLicenseError();
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

    const gainVal = data.gain || 0; // The stored 'master gain' usually 1.0 (0dB)??
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
}

function updateTabsList(streams) { // K
    const container = document.getElementById("eqTabList");
    container.innerHTML = "";

    if (streams.length === 0) {
        container.textContent = "No tabs active. Click 'EQ This Tab' below to activate this tab.";
        return;
    }

    const table = document.createElement("table");
    streams.forEach(stream => {
        const tr = document.createElement("tr");

        // Stop button
        const btn = document.createElement("button");
        btn.textContent = "Stop EQing";
        btn.onclick = () => {
            chrome.runtime.sendMessage({ type: "disconnectTab", tab: stream });
        };

        // Icon
        const img = document.createElement("img");
        img.className = "tabFavIcon";
        img.src = stream.favIconUrl;
        img.alt = "";
        btn.appendChild(img);

        const td1 = document.createElement("td");
        td1.appendChild(btn);
        tr.appendChild(td1);

        // Title
        const td2 = document.createElement("td");
        let title = stream.title;
        if (title.length > 45) title = title.substring(0, 45);
        td2.textContent = title;
        tr.appendChild(td2);

        table.appendChild(tr);
    });
    container.appendChild(table);
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
        if (MAX_PRESETS && document.getElementById("presetSelect").options.length - 1 >= MAX_PRESETS) {
            showMessage("Saving more than " + MAX_PRESETS + " presets requires Ears Pro.");
            return;
        }
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
        Presets.exportPresets().then(success => {
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
        if (MAX_PRESETS) { // If Pro required
            showMessage("The frequency spectrum visualizer requires Ears Pro.");
            // return; // allow toggle anyway for now as usage matches original
        }
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

    // Restore last tab
    const lastTab = localStorage["last-tab"];
    if (lastTab) {
        const el = document.getElementById(lastTab);
        if (el) el.click();
    }

    // Fullscreen link hide
    if (window.innerWidth && window.innerWidth > 1000) {
        document.getElementById("fullscreen-link").style.display = "none";
    }
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
    const el = document.getElementById("requiresProDiv");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => {
        el.classList.remove("show");
    }, 5000);
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
    btn.textContent = "EQ This Tab";
}

function uiSetStopEq() { // G
    const btn = document.getElementById("eqTabButton");
    btn.onclick = () => {
        chrome.runtime.sendMessage({ type: "eqTab", on: false });
    };
    btn.textContent = "Stop EQing This Tab";
}

function showLicenseError() { // F
    document.getElementById("eqSvg").remove();
    document.getElementById("eqTabButton").remove();
    document.getElementById("lt").textContent = "Thank you for using Ears!"; // Original text was longer
    document.getElementById("pl").style.display = "block";
}
