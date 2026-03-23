/**
 * 条目编辑模态框
 * @description 编辑快速回复条目的模态框功能
 */

// ============================================================================
// 状态导入
// ============================================================================
import { state } from '../../store';

// ============================================================================
// 工具函数导入
// ============================================================================
import { escapeHtml } from '../../utils/dom';

// ============================================================================
// 功能导入
// ============================================================================
import { getItemById, updateItem } from '../../features/items';

// ============================================================================
// UI 导入
// ============================================================================
import { iconSvg, showModal, toast } from '../../ui/components';
import { renderWorkbench } from '../../ui/workbench';

/**
 * 显示编辑条目模态框
 * @param itemId - 要编辑的条目 ID
 */
export function showEditItemModal(itemId: string): void {
  const item = getItemById(itemId);
  if (!item || !state.pack) return;

  showModal(close => {
    const container = document.createElement('div');
    container.className = 'fp-edit-modal';

    const header = document.createElement('div');
    header.className = 'fp-modal-header';
    header.innerHTML = `<h3>${iconSvg('pencil')} 编辑条目</h3>`;

    const content = document.createElement('div');
    content.className = 'fp-edit-content';
    content.innerHTML = `
      <div class="fp-form-group">
        <label>名称</label>
        <input type="text" class="fp-input" id="edit-name" value="${escapeHtml(item.name)}">
      </div>
      <div class="fp-form-group">
        <label>内容</label>
        <textarea class="fp-textarea" id="edit-content" rows="8">${escapeHtml(item.content)}</textarea>
      </div>
      <div class="fp-form-row">
        <div class="fp-form-group">
          <label>模式</label>
          <select class="fp-select" id="edit-mode">
            <option value="append" ${item.mode === 'append' ? 'selected' : ''}>追加</option>
            <option value="inject" ${item.mode === 'inject' ? 'selected' : ''}>注入</option>
          </select>
        </div>
        <div class="fp-form-group">
          <label>收藏</label>
          <input type="checkbox" id="edit-favorite" ${item.favorite ? 'checked' : ''}>
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.className = 'fp-modal-footer';
    footer.innerHTML = `
      <button class="fp-btn" id="cancel-edit">取消</button>
      <button class="fp-btn primary" id="save-edit">保存</button>
    `;

    container.appendChild(header);
    container.appendChild(content);
    container.appendChild(footer);

    // 绑定事件
    setTimeout(() => {
      const cancelBtn = container.querySelector('#cancel-edit');
      if (cancelBtn) cancelBtn.addEventListener('click', close);

      const saveBtn = container.querySelector('#save-edit');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const name = (container.querySelector('#edit-name') as HTMLInputElement)?.value;
          const content = (container.querySelector('#edit-content') as HTMLTextAreaElement)?.value;
          const mode = (container.querySelector('#edit-mode') as HTMLSelectElement)?.value as 'append' | 'inject';
          const favorite = (container.querySelector('#edit-favorite') as HTMLInputElement)?.checked;

          updateItem(itemId, {
            name: name?.trim() || item.name,
            content: content?.trim() || '',
            mode,
            favorite,
          });

          toast('条目已更新');
          renderWorkbench();
          close();
        });
      }
    }, 0);

    return container;
  });
}
