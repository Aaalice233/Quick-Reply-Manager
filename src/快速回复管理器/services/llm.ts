/**
 * LLM服务
 * @description 提供AI生成功能的LLM API调用、预设管理和密钥配置
 */

import type { QrLlmPreset, QrLlmPresetStore, QrLlmSettings, QrLlmSecretConfig } from '../types';
import { QR_LLM_SECRET_KEY, DEFAULT_QR_LLM_PRESET_NAME, DEFAULT_QR_LLM_PRESET_VERSION } from '../constants';
import { state } from '../store';
import { fetchWithTimeout } from '../utils/network';
import { uid } from '../utils/dom';
import { truncateContent } from '../utils/data';
import { logError, pushDebugLog } from './debug';

// ============================================================================
// 辅助函数
// ============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function getRequestHeadersSafe(): Record<string, string> {
  try {
    const st = (window.parent as { SillyTavern?: { getRequestHeaders?: () => Record<string, string> } })?.SillyTavern;
    if (st?.getRequestHeaders) return st.getRequestHeaders();
  } catch (e) {
    // 忽略获取请求头失败，返回空对象
  }
  return {};
}

function validateApiUrlOrThrow(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('请先填写API URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error('API URL 格式不合法');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('API URL 仅支持 http/https 协议');
  }
  return parsed.toString();
}

function normalizeApiBaseUrl(rawUrl: string): string {
  let url = String(rawUrl || '').trim();
  if (!url) return '';
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/v\d+\/chat\/completions$/i, m => m.replace(/\/chat\/completions$/i, ''));
  url = url.replace(/\/chat\/completions$/i, '');
  url = url.replace(/\/completions$/i, '');
  return url.replace(/\/+$/, '');
}

function buildApiBaseCandidates(rawUrl: string): string[] {
  const input = String(rawUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!input) return [];
  const normalized = normalizeApiBaseUrl(input);
  const out = new Set<string>();
  const add = (u: string) => {
    const v = String(u || '')
      .trim()
      .replace(/\/+$/, '');
    if (v) out.add(v);
  };
  add(input);
  add(normalized);
  if (normalized) {
    if (/\/v\d+$/i.test(normalized)) {
      add(normalized.replace(/\/v\d+$/i, ''));
    } else {
      add(`${normalized}/v1`);
    }
  }
  return [...out];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseLooseScalar(raw: string): unknown {
  const text = String(raw || '').trim();
  if (!text.length) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^null$/i.test(text)) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseSimpleYamlObject(raw: string): Record<string, unknown> {
  const lines = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }];

  for (const sourceLine of lines) {
    const noComment = sourceLine.replace(/\s+#.*$/, '');
    if (!noComment.trim()) continue;
    const indent = (noComment.match(/^\s*/) || [''])[0].length;
    const line = noComment.trim();
    let sep = line.indexOf(':');
    if (sep <= 0) sep = line.indexOf('：');
    if (sep <= 0) throw new Error(`无效行：${sourceLine}`);
    const key = line.slice(0, sep).trim();
    const rest = line.slice(sep + 1).trim();
    if (!key) throw new Error(`空键名：${sourceLine}`);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;

    if (!rest) {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = parseLooseScalar(rest);
    }
  }

  return root;
}

function mergeDeepRecord(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) out[key] = mergeDeepRecord(prev, value);
    else out[key] = value;
  }
  return out;
}

function sanitizeLlmReqBodyForLog(reqBody: Record<string, unknown>): Record<string, unknown> {
  const cloned = deepClone(reqBody || {});
  const hdr = String((cloned.custom_include_headers as string) || '');
  if (hdr) {
    cloned.custom_include_headers = hdr.replace(/(Authorization:\s*Bearer\s+).+/i, '$1***');
  }
  if (Array.isArray(cloned.messages)) {
    cloned.messages = cloned.messages.map(msg => {
      const role = String((msg as { role?: string }).role || '');
      const content = String((msg as { content?: string }).content || '');
      return {
        role,
        contentPreview: truncateContent(content, 24),
        contentLength: content.length,
      };
    });
  }
  return cloned;
}

function summarizeLlmOutputForLog(text: string): { preview: string; length: number } {
  const compact = truncateContent(text, 180);
  return {
    preview: compact,
    length: compact.length,
  };
}

function extractContentFromGenerateJson(data: unknown): string {
  const anyData = data as Record<string, unknown>;
  if (!anyData || typeof anyData !== 'object') return '';
  if (typeof anyData.response === 'string') return anyData.response;
  const choices = Array.isArray(anyData.choices) ? anyData.choices : [];
  const first = choices[0] || {};
  const fromMessage = first?.message?.content;
  const fromText = first?.text;
  const fromDelta = first?.delta?.content;
  if (typeof fromMessage === 'string') return fromMessage;
  if (Array.isArray(fromMessage)) {
    const chunks = fromMessage
      .map(seg => {
        if (!seg || typeof seg !== 'object') return '';
        const txt = (seg as { text?: unknown }).text;
        if (typeof txt === 'string') return txt;
        const content = (seg as { content?: unknown }).content;
        return typeof content === 'string' ? content : '';
      })
      .filter(Boolean);
    if (chunks.length) return chunks.join('');
  }
  if (typeof fromText === 'string') return fromText;
  if (typeof fromDelta === 'string') return fromDelta;
  if (typeof anyData.content === 'string') return anyData.content;
  if (typeof anyData.text === 'string') return anyData.text;
  return '';
}

function buildOpenAiModelsUrl(apiBase: string): string {
  const base = normalizeApiBaseUrl(apiBase);
  if (!base) return '';
  if (/\/v\d+$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

function buildOpenAiChatCompletionsUrl(apiBase: string): string {
  const base = normalizeApiBaseUrl(apiBase);
  if (!base) return '';
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

// ============================================================================
// 占位符和模板处理
// ============================================================================

function getCurrentRolePlaceholderMap(_includeConnectors = false): Record<string, string> {
  const placeholders = state.pack?.settings?.placeholders || {};
  const roleValues: Record<string, string> = {};
  const activeCharacterId = state.activeCharacterId;
  if (activeCharacterId && state.pack?.settings?.placeholderRoleMaps?.byCharacterId?.[activeCharacterId]) {
    const charMap = state.pack.settings.placeholderRoleMaps.byCharacterId[activeCharacterId];
    for (const [k, v] of Object.entries(charMap || {})) {
      if (k) roleValues[k] = String(v ?? '');
    }
  }
  return { ...placeholders, ...roleValues };
}

function getEffectivePlaceholderValues(
  base: Record<string, string>,
  roleValues: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(base || {})) {
    out[key] = roleValues[key] ?? base[key] ?? '';
  }
  return out;
}

function extractPlaceholderTokens(text: string): string[] {
  const tokens = new Set<string>();
  const regex = /\{@[^}]+\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) tokens.add(m[0]);
  return [...tokens];
}

function extractPlaceholderFallbackMap(draft: string): Record<string, string> {
  const tokens = extractPlaceholderTokens(draft);
  const map: Record<string, string> = {};
  for (const token of tokens) {
    const inner = token.slice(2, -1);
    if (!inner.includes('|')) continue;
    const parts = inner.split('|').map(s => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) map[parts[0]] = parts[1];
  }
  return map;
}

function getEffectivePlaceholderMapForLlm(draft?: string): Record<string, string> {
  const placeholders = state.pack?.settings?.placeholders || {};
  const roleValues = getCurrentRolePlaceholderMap(false);
  const merged = getEffectivePlaceholderValues(placeholders, roleValues);
  return {
    ...merged,
    ...extractPlaceholderFallbackMap(String(draft || '')),
  };
}

function applyLlmPresetTemplate(template: string, draft: string, placeholderMap: Record<string, string>): string {
  const placeholderList =
    Object.keys(placeholderMap || {})
      .map(x => `- ${x}`)
      .join('\n') || '- (无)';
  const draftPlaceholderTokens = extractPlaceholderTokens(draft).join('\n') || '- (草稿中未出现占位符)';
  return String(template || '')
    .replaceAll('{{draft}}', String(draft || ''))
    .replaceAll('{{draft_placeholder_tokens}}', draftPlaceholderTokens)
    .replaceAll('{{placeholder_list}}', placeholderList)
    .replaceAll('{{placeholder_map_json}}', JSON.stringify(placeholderMap || {}, null, 2));
}

// ============================================================================
// 预设管理
// ============================================================================

export function normalizePromptGroup(raw: unknown): Array<{
  id?: string;
  role: 'SYSTEM' | 'USER' | 'ASSISTANT';
  position?: 'RELATIVE' | 'CHAT';
  enabled?: boolean;
  content: string;
  note?: string;
  name?: string;
  injectionDepth?: number;
  injectionOrder?: number;
  marker?: boolean;
  forbidOverrides?: boolean;
}> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{
    id?: string;
    role: 'SYSTEM' | 'USER' | 'ASSISTANT';
    position?: 'RELATIVE' | 'CHAT';
    enabled?: boolean;
    content: string;
    note?: string;
    name?: string;
    injectionDepth?: number;
    injectionOrder?: number;
    marker?: boolean;
    forbidOverrides?: boolean;
  }> = [];
  raw.forEach(seg => {
    if (!seg || typeof seg !== 'object') return;
    const roleRaw = String((seg as { role?: string }).role || '').toUpperCase();
    const role = roleRaw === 'USER' || roleRaw === 'ASSISTANT' ? roleRaw : 'SYSTEM';
    const content = String((seg as { content?: string }).content || '');
    const note = String(
      (seg as { note?: string; remark?: string; name?: string; title?: string }).note ||
        (seg as { remark?: string }).remark ||
        (seg as { name?: string }).name ||
        (seg as { title?: string }).title ||
        '',
    ).trim();
    const rawPos = String((seg as { position?: string }).position || '').toUpperCase();
    const rawInjectionPos = Number((seg as { injection_position?: number }).injection_position);
    const position: 'RELATIVE' | 'CHAT' =
      rawPos === 'CHAT' || rawPos === 'IN_CHAT' || rawPos === 'CHAT_INJECTION' || rawInjectionPos === 1
        ? 'CHAT'
        : 'RELATIVE';
    const enabled =
      typeof (seg as { enabled?: boolean }).enabled === 'boolean'
        ? Boolean((seg as { enabled?: boolean }).enabled)
        : true;
    const identifier = String(
      (seg as { id?: string; identifier?: string }).id || (seg as { identifier?: string }).identifier || '',
    ).trim();
    const injectionDepth = Number(
      (seg as { injectionDepth?: number; injection_depth?: number }).injectionDepth ??
        (seg as { injection_depth?: number }).injection_depth ??
        4,
    );
    const injectionOrder = Number(
      (seg as { injectionOrder?: number; injection_order?: number }).injectionOrder ??
        (seg as { injection_order?: number }).injection_order ??
        100,
    );
    const marker = Boolean((seg as { marker?: boolean }).marker);
    const forbidOverrides = Boolean(
      (seg as { forbidOverrides?: boolean; forbid_overrides?: boolean }).forbidOverrides ??
      (seg as { forbid_overrides?: boolean }).forbid_overrides,
    );
    if (!content.trim()) return;
    out.push({
      id: identifier || uid('qrp'),
      role,
      position,
      enabled,
      content,
      note: note || undefined,
      name: note || undefined,
      injectionDepth: Number.isFinite(injectionDepth) ? injectionDepth : 4,
      injectionOrder: Number.isFinite(injectionOrder) ? injectionOrder : 100,
      marker: marker || undefined,
      forbidOverrides: forbidOverrides || undefined,
    });
  });
  return out;
}

export function compileQrLlmPreset(preset: QrLlmPreset): QrLlmPreset {
  const promptGroup = normalizePromptGroup(preset.promptGroup);
  const activePromptGroup = promptGroup.filter(x => x.enabled !== false);
  const relativePromptGroup = activePromptGroup.filter(x => String(x.position || 'RELATIVE') === 'RELATIVE');
  const chatPromptGroup = activePromptGroup.filter(x => String(x.position || 'RELATIVE') === 'CHAT');

  let systemPrompt = String(preset.systemPrompt || '').trim();
  let userPromptTemplate = String(preset.userPromptTemplate || '').trim();

  if (activePromptGroup.length) {
    const systemSegs = relativePromptGroup
      .filter(x => x.role === 'SYSTEM')
      .map(x => x.content.trim())
      .filter(Boolean);
    const userSegs = relativePromptGroup
      .filter(x => x.role === 'USER')
      .map(x => x.content.trim())
      .filter(Boolean);
    const assistantSegs = relativePromptGroup
      .filter(x => x.role === 'ASSISTANT')
      .map(x => x.content.trim())
      .filter(Boolean);
    const chatSegs = chatPromptGroup
      .map(x => `[${x.role}] ${String(x.content || '').trim()}`)
      .filter(x => String(x || '').trim());
    if (systemSegs.length) {
      systemPrompt = systemSegs.join('\n\n');
    }
    const userParts: string[] = [];
    if (userSegs.length) userParts.push(userSegs.join('\n\n'));
    if (assistantSegs.length) userParts.push(assistantSegs.join('\n\n'));
    if (chatSegs.length) userParts.push(chatSegs.join('\n\n'));
    if (userParts.length) userPromptTemplate = userParts.join('\n\n');
  }

  if (!systemPrompt) systemPrompt = '你是执行内容扩写助手。';
  if (!userPromptTemplate) userPromptTemplate = '{{draft}}';

  return {
    systemPrompt,
    userPromptTemplate,
    promptGroup: promptGroup.length ? promptGroup : undefined,
    finalSystemDirective: undefined,
    updatedAt: String(preset.updatedAt || nowIso()),
  };
}

function sanitizeDefaultQrLlmPreset(preset: QrLlmPreset): QrLlmPreset {
  const filteredPromptGroup = normalizePromptGroup(preset.promptGroup).filter(seg => {
    const marker = `${String(seg.name || '')} ${String(seg.note || '')}`.toLowerCase();
    return !marker.includes('final');
  });
  return compileQrLlmPreset({
    ...preset,
    promptGroup: filteredPromptGroup,
    finalSystemDirective: '',
  });
}

/**
 * 创建默认预设存储
 * @returns 默认的LLM预设存储
 */
export function buildDefaultQrLlmPresetStore(): QrLlmPresetStore {
  const now = nowIso();
  const defaultPromptGroup = [
    {
      id: uid('qrp'),
      role: 'ASSISTANT' as const,
      name: '执行角色',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '你是"快速回复执行内容润写助手"。',
        '把用户给出的简短草稿润成可直接使用的一小段自然中文。',
        '必须保持草稿原意，不擅自改目标，不偷换人物关系。',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'SYSTEM' as const,
      name: '回复格式规范',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '只输出最终可执行正文。',
        '默认写成 1 段自然语言，不列提纲、不编号、不分条。',
        '不要输出解释、注释、前言、后记、分析过程。',
        '不要写"执行要求如下""当前场景聚焦于"这类模板腔。',
        '不要输出 Markdown 代码块围栏。',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'USER' as const,
      name: 'QR草稿输入',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '【草稿】',
        '{{draft}}',
        '',
        '【草稿中已出现的占位符原文】',
        '{{draft_placeholder_tokens}}',
        '',
        '【可用占位符】',
        '{{placeholder_list}}',
        '',
        '【占位符映射(JSON)】',
        '{{placeholder_map_json}}',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'SYSTEM' as const,
      name: '变量MAP使用规范',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '草稿里已经出现的占位符，必须原样保留并沿用，不要改写成别的格式。',
        '如果占位符在映射中有值，可以用来理解语义，但输出时优先复用草稿里的原占位符文本。',
        '未映射的占位符保持原样，不要删除、不硬编码。',
        '不要新增未提供的新占位符键名。',
        '保持占位符结构可替换性，不破坏现有占位符语法。',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'SYSTEM' as const,
      name: '扩写策略',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '优先补足最必要的信息，让句子顺、清楚、能直接用。',
        '除非草稿本身信息很多，否则控制在 1 到 3 句，不要明显扩太长。',
        '避免空泛套话，避免与草稿无关的新增设定，避免过度戏剧化和过强结构感。',
      ].join('\n'),
    },
  ];
  return {
    version: 1,
    defaultPresetVersion: DEFAULT_QR_LLM_PRESET_VERSION,
    presets: {
      [DEFAULT_QR_LLM_PRESET_NAME]: {
        systemPrompt: '',
        userPromptTemplate: '',
        promptGroup: defaultPromptGroup,
        updatedAt: now,
      },
    },
  };
}

/**
 * 规范化预设存储数据
 * @param store - 原始预设存储数据
 * @returns 规范化后的预设存储
 */
export function normalizeQrLlmPresetStore(store: QrLlmPresetStore | null | undefined): QrLlmPresetStore {
  const safe = (
    store && typeof store === 'object' ? deepClone(store) : { version: 1, presets: {} }
  ) as QrLlmPresetStore;
  safe.version = 1;
  const currentDefaultPresetVersion = Number(safe.defaultPresetVersion) || 0;
  safe.presets = safe.presets && typeof safe.presets === 'object' ? safe.presets : {};
  const legacyDefaultNames = ['默认扩写预设', '默认预设(旧)', 'default'];
  legacyDefaultNames.forEach(legacy => {
    if (!safe.presets[legacy]) return;
    if (!safe.presets[DEFAULT_QR_LLM_PRESET_NAME]) {
      safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = deepClone(safe.presets[legacy]);
    }
    delete safe.presets[legacy];
  });
  for (const [name, preset] of Object.entries(safe.presets)) {
    if (!name || !preset || typeof preset !== 'object') {
      delete safe.presets[name];
      continue;
    }
    safe.presets[name] = compileQrLlmPreset({
      systemPrompt: String(preset.systemPrompt || ''),
      userPromptTemplate: String(preset.userPromptTemplate || ''),
      promptGroup: normalizePromptGroup((preset as QrLlmPreset).promptGroup),
      finalSystemDirective: String((preset as QrLlmPreset).finalSystemDirective || ''),
      updatedAt: String(preset.updatedAt || nowIso()),
    });
  }
  const defaultStore = buildDefaultQrLlmPresetStore();
  const defaultPreset = defaultStore.presets[DEFAULT_QR_LLM_PRESET_NAME];
  const shouldRefreshDefaultPreset = currentDefaultPresetVersion < DEFAULT_QR_LLM_PRESET_VERSION;
  if (!safe.presets[DEFAULT_QR_LLM_PRESET_NAME] || shouldRefreshDefaultPreset) {
    const def = defaultPreset;
    safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = deepClone(def);
  } else {
    const def = defaultPreset;
    const migrated = safe.presets[DEFAULT_QR_LLM_PRESET_NAME];
    if (!normalizePromptGroup(migrated.promptGroup).length) {
      safe.presets[DEFAULT_QR_LLM_PRESET_NAME].promptGroup = deepClone(def.promptGroup);
    }
    safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = sanitizeDefaultQrLlmPreset(safe.presets[DEFAULT_QR_LLM_PRESET_NAME]);
  }
  safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = sanitizeDefaultQrLlmPreset(safe.presets[DEFAULT_QR_LLM_PRESET_NAME]);
  safe.defaultPresetVersion = DEFAULT_QR_LLM_PRESET_VERSION;
  return safe;
}

/**
 * 获取默认LLM设置
 * @returns 默认的LLM设置对象
 */
export function getDefaultQrLlmSettings(): QrLlmSettings {
  const presetStore = buildDefaultQrLlmPresetStore();
  return {
    enabledStream: true,
    generationParams: {
      temperature: 1,
      top_p: 1,
      max_tokens: 8192,
      presence_penalty: 0,
      frequency_penalty: 0,
    },
    activePresetName: presetStore.presets[DEFAULT_QR_LLM_PRESET_NAME]
      ? DEFAULT_QR_LLM_PRESET_NAME
      : Object.keys(presetStore.presets)[0] || '',
    presetStore,
  };
}

function normalizeQrLlmSecret(raw: unknown): QrLlmSecretConfig {
  const safe = (raw && typeof raw === 'object' ? raw : {}) as Partial<QrLlmSecretConfig>;
  const manual = String(safe.manualModelId || '').trim();
  const selected = String(safe.model || '').trim();
  const extraBodyParamsText = String(
    (safe as { extraBodyParamsText?: string; extraBodyParams?: string }).extraBodyParamsText ||
      (safe as { extraBodyParamsText?: string; extraBodyParams?: string }).extraBodyParams ||
      '',
  );
  return {
    url: String(safe.url || '').trim(),
    apiKey: String(safe.apiKey || ''),
    model: selected || manual,
    manualModelId: manual || selected,
    extraBodyParamsText,
  };
}

function readQrLlmSecretFromScriptVariables(): QrLlmSecretConfig | null {
  try {
    if (typeof getVariables !== 'function') return null;
    const vars = (getVariables({ type: 'script' }) || {}) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(vars, QR_LLM_SECRET_KEY)) return null;
    const raw = vars[QR_LLM_SECRET_KEY];
    if (raw && typeof raw === 'object') return normalizeQrLlmSecret(raw);
    if (typeof raw === 'string' && String(raw).trim()) {
      try {
        return normalizeQrLlmSecret(JSON.parse(raw));
      } catch (e) {
        logError('读取LLM私密配置失败(script/json)', String(e));
        return null;
      }
    }
    return null;
  } catch (e) {
    logError('读取LLM私密配置失败(script)', String(e));
    return null;
  }
}

function writeQrLlmSecretToScriptVariables(secret: QrLlmSecretConfig): boolean {
  try {
    if (typeof insertOrAssignVariables === 'function') {
      insertOrAssignVariables({ [QR_LLM_SECRET_KEY]: secret }, { type: 'script' });
      return true;
    }
    if (typeof updateVariablesWith === 'function') {
      updateVariablesWith(
        vars => {
          vars[QR_LLM_SECRET_KEY] = secret;
          return vars;
        },
        { type: 'script' },
      );
      return true;
    }
  } catch (e) {
    logError('写入LLM私密配置失败(script)', String(e));
  }
  return false;
}

// ============================================================================
// 密钥管理
// ============================================================================

/**
 * 从localStorage加载密钥配置
 * @returns 加载的密钥配置，如果不存在则返回规范化后的空配置
 */
export function loadQrLlmSecretConfig(): QrLlmSecretConfig {
  const readRaw = (storage: Storage): string | null => {
    try {
      return storage.getItem(`__${QR_LLM_SECRET_KEY}__`);
    } catch (e) {
      return null;
    }
  };
  const parseRaw = (raw: string | null, source: string): QrLlmSecretConfig | null => {
    if (!raw || !String(raw).trim()) return null;
    try {
      return normalizeQrLlmSecret(JSON.parse(raw));
    } catch (e) {
      logError(`读取LLM私密配置失败(${source})`, String(e));
      return null;
    }
  };

  const scriptHit = readQrLlmSecretFromScriptVariables();
  const localHit = parseRaw(readRaw(window.parent.localStorage), 'localStorage');
  const sessionHit = parseRaw(readRaw(window.parent.sessionStorage), 'sessionStorage');
  const normalized = scriptHit || localHit || sessionHit || normalizeQrLlmSecret(null);
  state.qrLlmSecretCache = normalized;
  if (!scriptHit && (localHit || sessionHit)) {
    // Migrate legacy browser storage secret into SillyTavern script variables.
    writeQrLlmSecretToScriptVariables(normalized);
  }
  if (scriptHit || localHit || sessionHit) {
    try {
      window.parent.localStorage.setItem(`__${QR_LLM_SECRET_KEY}__`, JSON.stringify(normalized));
    } catch (e) {
      // 忽略localStorage写入失败
    }
    try {
      window.parent.sessionStorage.setItem(`__${QR_LLM_SECRET_KEY}__`, JSON.stringify(normalized));
    } catch (e) {
      // 忽略sessionStorage写入失败
    }
  }
  return normalized;
}

/**
 * 保存密钥配置到localStorage
 * @param secret - 要保存的密钥配置
 * @returns 是否成功保存
 */
export function saveQrLlmSecretConfig(secret: QrLlmSecretConfig): boolean {
  const normalized = normalizeQrLlmSecret(secret);
  state.qrLlmSecretCache = normalized;
  let anySaved = false;
  if (writeQrLlmSecretToScriptVariables(normalized)) anySaved = true;
  try {
    window.parent.localStorage.setItem(`__${QR_LLM_SECRET_KEY}__`, JSON.stringify(normalized));
    anySaved = true;
  } catch (e) {
    logError('写入LLM私密配置(localStorage)失败', String(e));
  }
  try {
    window.parent.sessionStorage.setItem(`__${QR_LLM_SECRET_KEY}__`, JSON.stringify(normalized));
    anySaved = true;
  } catch (e) {
    console.error('[快速回复管理器] 保存LLM私密配置失败', e);
    logError('保存LLM私密配置失败', String(e));
  }
  return anySaved;
}

/**
 * 获取LLM密钥配置（使用缓存）
 * @returns 当前的LLM密钥配置
 */
export function getQrLlmSecretConfig(): QrLlmSecretConfig {
  if (!state.qrLlmSecretCache) return loadQrLlmSecretConfig();
  return normalizeQrLlmSecret(state.qrLlmSecretCache);
}

// ============================================================================
// 模型获取
// ============================================================================

async function fetchModelsViaDirectOpenAi(apiBase: string, apiKey: string): Promise<string[]> {
  const modelsUrl = buildOpenAiModelsUrl(apiBase);
  if (!modelsUrl) return [];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  pushDebugLog('实际API请求 直连模型列表', {
    url: modelsUrl,
    headers: { ...headers, Authorization: apiKey ? 'Bearer ***' : '' },
  });
  const res = await fetchWithTimeout(modelsUrl, { method: 'GET', headers });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? ` (${detail.slice(0, 120)})` : ''}`);
  }
  const data = await res.json();
  const modelsRaw = Array.isArray(data?.models)
    ? data.models
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];
  const models: string[] = modelsRaw
    .map((m: unknown) => (typeof m === 'string' ? m : String((m as { id?: string })?.id || '')))
    .map((x: string) => String(x || '').trim())
    .filter((x: string): x is string => Boolean(x));
  return models;
}

/**
 * 获取可用模型列表
 * @param secret - 包含API URL和密钥的配置
 * @returns 可用的模型ID列表
 * @throws 当API请求失败时抛出错误
 */
export async function fetchQrLlmModels(secret: QrLlmSecretConfig): Promise<string[]> {
  const url = validateApiUrlOrThrow(secret.url || '');
  const candidates = buildApiBaseCandidates(url);
  const errors: string[] = [];

  for (const apiBase of candidates) {
    const body = {
      reverse_proxy: apiBase,
      proxy_password: '',
      chat_completion_source: 'custom',
      custom_url: apiBase,
      custom_include_headers: secret.apiKey ? `Authorization: Bearer ${secret.apiKey}` : '',
    };
    pushDebugLog('实际API请求 /api/backends/chat-completions/status', sanitizeLlmReqBodyForLog(body));
    try {
      const res = await fetchWithTimeout('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: { ...getRequestHeadersSafe(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        errors.push(`${apiBase} -> ${res.status} ${res.statusText}${detail ? ` (${detail.slice(0, 120)})` : ''}`);
        continue;
      }
      const data = await res.json();
      const modelsRaw = Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
      const models: string[] = modelsRaw
        .map((m: unknown) => (typeof m === 'string' ? m : String((m as { id?: string })?.id || '')))
        .map((x: string) => String(x || '').trim())
        .filter((x: string): x is string => Boolean(x));
      if (models.length) return [...new Set(models)];
      errors.push(`${apiBase} -> 模型列表为空`);
    } catch (e) {
      errors.push(`${apiBase} -> ${String(e)}`);
    }
  }

  // 某些服务在 status 过程中会先探测根路径，可能误报 403；兜底直连 OpenAI 模型列表接口
  for (const apiBase of candidates) {
    try {
      const models = await fetchModelsViaDirectOpenAi(apiBase, secret.apiKey || '');
      if (models.length) return [...new Set(models)];
      errors.push(`${apiBase} -> 直连模型列表为空`);
    } catch (e) {
      errors.push(`${apiBase} -> 直连模型列表失败: ${String(e)}`);
    }
  }

  const errorSummary = errors.length
    ? errors
        .slice(0, 3)
        .map((e, i) => `[${i + 1}] ${e.slice(0, 200)}`)
        .join('; ')
    : '';
  throw new Error(`状态检查失败（已尝试: ${candidates.join(' , ')}）${errorSummary ? ` | ${errorSummary}` : ''}`);
}

// ============================================================================
// 生成
// ============================================================================

export function parseAdditionalBodyParams(raw: string): Record<string, unknown> {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) throw new Error('附加参数必须是对象');
    return parsed;
  } catch (e) {
    const parsedYaml = parseSimpleYamlObject(text);
    if (!isPlainObject(parsedYaml)) throw new Error('附加参数必须是对象');
    return parsedYaml;
  }
}

/**
 * 调用LLM生成API
 * @param messages - 消息列表
 * @param opts - 生成选项
 * @returns 生成的文本内容
 * @throws 当API请求失败时抛出错误
 */
export async function callQrLlmGenerate(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: {
    stream: boolean;
    model: string;
    params: QrLlmSettings['generationParams'];
    secretOverride?: QrLlmSecretConfig;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
  },
): Promise<string> {
  const secret = opts.secretOverride || getQrLlmSecretConfig();
  const model = String(opts.model || secret.manualModelId || secret.model || '').trim();
  const validatedUrl = validateApiUrlOrThrow(secret.url || '');
  if (!model) throw new Error('模型ID未配置');
  let extraBodyParams: Record<string, unknown> = {};
  try {
    extraBodyParams = parseAdditionalBodyParams(secret.extraBodyParamsText || '');
  } catch (e) {
    pushDebugLog('附加参数解析失败，已忽略本次附加参数', e instanceof Error ? e.message : String(e));
    extraBodyParams = {};
  }
  const candidates = buildApiBaseCandidates(validatedUrl);
  const errors: string[] = [];

  for (const apiBase of candidates) {
    const reqBodyBase = {
      messages,
      model,
      temperature: Number(opts.params.temperature),
      top_p: Number(opts.params.top_p),
      max_tokens: Number(opts.params.max_tokens),
      presence_penalty: Number(opts.params.presence_penalty),
      frequency_penalty: Number(opts.params.frequency_penalty),
      stream: Boolean(opts.stream),
      chat_completion_source: 'custom',
      reverse_proxy: apiBase,
      custom_url: apiBase,
      custom_include_headers: secret.apiKey ? `Authorization: Bearer ${secret.apiKey}` : '',
    };
    const reqBody = mergeDeepRecord(reqBodyBase as unknown as Record<string, unknown>, extraBodyParams);
    pushDebugLog('实际API请求 /api/backends/chat-completions/generate', sanitizeLlmReqBodyForLog(reqBody));

    try {
      const res = await fetchWithTimeout('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getRequestHeadersSafe(), 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
        signal: opts.signal,
      });
      if (!res.ok) {
        let detail = '';
        try {
          detail = await res.text();
        } catch (e) {
          // 忽略响应文本读取失败
        }
        pushDebugLog('AI请求失败', {
          apiBase,
          status: res.status,
          statusText: res.statusText,
          detail: detail ? detail.slice(0, 500) : '',
        });
        errors.push(`${apiBase} -> ${res.status} ${res.statusText}`);
        continue;
      }

      if (!opts.stream || !res.body) {
        let data: unknown;
        try {
          data = await res.json();
        } catch (e) {
          pushDebugLog('非流式解析错误', `JSON解析失败: ${String(e)}`);
          throw new Error(`响应JSON解析失败: ${String(e)}`);
        }
        const text = extractContentFromGenerateJson(data);
        if (!text) throw new Error('响应中未找到可用文本');
        pushDebugLog('AI返回（非流式）', summarizeLlmOutputForLog(text));
        return text;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let out = '';
      let sawSse = false;
      let parseErrors = 0;
      const MAX_PARSE_ERRORS = 10;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const lineRaw of lines) {
          const line = String(lineRaw || '').trim();
          if (!line) continue;
          if (!line.startsWith('data:')) continue;
          sawSse = true;
          const dataText = line.slice(5).trim();
          if (!dataText || dataText === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataText);
            const delta =
              String(parsed?.choices?.[0]?.delta?.content ?? '') ||
              String(parsed?.choices?.[0]?.message?.content ?? '') ||
              String(parsed?.text ?? '') ||
              '';
            if (delta) {
              out += delta;
              opts.onDelta?.(out);
            }
          } catch (e) {
            parseErrors++;
            if (parseErrors <= MAX_PARSE_ERRORS) {
              pushDebugLog('流式解析警告', `非JSON数据被忽略 (${parseErrors})`);
            }
          }
        }
      }

      if (!out && parseErrors > 0) {
        pushDebugLog('流式响应警告', `输出为空，解析错误次数: ${parseErrors}`);
      }

      if (out) {
        pushDebugLog('AI返回（流式）', summarizeLlmOutputForLog(out));
        return out;
      }
      const tail = `${buffer}${decoder.decode()}`.trim();
      if (!sawSse && tail) {
        try {
          const parsed = JSON.parse(tail);
          const text = extractContentFromGenerateJson(parsed);
          if (text) {
            pushDebugLog('AI返回（流式尾包）', summarizeLlmOutputForLog(text));
            return text;
          }
        } catch (e) {
          // 忽略JSON解析失败，继续返回原始文本
        }
        pushDebugLog('AI返回（流式尾包原文）', summarizeLlmOutputForLog(tail));
        return tail;
      }
      throw new Error('流式响应为空');
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      errors.push(`${apiBase} -> ${String(e)}`);
    }
  }

  // 某些服务在酒馆后端代理路径下会触发额外探测，兜底直连 OpenAI 兼容接口
  for (const apiBase of candidates) {
    const directUrl = buildOpenAiChatCompletionsUrl(apiBase);
    if (!directUrl) continue;
    const directBodyBase = {
      messages,
      model,
      temperature: Number(opts.params.temperature),
      top_p: Number(opts.params.top_p),
      max_tokens: Number(opts.params.max_tokens),
      presence_penalty: Number(opts.params.presence_penalty),
      frequency_penalty: Number(opts.params.frequency_penalty),
      stream: Boolean(opts.stream),
    };
    const directBody = mergeDeepRecord(directBodyBase as unknown as Record<string, unknown>, extraBodyParams);
    pushDebugLog('实际API请求 直连 /v1/chat/completions', {
      url: directUrl,
      headers: { Authorization: secret.apiKey ? 'Bearer ***' : '' },
      body: sanitizeLlmReqBodyForLog(directBody),
    });
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret.apiKey) headers.Authorization = `Bearer ${secret.apiKey}`;
      const res = await fetchWithTimeout(directUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(directBody),
        signal: opts.signal,
      });
      if (!res.ok) {
        let detail = '';
        try {
          detail = await res.text();
        } catch (e) {
          // 忽略响应文本读取失败
        }
        pushDebugLog('AI直连请求失败', {
          url: directUrl,
          status: res.status,
          statusText: res.statusText,
          detail: detail ? detail.slice(0, 500) : '',
        });
        errors.push(`${directUrl} -> ${res.status} ${res.statusText}`);
        continue;
      }

      if (!opts.stream || !res.body) {
        const data = await res.json();
        const text = extractContentFromGenerateJson(data);
        if (!text) throw new Error('响应中未找到可用文本');
        pushDebugLog('AI返回（直连非流式）', summarizeLlmOutputForLog(text));
        return text;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let out = '';
      let sawSse = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const lineRaw of lines) {
          const line = String(lineRaw || '').trim();
          if (!line) continue;
          if (!line.startsWith('data:')) continue;
          sawSse = true;
          const dataText = line.slice(5).trim();
          if (!dataText || dataText === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataText);
            const delta =
              String(parsed?.choices?.[0]?.delta?.content ?? '') ||
              String(parsed?.choices?.[0]?.message?.content ?? '') ||
              String(parsed?.text ?? '') ||
              '';
            if (delta) {
              out += delta;
              opts.onDelta?.(out);
            }
          } catch (e) {
            // 忽略：后端可能混入非JSON心跳包
          }
        }
      }

      if (out) {
        pushDebugLog('AI返回（直连流式）', summarizeLlmOutputForLog(out));
        return out;
      }
      const tail = `${buffer}${decoder.decode()}`.trim();
      if (!sawSse && tail) {
        try {
          const parsed = JSON.parse(tail);
          const text = extractContentFromGenerateJson(parsed);
          if (text) {
            pushDebugLog('AI返回（直连流式尾包）', summarizeLlmOutputForLog(text));
            return text;
          }
        } catch (e) {
          // 忽略JSON解析失败，继续返回原始文本
        }
        pushDebugLog('AI返回（直连流式尾包原文）', summarizeLlmOutputForLog(tail));
        return tail;
      }
      throw new Error('流式响应为空');
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      errors.push(`${directUrl} -> ${String(e)}`);
    }
  }

  throw new Error(`请求失败（已尝试: ${candidates.join(' , ')}）${errors.length ? ` - ${errors[0]}` : ''}`);
}

function getActiveQrLlmPreset(): QrLlmPreset {
  const fallbackStore = buildDefaultQrLlmPresetStore();
  const qrLlm = state.pack?.settings?.qrLlm;
  if (!qrLlm) return fallbackStore.presets[Object.keys(fallbackStore.presets)[0]];
  const name = qrLlm.activePresetName;
  const preset = qrLlm.presetStore?.presets?.[name];
  if (preset) return preset;
  return fallbackStore.presets[Object.keys(fallbackStore.presets)[0]];
}

/**
 * 生成扩展内容
 * @param draft - 草稿内容
 * @param opts - 生成选项
 * @returns 生成的扩展文本
 * @throws 当数据未初始化或配置不完整时抛出错误
 */
export async function generateQrExpandedContent(
  draft: string,
  opts?: { onDelta?: (content: string) => void; signal?: AbortSignal },
): Promise<string> {
  if (!state.pack) throw new Error('数据未初始化');
  const qrLlm = state.pack.settings.qrLlm;
  const secret = getQrLlmSecretConfig();
  const modelId = String(secret.manualModelId || secret.model || '').trim();
  if (!secret.url) throw new Error('请先在设置中填写 API URL');
  if (!modelId) throw new Error('请先在设置中选择或填写模型ID');

  const placeholderMap = getEffectivePlaceholderMapForLlm(draft);
  const preset = getActiveQrLlmPreset();
  const systemPrompt = String(preset.systemPrompt || '').trim() || '你是执行内容扩写助手。';
  const userPromptTemplate = String(preset.userPromptTemplate || '').trim() || '{{draft}}';
  const userPrompt = applyLlmPresetTemplate(userPromptTemplate, draft, placeholderMap);
  const messageList: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  return callQrLlmGenerate(messageList, {
    stream: Boolean(qrLlm.enabledStream),
    model: modelId,
    params: qrLlm.generationParams,
    signal: opts?.signal,
    onDelta: opts?.onDelta,
  });
}

/**
 * 测试LLM连接
 * @param secret - 密钥配置
 * @param modelOverride - 可选的模型覆盖
 * @returns 连接测试结果
 * @throws 当连接测试失败时抛出错误
 */
export async function testQrLlmConnection(secret: QrLlmSecretConfig, modelOverride?: string): Promise<string> {
  const model = String(modelOverride || secret.manualModelId || secret.model || '').trim();
  if (!secret.url) throw new Error('请先填写API URL');
  if (!model) throw new Error('请先选择或填写模型ID');
  const text = await callQrLlmGenerate(
    [
      {
        role: 'system',
        content: '你是连通性测试助手。严格只输出小写字符串：ok。不得输出任何解释、思考、标点或多余字符。',
      },
      { role: 'user', content: 'ok' },
    ],
    {
      stream: false,
      model,
      secretOverride: secret,
      params: {
        temperature: 0.1,
        top_p: 1,
        max_tokens: 16,
        presence_penalty: 0,
        frequency_penalty: 0,
      },
    },
  );
  const normalized = String(text || '')
    .trim()
    .toLowerCase();
  if (normalized === 'ok' || normalized.startsWith('ok')) return 'ok';
  throw new Error(`测试返回非ok: ${normalized.slice(0, 30) || 'empty'}`);
}

/**
 * 使当前编辑生成失效
 * @description 中止当前生成请求并重置所有编辑生成状态字段
 * @param shouldAbort - 是否中止当前abortController，默认为true
 */
export function invalidateEditGeneration(shouldAbort = true): void {
  if (shouldAbort && state.editGenerateState.abortController) {
    try {
      state.editGenerateState.abortController.abort();
    } catch {
      // 忽略中止过程中的错误
    }
  }
  state.editGenerateState.isGenerating = false;
  state.editGenerateState.abortController = null;
  state.editGenerateState.lastDraftBeforeGenerate = '';
  state.editGenerateState.lastGeneratedText = '';
  state.editGenerateState.status = '';
  state.editGenerateState.requestSeq += 1;
}
