# Contributing to JuraganAudio

Thank you for your interest in contributing to JuraganAudio! We welcome contributions from the community to help make this the best audio toolkit for Chrome.

## How to Contribute

1.  **Report Bugs**: If you find a bug, please open an issue using the Bug Report template.
2.  **Suggest Features**: Have an idea? Use the Feature Request template.
3.  **Submit Pull Requests**:
    *   Fork the repository.
    *   Create a new branch for your feature or fix.
    *   Ensure your code follows the existing style.
    *   Submit a PR with a clear description of your changes.

## Development Setup

JuraganAudio uses a hybrid architecture:
- **Core Logic**: Rust (compiled to WebAssembly)
- **Frontend**: Vanilla JS/HTML/CSS
- **Communication**: Manifest V3 Service Worker + Offscreen Document

To build the WASM module:
```bash
cd src/dsp
wasm-pack build --target web --out-dir ../../worklet --out-name juragan_audio_dsp
```

## Code of Conduct

Please be respectful and professional in all interactions.

---
*AppsJuragan inc.*
