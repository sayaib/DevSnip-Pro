"use strict";
/**
 * GPU memory and speed estimates for running or fine-tuning a transformer LLM.
 *
 * Memory:
 *   weights   = parameters x bytes per parameter (+ ~6% for quantization scales at 8/4 bit)
 *   KV cache  = 2 x layers x kv_heads x head_dim x context x batch x kv_bytes
 *   training  = full fine-tune (AdamW, mixed precision): ~16 bytes / parameter
 *               LoRA / QLoRA: frozen base + 16 bytes per *trainable* parameter
 *   activations (training, with gradient checkpointing): ~2 x batch x context x hidden x layers x 2 bytes
 *   runtime overhead: ~1 GB (CUDA context, allocator fragmentation)
 * Speed:
 *   decode (tokens/s per sequence) ~ 60% of memory bandwidth / bytes read per token
 *   prefill (time to first token)  ~ 2 x parameters x prompt tokens / (40% of peak FLOPS)
 * These are planning estimates; real numbers depend on the serving stack.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestions = exports.gpusNeeded = exports.estimateSpeed = exports.estimateVram = exports.PRECISION_BYTES = exports.GPUS = exports.ARCHITECTURES = void 0;
exports.ARCHITECTURES = [
    { id: "llama-3.2-3b", label: "Llama 3.2 3B", paramsB: 3.2, layers: 28, hidden: 3072, kvHeads: 8, headDim: 128 },
    { id: "llama-3.1-8b", label: "Llama 3.1 8B", paramsB: 8.0, layers: 32, hidden: 4096, kvHeads: 8, headDim: 128 },
    { id: "mistral-7b", label: "Mistral 7B", paramsB: 7.2, layers: 32, hidden: 4096, kvHeads: 8, headDim: 128 },
    { id: "qwen2.5-7b", label: "Qwen2.5 7B", paramsB: 7.6, layers: 28, hidden: 3584, kvHeads: 4, headDim: 128 },
    { id: "gemma-2-9b", label: "Gemma 2 9B", paramsB: 9.2, layers: 42, hidden: 3584, kvHeads: 8, headDim: 256 },
    { id: "phi-3-mini", label: "Phi-3 mini 3.8B", paramsB: 3.8, layers: 32, hidden: 3072, kvHeads: 32, headDim: 96 },
    { id: "qwen2.5-32b", label: "Qwen2.5 32B", paramsB: 32.8, layers: 64, hidden: 5120, kvHeads: 8, headDim: 128 },
    { id: "llama-3.3-70b", label: "Llama 3.3 70B", paramsB: 70.6, layers: 80, hidden: 8192, kvHeads: 8, headDim: 128 },
    { id: "qwen2.5-72b", label: "Qwen2.5 72B", paramsB: 72.7, layers: 80, hidden: 8192, kvHeads: 8, headDim: 128 }
];
exports.GPUS = [
    { id: "t4", label: "NVIDIA T4 16GB", memoryGB: 16, bandwidthGBs: 320, tflops: 65 },
    { id: "rtx3090", label: "RTX 3090 24GB", memoryGB: 24, bandwidthGBs: 936, tflops: 71 },
    { id: "rtx4090", label: "RTX 4090 24GB", memoryGB: 24, bandwidthGBs: 1008, tflops: 165 },
    { id: "l4", label: "NVIDIA L4 24GB", memoryGB: 24, bandwidthGBs: 300, tflops: 121 },
    { id: "a10g", label: "NVIDIA A10G 24GB", memoryGB: 24, bandwidthGBs: 600, tflops: 70 },
    { id: "l40s", label: "NVIDIA L40S 48GB", memoryGB: 48, bandwidthGBs: 864, tflops: 362 },
    { id: "a100-40", label: "A100 40GB", memoryGB: 40, bandwidthGBs: 1555, tflops: 312 },
    { id: "a100-80", label: "A100 80GB", memoryGB: 80, bandwidthGBs: 2039, tflops: 312 },
    { id: "h100", label: "H100 SXM 80GB", memoryGB: 80, bandwidthGBs: 3350, tflops: 989 }
];
exports.PRECISION_BYTES = { fp32: 4, bf16: 2, fp16: 2, fp8: 1, int8: 1, int4: 0.5 };
const GB = 1024 ** 3;
function estimateVram(input) {
    const params = input.paramsB * 1e9;
    let weightBytesPerParam = exports.PRECISION_BYTES[input.precision] ?? 2;
    if (input.workload === "qlora")
        weightBytesPerParam = 0.5;
    if (input.workload === "full")
        weightBytesPerParam = 2; // bf16 working copy; master weights counted below
    // Quantized formats store scales / zero points: roughly 6% extra.
    const quantOverhead = weightBytesPerParam < 2 ? 1.06 : 1;
    const weightsGB = (params * weightBytesPerParam * quantOverhead) / GB;
    const kvBytes = input.kvPrecision === "fp8" ? 1 : 2;
    const kvCacheGB = input.workload === "inference"
        ? (2 * input.layers * input.kvHeads * input.headDim * input.context * input.batch * kvBytes) / GB
        : 0;
    let trainableParams = 0;
    let trainingStateGB = 0;
    let activationsGB = 0;
    if (input.workload !== "inference") {
        if (input.workload === "full") {
            trainableParams = params;
            // fp32 master weights (4) + bf16 gradients (2) + AdamW moments (8) on top of the bf16 weights above.
            trainingStateGB = (params * 14) / GB;
        }
        else {
            // LoRA on q, k, v, o projections: A (r x hidden) + B (hidden_out x r) per module.
            const kvOut = input.kvHeads * input.headDim;
            const perLayer = input.loraRank * (input.hidden + input.hidden) * 2 + input.loraRank * (input.hidden + kvOut) * 2;
            trainableParams = perLayer * input.layers;
            // bf16 adapter weights + fp32 grads + AdamW moments: ~16 bytes / trainable parameter.
            trainingStateGB = (trainableParams * 16) / GB;
        }
        // Activations with gradient checkpointing.
        activationsGB = (2 * input.batch * input.context * input.hidden * input.layers * 2) / GB;
    }
    else {
        // Transient activations during inference are small next to weights + KV.
        activationsGB = (input.batch * input.context * input.hidden * 2 * 4) / GB;
    }
    const overheadGB = 1;
    const totalGB = weightsGB + kvCacheGB + trainingStateGB + activationsGB + overheadGB;
    return { weightsGB, kvCacheGB, trainingStateGB, activationsGB, overheadGB, totalGB, trainableParams, weightBytesPerParam };
}
exports.estimateVram = estimateVram;
function estimateSpeed(input, breakdown, gpu, gpuCount) {
    const bytesPerToken = (breakdown.weightsGB + breakdown.kvCacheGB / Math.max(1, input.batch)) * GB;
    const bandwidth = gpu.bandwidthGBs * 1e9 * gpuCount * 0.6;
    const decodeTokensPerSecond = bandwidth / bytesPerToken;
    const flops = 2 * input.paramsB * 1e9 * input.promptTokens;
    const timeToFirstTokenMs = (flops / (gpu.tflops * 1e12 * gpuCount * 0.4)) * 1000;
    return { decodeTokensPerSecond, timeToFirstTokenMs };
}
exports.estimateSpeed = estimateSpeed;
function gpusNeeded(totalGB, gpu) {
    // Keep ~10% headroom per card.
    return Math.max(1, Math.ceil(totalGB / (gpu.memoryGB * 0.9)));
}
exports.gpusNeeded = gpusNeeded;
function suggestions(input, breakdown, gpu) {
    const notes = [];
    const fits = breakdown.totalGB <= gpu.memoryGB * 0.9;
    if (!fits) {
        if (input.workload === "full")
            notes.push("Full fine-tuning needs ~16 bytes per parameter. LoRA or QLoRA cuts this by an order of magnitude with similar quality for most tasks.");
        if (input.workload === "lora")
            notes.push("QLoRA (4-bit base model) typically reduces memory by 60-70% versus LoRA on a bf16 base.");
        if (input.workload === "inference" && input.precision !== "int4")
            notes.push("A 4-bit quantization (AWQ, GPTQ, GGUF Q4_K_M) roughly quarters the weight memory with a small quality loss.");
        if (breakdown.kvCacheGB > breakdown.weightsGB * 0.5)
            notes.push("The KV cache is a large share: lower the context length or concurrent sequences, or use an FP8 KV cache.");
        if (input.workload !== "inference" && breakdown.activationsGB > 4)
            notes.push("Activations are large: lower the micro-batch size and use gradient accumulation instead.");
    }
    if (input.workload === "inference" && input.batch > 1)
        notes.push("With several concurrent sequences, a server with paged attention (vLLM, TGI, SGLang) allocates KV cache on demand and fits more requests.");
    return notes;
}
exports.suggestions = suggestions;
//# sourceMappingURL=vram.js.map