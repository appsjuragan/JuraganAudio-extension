// WebGPU Spectrum Renderer
// Renders FFT data using compute/fragment shaders

class SpectrumRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.adapter = null;
        this.device = null;
        this.context = null;
        this.pipeline = null;
        this.frequencyBuffer = null;
        this.uniformBuffer = null;
        this.bindGroup = null;

        this.isRunning = false;
        this.animationId = null;

        // Configuration
        this.fftSize = 256; // Number of bars to render
        this.barWidth = 2.0 / this.fftSize;
    }

    async init() {
        if (!navigator.gpu) {
            console.error("WebGPU not supported on this browser.");
            return false;
        }

        this.adapter = await navigator.gpu.requestAdapter();
        if (!this.adapter) {
            console.error("No WebGPU adapter found.");
            return false;
        }

        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu');

        const format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: format,
            alphaMode: 'premultiplied',
        });

        await this.initShaders(format);
        await this.initBuffers();

        console.log("WebGPU Spectrum Renderer initialized");
        return true;
    }

    async initShaders(format) {
        // Load WGSL shader
        const response = await fetch(chrome.runtime.getURL('webgpu/shaders/spectrum.wgsl'));
        const shaderCode = await response.text();

        const shaderModule = this.device.createShaderModule({
            code: shaderCode
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: format,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        }
                    }
                }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });
    }

    async initBuffers() {
        // Uniform buffer (screen size, bar count)
        const uniformData = new Float32Array([
            this.canvas.width, this.canvas.height, // resolution
            this.fftSize,                          // barCount
            this.barWidth,                         // barWidth (NDC)
            0.0                                    // padding
        ]);

        this.uniformBuffer = this.device.createBuffer({
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        // Frequency data storage buffer
        const frequencyDataSize = this.fftSize * 4; // float32
        this.frequencyBuffer = this.device.createBuffer({
            size: frequencyDataSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // Create bind group
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: this.frequencyBuffer },
                },
            ],
        });
    }

    updateFrequencyData(fftData) {
        if (!this.device || !this.frequencyBuffer) return;

        // Map FFT data (0-255) to 0.0-1.0
        // And resample to match bar count if needed
        const data = new Float32Array(this.fftSize);

        // Simple downsampling/averaging
        const step = Math.floor(fftData.length / this.fftSize);

        for (let i = 0; i < this.fftSize; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) {
                sum += fftData[i * step + j] || 0;
            }
            // Normalize: input is likely -100dB to -30dB or linear
            // Assuming linear for now based on AnalyserNode getByteFrequencyData
            // If float data, it handles differently
            data[i] = (sum / step) / 255.0;
        }

        this.device.queue.writeBuffer(this.frequencyBuffer, 0, data);
    }

    render() {
        if (!this.context || !this.pipeline) return;

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }, // Transparent background
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        // Draw 6 vertices per bar (2 triangles)
        passEncoder.draw(6 * this.fftSize);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        const loop = () => {
            if (!this.isRunning) return;
            this.render();
            this.animationId = requestAnimationFrame(loop);
        };
        loop();
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}
