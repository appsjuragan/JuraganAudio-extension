# 🎧 JuraganAudio Toolkit

JuraganAudio is a powerful, real-time audio equalizer extension for Google Chrome. It allows you to EQ any audio you find on the web, live! Bass boost, dim the highs, up the vocals — all with a few clicks.

## ✨ Features

- **11-Band EQ**: Full control over your audio with professional-grade filters (Low-shelf, Peaking, High-shelf).
- **Real-time Spectrum Visualizer**: See your audio as you hear it. Watch how your EQ changes the frequency spectrum in real-time.
- **Preset Management**: Save your favorite configurations and switch between them instantly. Includes a built-in "Bass Boost" preset.
- **Per-Tab Equalization**: Independently EQ different tabs or apply settings to multiple tabs at once.
- **Import/Export**: Easily back up your presets or share them with others.

### 🎵 Sound Quality Enhancements (v2.1+)

- **3 Quality Modes**:
  - ⚡ **Efficient**: Optimized Q values, standard limiting (~5-8% CPU)
  - 🎵 **Quality**: Enhanced Q values, tighter limiting (~5-8% CPU)
  - 🎧 **Hi-Fi**: Maximum Q precision, ultra-tight limiting (~5-8% CPU)
  
- **Soft Limiting**: Prevents harsh clipping distortion when boosting frequencies
- **Optimized Filter Q**: Frequency-dependent Q values for smoother, more musical response
- **48kHz Processing**: Fixed sample rate for consistent quality

## 🛠️ Technical Details

- **Core**: Built using the Web Audio API (`AudioWorklet`, `AudioContext`).
- **Processing**: High-performance Rust-based DSP engine compiled to **WebAssembly (WASM)** for superior audio quality and efficiency.
- **Visualization**: Powered by **Snap.svg** for high-quality, crisp vector-based spectrum rendering.
- **Architecture**: Manifest V3 with offscreen document for persistent audio processing.

## 🚀 Getting Started

1. **Install**: Load as an unpacked extension in Chrome.
2. **Activate**: Click the JuraganAudio icon in your toolbar and click "EQ this tab".
3. **Adjust**: Drag the dots on the graph to change frequencies and gain.
4. **Quality Mode**: Select your preferred quality/CPU tradeoff from the dropdown.
5. **Save**: Type a name and click "+" to save your preset.

## 🔧 Recent Improvements

- **WASM Audio Engine**: Fully integrated Rust DSP for 11-band parametric EQ and professional soft limiting.
- **Spectrum Visualizer**: Optimized SVG-based real-time analysis.
- **Sound Quality**: 3 quality modes, intelligent soft limiting, and frequency-dependent Q.
- **Manifest V3**: State-of-the-art extension architecture.
- **JuraganAudio Refresh**: Complete branding revamp for a premium experience.

## 📝 Roadmap

- [x] ~~Migrate to Manifest V3~~
- [x] ~~Add sound quality improvements~~
- [x] ~~Implement Dark/Light mode themes~~
- [x] ~~Full Rust DSP / WebAssembly integration~~
- [ ] Add more built-in presets (Cinema, Voice, Night Mode)
- [ ] Add spatial audio/stereo widening effects

---
*Created with ❤️ by Kevin King.*
