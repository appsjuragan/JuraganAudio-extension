
import * as EQMath from './eq-math.js';

let eqSvg = null; // I
let gainSvg = null; // x
let filterLines = {}; // R
let sampleRate = 44100;

// Callbacks for message passing
let onGainChangeStart = null;
let onGainChange = null;
let onGainChangeEnd = null; // New
let onFilterChangeStart = null;
let onFilterChange = null;
let onFilterChangeEnd = null; // New
let onResetFilter = null;
let onRefresh = null;

export function init(callbacks) {
    onGainChangeStart = callbacks.onGainChangeStart;
    onGainChange = callbacks.onGainChange;
    onFilterChangeStart = callbacks.onFilterChangeStart;
    onFilterChange = callbacks.onFilterChange;
    onGainChangeEnd = callbacks.onGainChangeEnd; // New
    onFilterChangeEnd = callbacks.onFilterChangeEnd; // New
    onResetFilter = callbacks.onResetFilter;
    onRefresh = callbacks.onRefresh;
}


export function setSampleRate(rate) {
    sampleRate = rate;
    EQMath.setSampleRate(rate);
}

export function drawEQ(filters, gainVal) {
    // Corresponds to $
    if (eqSvg) eqSvg.clear();
    if (gainSvg) gainSvg.clear();

    const eqSvgEl = document.getElementById("eqSvg");
    const gainSvgEl = document.getElementById("gainSvg");

    // Snap might already be initialized on these elements, 
    // but clearing them removes content.
    // If Snap instance persists, we might just be able to re-use I/x if we stored them better.
    // But the original code does I = Snap("#eqSvg") every time.

    eqSvg = Snap("#eqSvg");
    eqSvg.attr({ fill: "transparent", height: EQMath.HEIGHT, width: EQMath.WIDTH });

    gainSvg = Snap("#gainSvg");
    gainSvg.attr({ fill: "transparent", height: EQMath.HEIGHT, width: EQMath.GAIN_WIDTH });

    // Background rect
    eqSvg.rect(0, 0, EQMath.WIDTH, EQMath.HEIGHT).attr({ stroke: "rgba(255,255,255,0.1)" });

    // Draw filter curves
    drawAllCurves(filters);

    // Draw grid
    drawGrid(eqSvg);

    // Draw Gain Slider
    drawGainSlider(gainVal);

    // Draw Filter Dots
    drawFilterDots(filters);
}

function drawGainSlider(gainObj) {
    // gainObj has .y (gain to Y) and .gain (value)
    // Actually the original passed {gain: ..., y: ...} as second arg to $

    const midX = EQMath.GAIN_WIDTH / 2;
    const y0 = EQMath.gainToY(EQMath.MIN_GAIN); // k = -30
    const y1 = EQMath.gainToY(EQMath.MAX_GAIN); // u = 30
    const yZero = EQMath.gainToY(0);

    gainSvg.line(midX, y0, midX, y1).attr({ stroke: "#9ca3af", opacity: 0.3 });

    gainSvg.text(midX, 15, "Vol")
        .attr({ fill: "#9ca3af", "text-anchor": "middle", "font-size": 10 });

    gainSvg.line(midX - 5, yZero, midX + 5, yZero).attr({ stroke: "#9ca3af" });

    const dragLine = gainSvg.line(0, gainObj.y, EQMath.GAIN_WIDTH, gainObj.y)
        .attr({ stroke: "#f3f4f6", "stroke-width": 5, cursor: "ns-resize" })
        .addClass("gainLine");

    dragLine.drag(
        onDragGain(dragLine, gainObj),
        onDragStart,
        onDragGainEnd(dragLine, gainObj)
    );
}

function drawFilterDots(filters) {
    for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        let dotStyle = { fill: "#f3f4f6", stroke: "#f3f4f6" };
        if (filter.t === "peaking") {
            dotStyle = { fill: "#818cf8", stroke: "#818cf8" }; // Primary
        } else if (filter.t === "highshelf" || filter.t === "lowshelf") {
            dotStyle = { fill: "#22d3ee", stroke: "#22d3ee" }; // Accent
        }

        const dot = eqSvg.circle(filter.x, filter.y, 6)
            .attr({ ...dotStyle, "stroke-width": 2, stroke: "#fff" })
            .addClass("filterDot");

        dot.drag(
            onDragFilter(filter, i, eqSvg),
            onDragStart,
            onDragFilterEnd(filter, i)
        );

        dot.dblclick(() => {
            // Reset filter
            filter.gain = 0;
            filter.y = EQMath.gainToY(0);
            if (onResetFilter) onResetFilter(i);
            if (onRefresh) onRefresh();
        });
    }
}

function drawAllCurves(filters) { // re
    for (let i = 0; i < filters.length; i++) {
        updateFilterCurve(eqSvg, filters[i], i);
    }
}

function drawGrid(svg) { // ae
    // Draw vertical frequency lines
    const maxFreq = EQMath.MAX_FREQ;
    for (let freq = 5; freq < maxFreq; freq *= 2) {
        const x = EQMath.freqToX(freq);
        svg.line(x, EQMath.HEIGHT / 2 + 10, x, EQMath.HEIGHT / 2 - 10).attr({ stroke: "#9ca3af", "stroke-opacity": 0.15 });
        svg.line(x, EQMath.HEIGHT, x, EQMath.HEIGHT - 15).attr({ stroke: "#9ca3af", "stroke-opacity": 0.3 });
        svg.text(x, EQMath.HEIGHT - 18, "" + Math.round(xToFreqForLabel(x)))
            .attr({ fill: "#6b7280", "text-anchor": "middle", "font-size": 9 });
        svg.line(x, 0, x, 15).attr({ stroke: "#9ca3af", "stroke-opacity": 0.3 });
    }

    // Draw horizontal gain lines
    const step = 5;
    for (let g = EQMath.MIN_GAIN; g < EQMath.MAX_GAIN; g += step) {
        const y = EQMath.gainToY(g);
        if (Math.abs(EQMath.MAX_GAIN) - Math.abs(g) > step / 2) {
            svg.line(0, y, 5, y).attr({ stroke: "#9ca3af", "stroke-opacity": 0.3 });
            svg.text(7, y, "" + g)
                .attr({ fill: "#6b7280", "font-size": 9, "dominant-baseline": "middle" });
        }
    }
}

function xToFreqForLabel(x) { // l
    return Math.pow(x / EQMath.WIDTH, 4) * EQMath.MAX_FREQ;
}

// DRAG HANDLERS

const onDragStart = function () { // Q
    this.data("origTransform", this.transform().local);
    this.attr({ fill: "black" }); // Highlight while dragging
    if (onGainChangeStart) onGainChangeStart(); // Optional
};

function onDragGain(element, gainObj) { // oe
    return function (dx, dy, x, y, event) {
        // Calculate relative drag in SVG space
        const svgRect = getElementPos(gainSvg);
        let relY = y - svgRect[1];

        // Clamp to SVG height
        if (relY < 0 || relY >= EQMath.HEIGHT) return;

        // Gain limit check
        const k = EQMath.MIN_GAIN;
        const u = EQMath.MAX_GAIN;
        const range = u - k;
        const val = (1 - relY / EQMath.HEIGHT) * range + k; // f(relY) equivalent

        // Limit max gain (M = 30) - logic from original code
        // original: if (f(r) > M) ... M=30, same as u.
        // It seems it just updates visual position and gain value.

        gainObj.y = relY;
        gainObj.gain = EQMath.dbToGain(val); // Note: original used le(f(r)) which is 10^(db/10)

        this.attr({
            transform: this.data("origTransform") + (this.data("origTransform") ? "T" : "t") + [0, dy]
        });

        if (onGainChange) onGainChange(gainObj.gain);
    };
}

function onDragGainEnd(element, gainObj) { // se
    return function () {
        this.attr({ fill: "#f3f4f6" }); // Restore color (white/grey) 
        // Original se function: this.attr({ fill: q }); wait, gainLine is a line, fill has no effect? 
        // Ah, original used "fill: q" which is dark blue. Maybe it resets highlight.

        if (onGainChangeEnd) onGainChangeEnd(gainObj.gain);
        if (onRefresh) onRefresh();
    };
}

function onDragFilter(filter, index, svg) {
    return function (dx, dy, x, y, event) {
        // If shift key held, change Q (bandwidth)
        if (event.shiftKey) {
            filter.q = EQMath.limitQ(filter.q + event.movementY / 10);
        } else {
            const svgRect = getElementPos(svg);
            let relX = x - svgRect[0];
            let relY = y - svgRect[1];

            if (relX < 0 || relX >= EQMath.WIDTH || relY < 0 || relY >= EQMath.HEIGHT) return;

            filter.x = relX;
            filter.y = relY;
            // Calculate gain/freq from x/y
            // gain = f(relY)
            // freq = l(relX) which is xToFreqForLabel

            const range = EQMath.MAX_GAIN - EQMath.MIN_GAIN;
            const db = (1 - relY / EQMath.HEIGHT) * range + EQMath.MIN_GAIN;

            filter.gain = db;
            filter.frequency = xToFreqForLabel(relX);

            this.attr({
                transform: this.data("origTransform") + (this.data("origTransform") ? "T" : "t") + [dx, dy]
            });
        }

        // Update curve
        updateFilterCurve(svg, filter, index);

        if (onFilterChange) {
            onFilterChange(index, filter.frequency, filter.gain, filter.q, filter.t);
        }
    };
}

function onDragFilterEnd(filter, index) { // he
    return function () {
        // Restore color
        let color = "#2C3E50"; // q
        // Wait, original he sets fill to q. Circle fill was wheat or specific color.
        // Actually original sets fill back to q? That would make it invisible/dark?
        // Let's re-check original `he`.
        // `this.attr({ fill: q });` -> q is #2C3E50 (Dark Blue). Background is #2C3E50.
        // So drag end makes it disappear? Or maybe q is different.
        // `q` var definition: `var q = "#2C3E50";`
        // Maybe it acts as "unselected".
        // But `re` (draw curves) sets circles to specific colors!
        // `s` array creation in `$(e, t)`: `dotStyle = { fill: w ... }` or `fill: b`.
        // `w` is `#CDF7E1`, `b` is `#9573A8`.
        // So `he` making it `q` (#2C3E50) seems to hide it or resets to a default?
        // Ah `$(e, t)` redraws EVERYTHING.
        // `he` calls `n()` which is full refresh?

        // I will trust the original logic roughly but maybe use proper color restoration.
        // But since `he` calls `n()` (refresh), maybe `popup.js` re-renders everything anyway?

        // Original: `chrome.runtime.sendMessage(...)` then `n()`.

        if (onFilterChangeEnd) {
            onFilterChangeEnd(index, filter.frequency, filter.gain, filter.q, filter.t);
        }
        if (onRefresh) onRefresh();
    };
}


function getElementPos(el) { // v
    const rect = el.node.getClientRects()[0];
    return [rect.left, rect.top];
}


// The complex math for updating curves (d function)
function updateFilterCurve(svg, filter, index) { // d
    // filter has: frequency, q, gain, t (type)

    const r = filter.frequency;
    const a = filter.q;
    const i = filter.gain; // in dB
    const E = sampleRate; // use module-scoped sampleRate

    // Math logic from original `d` function
    const o = Math.tan((Math.PI * r) / E);
    let s, u = 0, l = 0, f_val = 0, v = 0, d = 0;

    // i is gain in dB.
    // c variable in d function: var c = Math.pow(10, Math.abs(i) / 20);
    const c_val = Math.pow(10, Math.abs(i) / 20);

    let h = "#9ca3af"; // color

    if (filter.t === "peaking") {
        h = "#818cf8"; // w -> Primary
        if (i >= 0) {
            s = 1 / (1 + (1 / a) * o + o * o);
            u = (1 + (c_val / a) * o + o * o) * s;
            l = 2 * (o * o - 1) * s;
            f_val = (1 - (c_val / a) * o + o * o) * s;
            v = l;
            d = (1 - (1 / a) * o + o * o) * s;
        } else {
            s = 1 / (1 + (c_val / a) * o + o * o);
            u = (1 + (1 / a) * o + o * o) * s;
            l = 2 * (o * o - 1) * s;
            f_val = (1 - (1 / a) * o + o * o) * s;
            v = l;
            d = (1 - (c_val / a) * o + o * o) * s;
        }
    } else if (filter.t === "highshelf") {
        h = "#22d3ee"; // b -> Accent
        // ... (copy math)
        const sqrt2 = Math.SQRT2;
        const sqrt2c = Math.sqrt(2 * c_val);

        if (i >= 0) {
            s = 1 / (1 + sqrt2 * o + o * o);
            u = (c_val + sqrt2c * o + o * o) * s;
            l = 2 * (o * o - c_val) * s;
            f_val = (c_val - sqrt2c * o + o * o) * s;
            v = 2 * (o * o - 1) * s;
            d = (1 - sqrt2 * o + o * o) * s;
        } else {
            s = 1 / (c_val + sqrt2c * o + o * o);
            u = (1 + sqrt2 * o + o * o) * s;
            l = 2 * (o * o - 1) * s;
            f_val = (1 - sqrt2 * o + o * o) * s;
            v = 2 * (o * o - c_val) * s;
            d = (c_val - sqrt2c * o + o * o) * s;
        }
    } else if (filter.t === "lowshelf") {
        h = "#22d3ee"; // b -> Accent
        const sqrt2 = Math.SQRT2;
        const sqrt2c = Math.sqrt(2 * c_val);

        if (i >= 0) {
            s = 1 / (1 + sqrt2 * o + o * o);
            u = (1 + sqrt2c * o + c_val * o * o) * s;
            l = 2 * (c_val * o * o - 1) * s;
            f_val = (1 - sqrt2c * o + c_val * o * o) * s;
            v = 2 * (o * o - 1) * s;
            d = (1 - sqrt2 * o + o * o) * s;
        } else {
            s = 1 / (1 + sqrt2c * o + c_val * o * o);
            u = (1 + sqrt2 * o + o * o) * s;
            l = 2 * (o * o - 1) * s;
            f_val = (1 - sqrt2 * o + o * o) * s;
            v = 2 * (c_val * o * o - 1) * s;
            d = (1 - sqrt2c * o + c_val * o * o) * s;
        }
    }

    // Calculate curve points
    let points = [];
    const T = EQMath.WIDTH;
    const B = EQMath.HEIGHT;

    for (let g = 0; g < T; g += 2) {
        const p = Math.pow(g / T, 4) * Math.PI; // L(g/T) * PI
        const yVal = Math.pow(Math.sin(p / 2), 2);

        // Complex formula from original code
        let M = Math.log(
            (Math.pow(u + l + f_val, 2) - 4 * (u * l + 4 * u * f_val + l * f_val) * yVal + 16 * u * f_val * yVal * yVal) /
            (Math.pow(1 + v + d, 2) - 4 * (v + 4 * d + v * d) * yVal + 16 * d * yVal * yVal)
        );

        M = (M * 10) / Math.LN10; // Convert to dB?  10 * log10(...)
        M = EQMath.gainToY(M);

        if (M === -Infinity) {
            M = B - 1;
        }

        if (Math.abs(M - B / 2) > 1) { // Optimization?
            // Use concat for flattening [x, y]
            points.push(g);
            points.push(M);
        }
    }

    // Gradient
    let gradientKey = null;
    const qColor = "rgba(0,0,0,0)"; // Transparent for gradient fade
    if (i >= 0) {
        gradientKey = svg.gradient("l(.5, 0, .5, 1)" + h + "-" + qColor);
    } else {
        gradientKey = svg.gradient("l(.5, 1, .5, 0)" + h + "-" + qColor);
    }

    // Remove old polyline if exists
    if (filterLines[index]) {
        filterLines[index].remove();
    }

    filterLines[index] = svg.polyline(points).attr({
        stroke: gradientKey,
        "fill-opacity": "0",
        "pointer-events": "none"
    });
}
