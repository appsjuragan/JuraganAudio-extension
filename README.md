# 🎧 Ears Audio Toolkit

Ears is a powerful, real-time audio equalizer extension for Google Chrome. It allows you to EQ any audio you find on the web, live! Base boost, dim the highs, up the vocals — all with a few clicks.

## ✨ Features

- **11-Band EQ**: Full control over your audio with professional-grade filters (Low-shelf, Peaking, High-shelf).
- **Real-time Spectrum Visualizer**: See your audio as you hear it. Watch how your EQ changes the frequency spectrum in real-time.
- **Preset Management**: Save your favorite configurations and switch between them instantly. Includes a built-in "Bass Boost" preset.
- **Per-Tab Equalization**: Independently EQ different tabs or apply settings to multiple tabs at once.
- **Import/Export**: Easily back up your presets or share them with others.

## 🛠️ Technical Details

- **Core**: Built using the Web Audio API (`AudioContext`, `BiquadFilterNode`, `AnalyserNode`).
- **Visualization**: Powered by `Snap.svg` for smooth, vector-based rendering of the EQ curve and spectrum.
- **Capture**: Uses `chrome.tabCapture` API to intercept and process audio streams.

## 🚀 Getting Started

1. **Install**: Load as an unpacked extension in Chrome.
2. **Activate**: Click the Ears icon in your toolbar to add the current tab to Ears.
3. **Adjust**: Drag the dots on the graph to change frequencies and gain.
   - **Vertical**: Volume (Gain)
   - **Horizontal**: Frequency
   - **Shift + Vertical**: Width (Q-factor)
4. **Save**: Type a name and click "+ Save Preset" to keep your settings.

## 🔧 Recent Improvements

- **Unminified Source Code**: The core logic in `popup.js` and `bg.js` has been restored to a readable format for easier maintenance and contribution.
- **Code Cleanup**: Removed redundant minified blocks and improved code structure.

## 📝 Roadmap

- [ ] Migrate to Manifest V3.
- [ ] Add more built-in presets (Cinema, Voice, Night Mode).
- [ ] Implement Dark/Light mode themes.
- [ ] Add spatial audio/stereo widening effects.

---
*Created with ❤️ by Kevin King.*
