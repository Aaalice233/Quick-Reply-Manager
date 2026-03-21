import type { Pack } from '../types';

/**
 * 深克隆对象
 * @param v 要克隆的值
 * @returns 克隆后的值
 */
export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/**
 * 解析包的更新时间戳（毫秒）
 * @param pack 快速回复包
 * @returns 时间戳毫秒数，无效时返回0
 */
export function parsePackUpdatedAtMs(pack: Pack): number {
  const ts = String(
    (pack as unknown as { meta?: { updatedAt?: string; createdAt?: string } } | null | undefined)?.meta?.updatedAt ||
      (pack as unknown as { meta?: { updatedAt?: string; createdAt?: string } } | null | undefined)?.meta?.createdAt ||
      '',
  ).trim();
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 获取当前ISO格式时间字符串
 * @returns ISO格式时间字符串
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 分割多值字符串
 * @param raw - 原始字符串，支持逗号、换行、顿号等分隔符
 * @returns 分割后的值数组
 */
export function splitMultiValue(raw: string): string[] {
  return String(raw || '')
    .split(/[,\n，、|｜]+/g)
    .map(x => String(x || '').trim())
    .filter(Boolean);
}

/**
 * 连接多值数组
 * @param values - 值数组
 * @returns 连接后的字符串，使用顿号分隔
 */
export function joinMultiValue(values: string[]): string {
  return [...new Set((values || []).map(x => String(x || '').trim()).filter(Boolean))].join('、');
}
