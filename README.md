# 🎧 Ears Audio Toolkit

Ears is a powerful, real-time audio equalizer extension for Google Chrome. It allows you to EQ any audio you find on the web, live! Bass boost, dim the highs, up the vocals — all with a few clicks.

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
- **Processing**: Custom 11-band EQ and soft limiter implemented in `AudioWorklet` for glitch-free performance.
- **Visualization**: powered by **WebGPU** for silky smooth 60FPS spectrum rendering (with Canvas 2D fallback).
- **Architecture**: Manifest V3 with offscreen document for audio processing. Rust DSP library ready for future WebAssembly integration.

## 🚀 Getting Started

1. **Install**: Load as an unpacked extension in Chrome.
2. **Activate**: Click the Ears icon in your toolbar to add the current tab to Ears.
3. **Adjust**: Drag the dots on the graph to change frequencies and gain.
   - **Vertical**: Volume (Gain)
   - **Horizontal**: Frequency
   - **Shift + Vertical**: Width (Q-factor)
4. **Quality Mode**: Select your preferred quality/CPU tradeoff from the dropdown
5. **Save**: Type a name and click "+ Save Preset" to keep your settings.

## 🔧 Recent Improvements

- **Next-Gen Engine**: Migrated from `BiquadFilterNode` to `AudioWorklet` for superior performance and flexibility
- **WebGPU Visualizer**: New high-performance spectrum analyzer
- **Sound Quality**: 3 quality modes, intelligent soft limiting, frequency-dependent Q
- **Manifest V3**: Fully migrated architecture
- **Rust DSP**: Core signal processing logic ported to Rust (ready for Wasm)

## 📝 Roadmap

- [x] ~~Migrate to Manifest V3~~
- [x] ~~Add sound quality improvements~~
- [ ] Add more built-in presets (Cinema, Voice, Night Mode)
- [ ] Implement Dark/Light mode themes
- [ ] Add spatial audio/stereo widening effects

---
*Created with ❤️ by Kevin King.*
