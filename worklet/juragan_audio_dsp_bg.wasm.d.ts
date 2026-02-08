/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const __wbg_dynamicsprocessor_free: (a: number, b: number) => void;
export const __wbg_juraganaudiodsp_free: (a: number, b: number) => void;
export const __wbg_sbrprocessor_free: (a: number, b: number) => void;
export const dynamicsprocessor_get_reduction_db: (a: number) => number;
export const dynamicsprocessor_new: (a: number) => number;
export const dynamicsprocessor_process_block: (a: number, b: number, c: number, d: any, e: number, f: number, g: any) => void;
export const dynamicsprocessor_set_limiter_options: (a: number, b: number, c: number) => void;
export const juraganaudiodsp_get_fft: (a: number, b: number, c: number) => [number, number];
export const juraganaudiodsp_get_reduction_db: (a: number) => number;
export const juraganaudiodsp_is_sbr_active: (a: number) => number;
export const juraganaudiodsp_new: (a: number) => number;
export const juraganaudiodsp_process_stereo: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: number, j: number, k: any) => void;
export const juraganaudiodsp_set_filter: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
export const juraganaudiodsp_set_gain: (a: number, b: number) => void;
export const juraganaudiodsp_set_limiter_options: (a: number, b: number, c: number) => void;
export const juraganaudiodsp_set_sbr_options: (a: number, b: number, c: number) => void;
export const sbrprocessor_is_enabled: (a: number) => number;
export const sbrprocessor_new: (a: number) => number;
export const sbrprocessor_process_block: (a: number, b: number, c: number, d: any, e: number, f: number, g: any, h: number) => void;
export const sbrprocessor_set_options: (a: number, b: number, c: number) => void;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
