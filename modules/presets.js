
let presetsCache = {};

export function updatePresetsUI(presets, onPresetClick) {
    presetsCache = presets; // Cache for export

    const select = document.getElementById("presetSelect");
    if (!select) return;

    // Clear existing options but keep the first one if it's a placeholder
    // Or just rebuild entirely. Let's rebuild but keep a "Select preset" placeholder
    select.innerHTML = '<option value="" disabled selected>Select preset</option>';

    const keys = presets ? Object.keys(presets) : [];

    keys.forEach(key => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        select.appendChild(option);
    });

    // Remove old listener to avoid duplicates if this is called multiple times? 
    // Actually, setting onchange property overwrites old one, which is safer here.
    select.onchange = () => {
        const key = select.value;
        if (onPresetClick) onPresetClick(key);

        // Update input box too?
        const input = document.getElementById("presetNameInput");
        if (input) input.value = key;

        // Reset selection to placeholder? Or keep it selected?
        // Usually keeping it selected is better feedback.
    };
}

export async function exportPresets() {
    let presets = presetsCache;
    console.log("Exporting presets, cache:", presets);

    // Fallback if empty cache
    if (!presets || Object.keys(presets).length === 0) {
        try {
            // Access chrome storage directly?
            // This assumes "chrome" is available globally (it is in extension)
            if (typeof chrome !== 'undefined' && chrome.storage) {
                const data = await chrome.storage.sync.get(null);
                presets = {};
                for (let key in data) {
                    if (key.startsWith("PRESETS.")) {
                        presets[key.slice(8)] = data[key];
                    }
                }
            }
        } catch (e) {
            console.error("Error fetching presets for export:", e);
        }
    }

    if (!presets || Object.keys(presets).length === 0) {
        return false; // No presets
    }

    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "juraganaudio_presets.json";
    document.body.appendChild(a);
    a.click();

    // Cleanup with delay to ensure download starts
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
