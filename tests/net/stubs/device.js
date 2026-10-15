// bản giả js/device.js cho test node: TIER theo biến môi trường HP_TIER (mặc định 3)
export const TIER = +(globalThis.process?.env?.HP_TIER || 3);
export const LITE = TIER <= 1;
export const HAS_TOUCH = false, IS_MOBILE = false, GPU_NAME = 'node';
export const GFX = {};
