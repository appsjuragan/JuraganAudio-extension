const FFT_CHANNEL_NAME = 'juragan_audio_fft';
const VISUALIZER_KEY = "SHOW_VISUALIZER";
const VISUALIZER_STYLE_KEY = "VISUALIZER_STYLE";
const DEFAULT_VISUALIZER_STYLE = "default";

const SAMPLE_RATE = 48000;
const WIDTH = 640;
const HEIGHT = 300;

let fftChannel = null;
let limiterCallback = null;
let canvas = null;
let gl = null;
let program = null;
let vao = null;
let positionBuffer = null;
let uniformResolution = null;
let uniformTopColor = null;
let uniformMidColor = null;
let uniformBottomColor = null;
let uniformPointSize = null;
let lastCanvasWidth = 0;
let lastCanvasHeight = 0;
let currentStyle = DEFAULT_VISUALIZER_STYLE;

if (typeof localStorage !== "undefined" && localStorage[VISUALIZER_STYLE_KEY]) {
    currentStyle = localStorage[VISUALIZER_STYLE_KEY];
}

export function init(onLimiterUpdate) {
    limiterCallback = onLimiterUpdate;
    setupGL();

    fftChannel = new BroadcastChannel(FFT_CHANNEL_NAME);
    fftChannel.onmessage = (event) => {
        if (event.data.type === 'fft') {
            updateVisualizer(event.data);
            if (event.data.limiterReduction !== undefined && limiterCallback) {
                limiterCallback(event.data.limiterReduction);
            }
        }
    };

    window.addEventListener('unload', () => {
        if (fftChannel) fftChannel.postMessage({ type: 'stopFFT' });
    });

    return isVisualizerOn();
}

export function isVisualizerOn() {
    return localStorage[VISUALIZER_KEY] === "true";
}

export function toggleVisualizer() {
    const newState = !isVisualizerOn();
    localStorage[VISUALIZER_KEY] = newState ? "true" : "false";
    startOrStopVisualizer();
    return newState;
}

export function startOrStopVisualizer() {
    if (isVisualizerOn()) {
        if (fftChannel) fftChannel.postMessage({ type: 'startFFT' });
    } else {
        if (fftChannel) fftChannel.postMessage({ type: 'stopFFT' });
        clearCanvas();
    }
}

export function getVisualizerStyle() {
    return currentStyle || DEFAULT_VISUALIZER_STYLE;
}

export function setVisualizerStyle(style) {
    if (!style) return;
    currentStyle = style;
    localStorage[VISUALIZER_STYLE_KEY] = style;
    clearCanvas();
}

function P(e) {
    const c = 22050;
    let val = e / c;
    if (val < 0) val = 0;
    return Math.pow(val, 0.25) * WIDTH;
}

export function updateVisualizer(data) {
    if (!isVisualizerOn()) return;

    const n = data.fft || data.data;
    if (!n || n.length === 0) return;

    if (!gl || !program) {
        setupGL();
    }
    if (!gl || !program) return;
    if (!resizeCanvasToDisplaySize()) return;

    const isLight = document.body.classList.contains("light-mode");
    const topColor = isLight ? "#4f46e5" : "#22d3ee";
    const midColor = "#818cf8";
    const bottomColor = isLight ? "rgba(79, 70, 229, 0.1)" : "rgba(255, 255, 255, 0.1)";

    const scaleX = gl.canvas.width / WIDTH;
    const scaleY = gl.canvas.height / HEIGHT;
    const points = buildSpectrumPoints(n, scaleX, scaleY);
    if (points.length < 2) {
        clearCanvas();
        return;
    }

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.uniform2f(uniformResolution, gl.canvas.width, gl.canvas.height);

    gl.clear(gl.COLOR_BUFFER_BIT);

    const baseY = HEIGHT * scaleY;
    switch (currentStyle) {
        case "bars": {
            gl.uniform1f(uniformPointSize, 1);
            setColorUniforms(topColor, midColor, bottomColor);
            drawWithMode(buildBarsArray(points, baseY), gl.LINES);
            break;
        }
        case "dots": {
            gl.uniform1f(uniformPointSize, 5);
            setColorUniforms(topColor, midColor, bottomColor);
            drawWithMode(buildLineArray(points), gl.POINTS);
            break;
        }
        case "mirror-bars": {
            gl.uniform1f(uniformPointSize, 1);
            setColorUniforms(topColor, midColor, bottomColor);
            drawWithMode(buildMirrorBarsArray(points, baseY / 2), gl.LINES);
            break;
        }
        case "mountain": {
            gl.uniform1f(uniformPointSize, 1);
            setColorUniforms(topColor, midColor, bottomColor);
            drawWithMode(buildMountainArray(points, baseY), gl.TRIANGLE_STRIP);
            break;
        }
        case "fancy-line": {
            gl.uniform1f(uniformPointSize, 1);
            setColorUniforms(topColor, midColor, bottomColor);
            drawWithMode(buildLineArray(points), gl.LINE_STRIP);
            gl.uniform1f(uniformPointSize, 7);
            setColorUniforms("#f472b6", "#a855f7", "rgba(0, 0, 0, 0)");
            drawWithMode(buildLineArray(points), gl.POINTS);
            break;
        }
        case "default":
        default: {
            gl.uniform1f(uniformPointSize, 1);
            setColorUniforms(topColor, midColor, bottomColor);
            drawWithMode(buildLineArray(points), gl.LINE_STRIP);
            break;
        }
    }
}

function setupGL() {
    canvas = document.getElementById("visualizerCanvas");
    if (!canvas) return;

    gl = canvas.getContext("webgl2", { alpha: true, antialias: true });
    if (!gl) return;

    const vertexSource = `#version 300 es
    in vec2 a_position;
    uniform vec2 u_resolution;
    uniform float u_pointSize;
    out float v_y;
    void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clip = vec2(zeroToOne.x * 2.0 - 1.0, 1.0 - zeroToOne.y * 2.0);
        v_y = zeroToOne.y;
        gl_PointSize = u_pointSize;
        gl_Position = vec4(clip, 0.0, 1.0);
    }
    `;

    const fragmentSource = `#version 300 es
    precision mediump float;
    in float v_y;
    uniform vec4 u_topColor;
    uniform vec4 u_midColor;
    uniform vec4 u_bottomColor;
    out vec4 outColor;
    void main() {
        float t = clamp(v_y, 0.0, 1.0);
        vec4 color = t < 0.5
            ? mix(u_topColor, u_midColor, t * 2.0)
            : mix(u_midColor, u_bottomColor, (t - 0.5) * 2.0);
        outColor = color;
    }
    `;

    const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return;

    program = createProgram(vertexShader, fragmentShader);
    if (!program) return;

    vao = gl.createVertexArray();
    positionBuffer = gl.createBuffer();

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    uniformResolution = gl.getUniformLocation(program, "u_resolution");
    uniformTopColor = gl.getUniformLocation(program, "u_topColor");
    uniformMidColor = gl.getUniformLocation(program, "u_midColor");
    uniformBottomColor = gl.getUniformLocation(program, "u_bottomColor");
    uniformPointSize = gl.getUniformLocation(program, "u_pointSize");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    resizeCanvasToDisplaySize();
    clearCanvas();
}

function resizeCanvasToDisplaySize() {
    if (!canvas || !gl) return false;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.round(rect.width * dpr);
    const displayHeight = Math.round(rect.height * dpr);

    if (displayWidth === 0 || displayHeight === 0) return false;

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }

    if (displayWidth !== lastCanvasWidth || displayHeight !== lastCanvasHeight) {
        gl.viewport(0, 0, displayWidth, displayHeight);
        lastCanvasWidth = displayWidth;
        lastCanvasHeight = displayHeight;
    }

    return true;
}

function clearCanvas() {
    if (!gl) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function buildSpectrumPoints(bins, scaleX, scaleY) {
    const points = [];
    for (let i = 0; i < bins.length; i++) {
        const freq = (i * SAMPLE_RATE) / (bins.length * 2);
        if (freq < 10) continue;

        const rawX = P(freq);
        if (rawX > WIDTH) break;
        const x = rawX * scaleX;

        let db = bins[i];
        if (db < -100) db = -100;
        if (db > 0) db = 0;

        const amplitude = ((db + 100) / 100) * HEIGHT * scaleY;
        const y = (HEIGHT * scaleY) - amplitude;
        points.push({ x, y, amplitude });
    }

    const decimated = [];
    const threshold = 2 * scaleX;
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (decimated.length === 0) {
            decimated.push(point);
            continue;
        }
        const last = decimated[decimated.length - 1];
        if (point.x - last.x < threshold) {
            if (point.y < last.y) {
                last.y = point.y;
                last.amplitude = point.amplitude;
            }
        } else {
            decimated.push(point);
        }
    }

    return decimated;
}

function buildLineArray(points) {
    const flat = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        flat[i * 2] = points[i].x;
        flat[i * 2 + 1] = points[i].y;
    }
    return flat;
}

function buildBarsArray(points, baseY) {
    const flat = new Float32Array(points.length * 4);
    for (let i = 0; i < points.length; i++) {
        const offset = i * 4;
        flat[offset] = points[i].x;
        flat[offset + 1] = baseY;
        flat[offset + 2] = points[i].x;
        flat[offset + 3] = points[i].y;
    }
    return flat;
}

function buildMirrorBarsArray(points, centerY) {
    const flat = new Float32Array(points.length * 4);
    for (let i = 0; i < points.length; i++) {
        const offset = i * 4;
        const half = points[i].amplitude / 2;
        flat[offset] = points[i].x;
        flat[offset + 1] = centerY - half;
        flat[offset + 2] = points[i].x;
        flat[offset + 3] = centerY + half;
    }
    return flat;
}

function buildMountainArray(points, baseY) {
    const flat = new Float32Array(points.length * 4);
    for (let i = 0; i < points.length; i++) {
        const offset = i * 4;
        flat[offset] = points[i].x;
        flat[offset + 1] = baseY;
        flat[offset + 2] = points[i].x;
        flat[offset + 3] = points[i].y;
    }
    return flat;
}

function drawWithMode(points, mode) {
    if (!points || points.length === 0) return;
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.DYNAMIC_DRAW);
    gl.drawArrays(mode, 0, points.length / 2);
}

function setColorUniforms(topColor, midColor, bottomColor) {
    gl.uniform4fv(uniformTopColor, parseColorToVec4(topColor));
    gl.uniform4fv(uniformMidColor, parseColorToVec4(midColor));
    gl.uniform4fv(uniformBottomColor, parseColorToVec4(bottomColor));
}

function parseColorToVec4(color) {
    if (color.startsWith("#")) {
        const hex = color.replace("#", "");
        const size = hex.length === 3 ? 1 : 2;
        const r = parseInt(hex.substring(0, size).repeat(size === 1 ? 2 : 1), 16);
        const g = parseInt(hex.substring(size, size * 2).repeat(size === 1 ? 2 : 1), 16);
        const b = parseInt(hex.substring(size * 2, size * 3).repeat(size === 1 ? 2 : 1), 16);
        return [r / 255, g / 255, b / 255, 1];
    }

    const match = color.match(/rgba?\(([^)]+)\)/);
    if (match) {
        const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
        const [r, g, b, a = 1] = parts;
        return [r / 255, g / 255, b / 255, a];
    }

    return [1, 1, 1, 1];
}

function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(vertexShader, fragmentShader) {
    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(shaderProgram));
        gl.deleteProgram(shaderProgram);
        return null;
    }
    return shaderProgram;
}
