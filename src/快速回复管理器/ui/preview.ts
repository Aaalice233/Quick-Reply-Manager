/**
 * 预览面板模块
 * @description 处理预览面板的渲染、更新和占位符高亮显示
 */

import { state } from '../store';
import { escapeHtml } from '../utils/dom';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 预览令牌
 */
export interface PreviewToken {
  id: string;
  type: string;
  label: string;
  text?: string;
}

/**
 * 占位符映射值
 */
export interface PlaceholderValues {
  [key: string]: string;
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/**
 * 生成唯一ID
 */
function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * 连接器颜色映射
 */
const CONNECTOR_COLOR_HEX: Record<string, string> = {
  orange: '#f5a547',
  purple: '#b487ff',
  green: '#5dc97e',
  blue: '#60a6ff',
  red: '#ff6e6e',
  cyan: '#47d3e2',
};

/**
 * 解析预览令牌类型
 * @param token - 预览令牌
 * @returns 令牌类型样式类名
 */
function resolvePreviewTokenType(token: { type: string; label: string }): string {
  const t = String(token.type || '').trim();
  if (!t) return 'raw';
  if (t === 'item' || t === 'raw') return t;

  const connectors = state.pack?.settings?.connectors || [];
  const isColor = (v: string) => Object.prototype.hasOwnProperty.call(CONNECTOR_COLOR_HEX, v);

  if (t.startsWith('conn-id:')) {
    const id = t.slice('conn-id:'.length);
    const c = connectors.find(x => x.id === id);
    return c && isColor(c.color) ? `conn-${c.color}` : 'raw';
  }

  return 'raw';
}

/**
 * 创建拖拽幽灵元素
 */
function createDragGhost(sourceEl: HTMLElement): HTMLElement {
  const rect = sourceEl.getBoundingClientRect();
  const ghost = sourceEl.cloneNode(true) as HTMLElement;
  ghost.classList.remove('dragging', 'fp-token-dragging', 'is-pointer-dragging');
  ghost.classList.add('fp-drag-ghost');
  ghost.style.width = `${Math.max(40, Math.round(rect.width))}px`;
  ghost.style.height = `${Math.max(20, Math.round(rect.height))}px`;
  ghost.style.position = 'fixed';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '9999';
  ghost.style.opacity = '0.9';
  document.body.appendChild(ghost);
  return ghost;
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 高亮文本中的占位符
 * @param text - 包含占位符的原始文本
 * @returns 高亮后的HTML字符串
 */
export function highlightPlaceholders(text: string): string {
  const escaped = escapeHtml(text);
  // 匹配 {@key} 或 {@key:fallback} 格式的占位符
  return escaped.replace(/\{@[^}]+\}/g, match => {
    return `<span class="fp-placeholder-highlight">${match}</span>`;
  });
}

/**
 * 渲染预览面板容器
 * @param container - 容器元素
 */
export function renderPreviewPanel(container: HTMLElement): void {
  container.innerHTML = '';

  const tokens = state.pack?.uiState?.preview?.tokens || [];
  let insertIndicator: HTMLElement | null = null;

  const clearDropMarkers = () => {
    container.querySelectorAll('.fp-token.drop-before,.fp-token.drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
  };

  const ensureInsertIndicator = () => {
    if (!insertIndicator) {
      insertIndicator = document.createElement('span');
      insertIndicator.className = 'fp-token-insert-indicator';
    }
    return insertIndicator;
  };

  const clearInsertIndicator = () => {
    if (insertIndicator && insertIndicator.parentElement) {
      insertIndicator.remove();
    }
  };

  tokens.forEach((t, index) => {
    const chip = document.createElement('span');
    chip.className = `fp-token ${resolvePreviewTokenType(t)}`;
    chip.dataset.tokenIndex = String(index);

    // 标签文字
    const labelSpan = document.createElement('span');
    labelSpan.className = 'fp-token-label';
    labelSpan.textContent = t.label || '';
    chip.appendChild(labelSpan);

    // 删除按钮
    const del = document.createElement('span');
    del.className = 'fp-token-del';
    del.innerHTML = '✕';
    del.title = '删除';
    del.onclick = e => {
      e.stopPropagation();
      if (!state.pack) return;
      state.pack.uiState.preview.tokens.splice(index, 1);
      persistPackAndRefresh();
    };
    chip.appendChild(del);

    // 拖拽事件
    chip.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest('.fp-token-del')) return;

      const fromIndex = index;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let dropIndex = fromIndex;
      let ghost: HTMLElement | null = null;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < 6) return;
        if (!dragging) {
          dragging = true;
          container.classList.add('is-dragging-preview');
          chip.classList.add('fp-token-dragging');
          chip.style.pointerEvents = 'none';
          const indicator = ensureInsertIndicator();
          container.insertBefore(indicator, chip.nextSibling);
          ghost = createDragGhost(chip);
        }

        if (ghost) {
          ghost.style.left = `${Math.round(ev.clientX + 12)}px`;
          ghost.style.top = `${Math.round(ev.clientY + 12)}px`;
        }

        const indicator = ensureInsertIndicator();
        const otherChips = Array.from(container.querySelectorAll('.fp-token')).filter(
          el => el !== chip,
        ) as HTMLElement[];
        dropIndex = otherChips.length;
        for (let i = 0; i < otherChips.length; i++) {
          const rect = otherChips[i].getBoundingClientRect();
          if (ev.clientX < rect.left + rect.width / 2) {
            dropIndex = i;
            break;
          }
        }
        if (dropIndex >= otherChips.length) container.appendChild(indicator);
        else container.insertBefore(indicator, otherChips[dropIndex]);
        ev.preventDefault();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove as EventListener);
        window.removeEventListener('pointerup', onUp as EventListener);
        window.removeEventListener('pointercancel', onUp as EventListener);
        if (ghost) ghost.remove();
        chip.style.pointerEvents = '';
        chip.classList.remove('fp-token-dragging');
        container.classList.remove('is-dragging-preview');
        clearDropMarkers();
        clearInsertIndicator();

        if (!dragging || !state.pack) return;
        let toIndex = dropIndex;
        if (toIndex > fromIndex) toIndex -= 1;
        if (toIndex === fromIndex) return;
        const arr = state.pack.uiState.preview.tokens;
        const [moved] = arr.splice(fromIndex, 1);
        arr.splice(toIndex, 0, moved);
        persistPackAndRefresh();
      };

      window.addEventListener('pointermove', onMove as EventListener, { passive: false });
      window.addEventListener('pointerup', onUp as EventListener, { passive: false });
      window.addEventListener('pointercancel', onUp as EventListener, { passive: false });
    });

    container.appendChild(chip);
  });
}

/**
 * 更新预览内容
 * @param content - 要显示的预览内容文本
 */
export function updatePreview(content: string): void {
  if (!state.pack) return;

  // 解析内容中的令牌并更新预览状态
  const tokens = buildPreviewTokensFromContent(content);
  state.pack.uiState.preview.tokens = tokens;

  // 触发持久化和刷新
  persistPackAndRefresh();
}

/**
 * 从内容构建预览令牌
 * @param content - 内容文本
 * @returns 预览令牌数组
 */
function buildPreviewTokensFromContent(content: string): PreviewToken[] {
  const tokens: PreviewToken[] = [];
  const text = String(content || '').trim();
  if (!text) return tokens;

  // 简单的令牌解析：按连接器分割
  // 注意：可以扩展此逻辑以支持按连接器分割内容

  // 默认将整个内容作为一个原始令牌
  tokens.push({
    id: uid('tok'),
    type: 'raw',
    label: text.slice(0, 20) + (text.length > 20 ? '…' : ''),
    text: text,
  });

  return tokens;
}

/**
 * 渲染占位符预览
 * @param values - 占位符值映射
 * @returns 预览HTML字符串
 */
export function renderPlaceholderPreview(values: PlaceholderValues): string {
  const placeholders = state.pack?.settings?.placeholders || {};
  const mergedValues = { ...placeholders, ...values };

  const entries = Object.entries(mergedValues);
  if (!entries.length) return '<span class="fp-placeholder-empty">暂无占位符</span>';

  const chips = entries.map(([key, value]) => {
    const displayValue = String(value || key);
    return `
      <span class="fp-placeholder-chip" title="${escapeHtml(key)}: ${escapeHtml(displayValue)}">
        <span class="fp-placeholder-key">@${escapeHtml(key)}</span>
        <span class="fp-placeholder-value">${escapeHtml(displayValue)}</span>
      </span>
    `;
  });

  return `<div class="fp-placeholder-preview">${chips.join('')}</div>`;
}

/**
 * 持久化并刷新预览
 */
function persistPackAndRefresh(): void {
  // 注意：这里使用动态导入避免循环依赖
  import('../store').then(({ persistPack }) => {
    persistPack();
    refreshPreviewPanel();
  });
}

/**
 * 刷新所有预览面板
 */
export function refreshPreviewPanel(): void {
  const overlays = document.querySelectorAll('.fp-preview');
  overlays.forEach(el => {
    renderPreviewPanel(el as HTMLElement);
  });
}

/**
 * 获取当前预览令牌
 * @returns 当前预览令牌数组
 */
export function getPreviewTokens(): PreviewToken[] {
  return state.pack?.uiState?.preview?.tokens || [];
}

/**
 * 设置预览令牌
 * @param tokens - 预览令牌数组
 */
export function setPreviewTokens(tokens: PreviewToken[]): void {
  if (!state.pack) return;
  state.pack.uiState.preview.tokens = tokens.slice(0, 120); // 最多120个
}

/**
 * 添加预览令牌
 * @param type - 令牌类型
 * @param label - 显示标签
 * @param text - 完整文本
 */
export function addPreviewToken(type: string, label: string, text?: string): void {
  if (!state.pack) return;
  const arr = state.pack.uiState.preview.tokens || [];
  arr.push({
    id: uid('tok'),
    type,
    label: String(label || ''),
    text: String(text !== undefined ? text : label || ''),
  });
  if (arr.length > 120) arr.splice(0, arr.length - 120);
  state.pack.uiState.preview.tokens = arr;
  persistPackAndRefresh();
}

/**
 * 清空预览令牌
 */
export function clearPreviewTokens(): void {
  if (!state.pack) return;
  state.pack.uiState.preview.tokens = [];
  persistPackAndRefresh();
}
