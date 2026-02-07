// WebGPU Spectrum Analyzer Shader
// Renders frequency bars with gradients

struct Uniforms {
    resolution: vec2f,
    barCount: f32,
    barWidth: f32,
    gap: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> frequencyData: array<f32>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let instanceIndex = vertexIndex / 6u;
    let cornerIndex = vertexIndex % 6u;
    
    let barCount = u32(uniforms.barCount);
    if (instanceIndex >= barCount) {
        return VertexOutput(vec4f(0.0, 0.0, 0.0, 0.0), vec4f(0.0));
    }
    
    // Get frequency magnitude (0.0 to 1.0)
    let magnitude = frequencyData[instanceIndex];
    
    // Bar dimensions (in NDC space -1.0 to 1.0)
    let totalWidth = 2.0;
    let barStep = totalWidth / uniforms.barCount;
    let barWidthNDC = barStep * 0.8; // 80% width, 20% gap
    
    let xCenter = -1.0 + (f32(instanceIndex) + 0.5) * barStep;
    let yBottom = -1.0;
    let yTop = -1.0 + magnitude * 1.8; // Max height slightly less than top
    
    // Rectangle vertices (2 triangles)
    var pos: vec2f;
    switch (cornerIndex) {
        case 0u: { pos = vec2f(xCenter - barWidthNDC/2.0, yBottom); } // Bottom-left
        case 1u: { pos = vec2f(xCenter + barWidthNDC/2.0, yBottom); } // Bottom-right
        case 2u: { pos = vec2f(xCenter - barWidthNDC/2.0, yTop); }    // Top-left
        case 3u: { pos = vec2f(xCenter - barWidthNDC/2.0, yTop); }    // Top-left
        case 4u: { pos = vec2f(xCenter + barWidthNDC/2.0, yBottom); } // Bottom-right
        default: { pos = vec2f(xCenter + barWidthNDC/2.0, yTop); }    // Top-right
    }
    
    // Color gradient based on frequency index and magnitude
    let normalizedFreq = f32(instanceIndex) / uniforms.barCount;
    
    // Color palette (Purple -> Blue -> Cyan -> Green)
    let color1 = vec3f(0.5, 0.0, 1.0); // Purple
    let color2 = vec3f(0.0, 0.5, 1.0); // Blue
    let color3 = vec3f(0.0, 1.0, 0.5); // Cyan
    
    var color: vec3f;
    if (normalizedFreq < 0.5) {
        color = mix(color1, color2, normalizedFreq * 2.0);
    } else {
        color = mix(color2, color3, (normalizedFreq - 0.5) * 2.0);
    }
    
    // Brighten based on magnitude
    color = color * (0.5 + magnitude * 0.5);
    
    return VertexOutput(vec4f(pos, 0.0, 1.0), vec4f(color, 1.0));
}

@fragment
fn fs_main(@location(0) color: vec4f) -> @location(0) vec4f {
    return color;
}
