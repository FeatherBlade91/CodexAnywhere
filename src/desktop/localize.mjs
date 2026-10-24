import { translator } from './renderer/i18n.js';
export const t = translator(process.env.CHATGPT_BRIDGE_LANGUAGE || 'zh-CN');
