import { state } from './state.js';

let creating; // A global promise to avoid concurrency issues

export async function ensureOffscreen() {
    const path = 'offscreen.html';
    if (await chrome.offscreen.hasDocument()) return;

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Audio equalization requires AudioContext and tabCapture',
        });
        await creating;
        creating = null;

        // Sync state immediately after creation
        chrome.runtime.sendMessage({
            type: "initialState",
            gain: state.gain,
            filters: state.filters,
            qualityMode: state.qualityMode,
            sbrOptions: state.sbrOptions,
            limiterOptions: state.limiterOptions,
            visualizerFps: state.visualizerFps
        });
    }
}
