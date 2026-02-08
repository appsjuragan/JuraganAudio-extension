const z = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
const H = [0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 0.5];

const DEFAULTS = {
    "Bass Boost": {
        frequencies: z,
        gains: [8, 6.5, 5, 3, 1, 0, 0, 0, 0, 0, 0],
        qs: H,
        gain: 1
    },
    "Treble": {
        frequencies: z,
        gains: [0, 0, 0, 0, 0, 0, 1, 3, 5, 7, 8],
        qs: H,
        gain: 1
    },
    "Loudness": {
        frequencies: z,
        gains: [6, 4, 3, 0, -1, -2, -1, 0, 3, 5, 7],
        qs: H,
        gain: 1
    }
};

let presetsCache = {};

export function updatePresetsUI(userPresets, onPresetClick, currentFilters, currentGain) {
    // Merge defaults (User presets override defaults if name collides)
    const allPresets = { ...DEFAULTS, ...(userPresets || {}) };
    presetsCache = allPresets; // Cache for export

    const select = document.getElementById("presetSelect");
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Select preset</option>';

    const keys = Object.keys(allPresets);
    let matchedPreset = null;

    if (currentFilters && currentFilters.length > 0) {
        matchedPreset = keys.find(key => {
            const p = allPresets[key];
            if (!p || !p.frequencies || !p.gains || !p.qs) return false;

            const presetGain = (p.gain !== undefined) ? p.gain : 1;
            const liveGain = (currentGain !== undefined) ? currentGain : 1;
            if (Math.abs(presetGain - liveGain) > 0.05) return false;

            if (p.frequencies.length !== currentFilters.length) return false;

            for (let i = 0; i < currentFilters.length; i++) {
                const f = currentFilters[i];
                if (Math.abs(p.frequencies[i] - f.frequency) > 1) return false;
                if (Math.abs(p.gains[i] - f.gain) > 0.1) return false;
                if (Math.abs(p.qs[i] - f.q) > 0.05) return false;
            }
            return true;
        });
    }

    keys.forEach(key => {
        const option = document.createElement("option");
        option.value = key;
        option.innerText = key;
        select.appendChild(option);
    });

    const input = document.getElementById("presetNameInput");

    if (matchedPreset) {
        select.value = matchedPreset;
        if (input && document.activeElement !== input) {
            input.value = matchedPreset;
        }
    } else {
        select.value = "";
        // If no match, clear input? Or assume "dirty"?
        // User Request: "if non dirty preset, stay preset name selection...".
        if (input && document.activeElement !== input) {
            input.value = "";
        }
    }

    select.onchange = () => {
        const key = select.value;
        const presetData = allPresets[key];
        // Pass BOTH key and data
        if (onPresetClick) onPresetClick(key, presetData);

        if (input) input.value = key;
    };
}

export async function exportPresets(name) {
    let presets = presetsCache;
    // Fallback if empty cache (only user presets usually exported from storage, but here we export cache which helps)
    if (!presets || Object.keys(presets).length === 0) {
        return false;
    }

    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = name ? `JuraganAudio_${name.replace(/\s+/g, '_')}.json` : "JuraganAudio_presets.json";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);

    return true;
}

export function importPresets(file, callback) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const presets = JSON.parse(e.target.result);
            if (callback) callback(presets);
        } catch (err) {
            console.error("Error parsing presets file:", err);
        }
    };
    reader.readAsText(file);
}
