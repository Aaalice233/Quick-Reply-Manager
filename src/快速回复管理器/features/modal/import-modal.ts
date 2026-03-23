/**
 * 导入导出模态框
 * @description 提供高级导入功能，包括选择界面和冲突处理
 */

import type { Pack, Category, Item, Settings } from '../../types';
import { state, persistPack } from '../../store';
import { showModal, toast } from '../../ui/components';
import { renderWorkbench } from '../../ui/workbench';
import { validatePack } from '../import-export';
import { deepClone, nowIso } from '../../utils/data';
import { escapeHtml, uid } from '../../utils/dom';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 导入冲突项
 */
export interface ImportConflict {
  type: 'category' | 'item';
  incoming: Category | Item;
  existing: Category | Item;
  action: 'skip' | 'overwrite' | 'rename';
  rename: string;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 检查是否有占位符角色映射冲突
 * @param localSettings - 本地设置
 * @param incomingSettings - 导入的设置
 * @returns 是否有冲突
 */
function hasPlaceholderRoleMapConflict(localSettings: Settings, incomingSettings: Settings): boolean {
  const localMaps = localSettings?.placeholderRoleMaps?.byCharacterId || {};
  const incomingMaps = incomingSettings?.placeholderRoleMaps?.byCharacterId || {};
  for (const [characterId, incomingMap] of Object.entries(incomingMaps)) {
    const localMap = localMaps[characterId];
    if (!localMap) continue;
    for (const [placeholderKey, incomingValue] of Object.entries(incomingMap || {})) {
      if (!Object.prototype.hasOwnProperty.call(localMap, placeholderKey)) continue;
      if (String(localMap[placeholderKey] || '') !== String(incomingValue || '')) return true;
    }
  }
  return false;
}

/**
 * 合并占位符角色映射
 * @param localSettings - 本地设置
 * @param incomingSettings - 导入的设置
 * @param policy - 合并策略
 * @returns 合并后的角色映射
 */
function mergePlaceholderRoleMaps(
  localSettings: Settings,
  incomingSettings: Settings,
  policy: 'skip' | 'overwrite',
): Settings['placeholderRoleMaps'] {
  const localMaps = localSettings?.placeholderRoleMaps || { byCharacterId: {}, characterMeta: {} };
  const incomingMaps = incomingSettings?.placeholderRoleMaps || { byCharacterId: {}, characterMeta: {} };
  const mergedByCharacterId: Record<string, Record<string, string>> = deepClone(localMaps.byCharacterId || {});
  const mergedMeta: Record<string, { name: string; lastSeenAt: string }> = deepClone(localMaps.characterMeta || {});

  for (const [characterId, incomingMap] of Object.entries(incomingMaps.byCharacterId || {})) {
    const cur = mergedByCharacterId[characterId] || {};
    for (const [placeholderKey, incomingValue] of Object.entries(incomingMap || {})) {
      const hasLocal = Object.prototype.hasOwnProperty.call(cur, placeholderKey);
      if (!hasLocal || policy === 'overwrite') cur[placeholderKey] = String(incomingValue || '');
    }
    mergedByCharacterId[characterId] = cur;
  }

  for (const [characterId, meta] of Object.entries(incomingMaps.characterMeta || {})) {
    const localMeta = mergedMeta[characterId];
    if (!localMeta || policy === 'overwrite') {
      mergedMeta[characterId] = {
        name: String(meta?.name || ''),
        lastSeenAt: String(meta?.lastSeenAt || nowIso()),
      };
    }
  }

  return { byCharacterId: mergedByCharacterId, characterMeta: mergedMeta };
}

/**
 * 根据选择构建过滤后的导入数据
 * @param incoming - 原始导入数据
 * @param selectedCategoryIds - 选中的分类ID
 * @param selectedItemIds - 选中的条目ID
 * @returns 过滤后的导入数据
 */
function buildFilteredIncomingBySelection(
  incoming: Pack,
  selectedCategoryIds: string[],
  selectedItemIds: string[],
): Pack {
  const catIdSet = new Set(selectedCategoryIds);
  const itemIdSet = new Set(selectedItemIds);
  return {
    ...incoming,
    categories: incoming.categories.filter(c => catIdSet.has(c.id)),
    items: incoming.items.filter(i => itemIdSet.has(i.id)),
  };
}

// ============================================================================
// 模态框函数
// ============================================================================

/**
 * 打开导入选择模态框
 * @param incoming - 要导入的数据包
 * @param onDone - 完成回调
 */
export function openImportSelectionModal(
  incoming: Pack,
  onDone: (selected: Pack | null, includeSettings: boolean) => void,
): void {
  const pW = window.parent as typeof window;
  const pD = pW.document || document;

  showModal(closeSelect => {
    const card = pD.createElement('div');
    card.className = 'fp-modal-card';

    // 构建分类路径映射
    const pathMap = new Map<string, string>();
    const catById = new Map<string, Category>(incoming.categories.map(c => [c.id, c]));
    for (const cat of incoming.categories) {
      const names: string[] = [];
      let cur: Category | undefined = cat;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        names.unshift(cur.name);
        cur = cur.parentId ? catById.get(cur.parentId) : undefined;
      }
      pathMap.set(cat.id, names.join(' / '));
    }

    card.innerHTML = `
      <div class="fp-modal-title">🧩 导入前勾选</div>
      <div style="font-size:12px;color:#a7c8bc;margin-bottom:10px">先选择要导入的分类和条目，再进入冲突处理。</div>
      <div class="fp-row"><label>筛选</label><input class="fp-input" data-filter placeholder="按名称筛选..." /></div>
      <div class="fp-actions" style="justify-content:flex-start;margin-top:0">
        <button data-all>全选</button>
        <button data-none>全不选</button>
      </div>
      <div class="fp-row" style="margin-bottom:10px">
        <label>附加导入</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--qr-text-2);width:auto">
          <input type="checkbox" data-include-settings checked />
          <span>导入设置（占位符默认值 / 角色映射 / 连接符 / 主题 / 自定义CSS）</span>
        </label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:52vh;overflow:hidden">
        <div style="border:1px solid rgba(174,199,190,.2);border-radius:10px;overflow:auto">
          <div style="position:sticky;top:0;background:rgba(18,25,26,.96);padding:8px 10px;font-size:12px;color:#a7c8bc;border-bottom:1px solid rgba(174,199,190,.2)">分类（${incoming.categories.length}）</div>
          <div data-cats style="padding:8px"></div>
        </div>
        <div style="border:1px solid rgba(174,199,190,.2);border-radius:10px;overflow:auto">
          <div style="position:sticky;top:0;background:rgba(18,25,26,.96);padding:8px 10px;font-size:12px;color:#a7c8bc;border-bottom:1px solid rgba(174,199,190,.2)">条目（${incoming.items.length}）</div>
          <div data-items style="padding:8px"></div>
        </div>
      </div>
      <div class="fp-actions">
        <button data-close>取消</button>
        <button class="primary" data-next>下一步：冲突处理</button>
      </div>
    `;

    const catsWrap = card.querySelector('[data-cats]') as HTMLElement | null;
    const itemsWrap = card.querySelector('[data-items]') as HTMLElement | null;
    const filterInput = card.querySelector('[data-filter]') as HTMLInputElement | null;

    const renderLists = (): void => {
      const kw = (filterInput?.value || '').trim().toLowerCase();
      if (catsWrap) catsWrap.innerHTML = '';
      if (itemsWrap) itemsWrap.innerHTML = '';

      for (const cat of incoming.categories) {
        const p = pathMap.get(cat.id) || cat.name;
        if (kw && !p.toLowerCase().includes(kw)) continue;
        const row = pD.createElement('label');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:6px;border-radius:8px';
        row.innerHTML = `<input type="checkbox" data-cat-id="${escapeHtml(cat.id)}" checked /><span style="font-size:12px;line-height:1.35">${escapeHtml(p)}</span>`;
        catsWrap?.appendChild(row);
      }

      for (const item of incoming.items) {
        const full = `${pathMap.get(item.categoryId || '') || ''} / ${item.name}`;
        if (kw && !full.toLowerCase().includes(kw) && !(item.content || '').toLowerCase().includes(kw)) continue;
        const row = pD.createElement('label');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:6px;border-radius:8px';
        row.innerHTML = `<input type="checkbox" data-item-id="${escapeHtml(item.id)}" checked /><span style="font-size:12px;line-height:1.35"><b>${escapeHtml(item.name)}</b><br/><span style="opacity:.7">${escapeHtml(pathMap.get(item.categoryId || '') || '')}</span></span>`;
        itemsWrap?.appendChild(row);
      }
    };
    renderLists();

    if (filterInput) filterInput.oninput = renderLists;
    const allBtn = card.querySelector('[data-all]') as HTMLElement | null;
    if (allBtn)
      allBtn.onclick = () => {
        card.querySelectorAll('input[type="checkbox"]').forEach(el => {
          (el as HTMLInputElement).checked = true;
        });
      };
    const noneBtn = card.querySelector('[data-none]') as HTMLElement | null;
    if (noneBtn)
      noneBtn.onclick = () => {
        card.querySelectorAll('input[type="checkbox"]').forEach(el => {
          (el as HTMLInputElement).checked = false;
        });
      };

    const closeBtn = card.querySelector('[data-close]') as HTMLElement | null;
    if (closeBtn)
      closeBtn.onclick = () => {
        closeSelect();
        onDone(null, false);
      };

    const nextBtn = card.querySelector('[data-next]') as HTMLElement | null;
    if (nextBtn)
      nextBtn.onclick = () => {
        const selectedCategoryIds = [...card.querySelectorAll('input[data-cat-id]:checked')].map(
          el => el.getAttribute('data-cat-id') || '',
        );
        const selectedItemIds = [...card.querySelectorAll('input[data-item-id]:checked')].map(
          el => el.getAttribute('data-item-id') || '',
        );
        const includeSettings = !!(card.querySelector('[data-include-settings]') as HTMLInputElement | null)?.checked;
        const filtered = buildFilteredIncomingBySelection(incoming, selectedCategoryIds, selectedItemIds);
        if (!filtered.categories.length && !filtered.items.length && !includeSettings) {
          toast('请至少勾选一个分类或条目，或勾选导入设置');
          return;
        }
        closeSelect();
        onDone(filtered, includeSettings);
      };

    return card;
  });
}

/**
 * 打开冲突处理模态框
 * @param conflicts - 冲突列表
 * @param onApply - 应用回调
 */
export function openConflictResolutionModal(
  conflicts: ImportConflict[],
  onApply: (resolvedConflicts: ImportConflict[]) => void,
): void {
  const pW = window.parent as typeof window;
  const pD = pW.document || document;

  showModal(closeConflict => {
    const c2 = pD.createElement('div');
    c2.className = 'fp-modal-card';
    c2.innerHTML = `
      <div class="fp-modal-title">⚠️ 导入冲突处理</div>
      <div style="font-size:12px;color:#a7c8bc;margin-bottom:8px">可逐条选择：跳过 / 覆盖 / 重命名</div>
      <div style="max-height:52vh;overflow:auto" data-list></div>
      <div class="fp-actions">
        <button data-close>取消</button>
        <button class="primary" data-apply>应用并导入</button>
      </div>
    `;

    const list = c2.querySelector('[data-list]') as HTMLElement | null;
    conflicts.forEach((c, idx) => {
      const row = pD.createElement('div');
      row.style.cssText = 'padding:8px;border:1px solid rgba(174,199,190,.2);border-radius:10px;margin-bottom:8px';
      row.innerHTML = `
        <div style="font-size:12px;margin-bottom:6px">${c.type === 'category' ? '分类' : '条目'} 冲突：<b>${escapeHtml(c.incoming.name)}</b></div>
        <div class="fp-row"><label>策略</label>
          <select data-action="${idx}">
            <option value="skip" selected>跳过</option>
            <option value="overwrite">覆盖</option>
            <option value="rename">重命名导入</option>
          </select>
        </div>
        <div class="fp-row"><label>新名称</label><input class="fp-input" data-rename="${idx}" placeholder="仅在重命名时使用" /></div>
      `;
      list?.appendChild(row);
    });

    const conflictCloseBtn = c2.querySelector('[data-close]') as HTMLElement | null;
    if (conflictCloseBtn) conflictCloseBtn.onclick = closeConflict;
    const conflictApplyBtn = c2.querySelector('[data-apply]') as HTMLElement | null;
    if (conflictApplyBtn)
      conflictApplyBtn.onclick = () => {
        conflicts.forEach((c, idx) => {
          c.action = ((c2.querySelector(`[data-action="${idx}"]`) as HTMLSelectElement | null)?.value ||
            'skip') as ImportConflict['action'];
          c.rename = ((c2.querySelector(`[data-rename="${idx}"]`) as HTMLInputElement | null)?.value || '').trim();
        });
        onApply(conflicts);
        closeConflict();
      };

    return c2;
  });
}

/**
 * 应用导入
 * @param incoming - 导入的数据包
 * @param conflicts - 冲突处理列表
 * @param includeSettings - 是否包含设置
 * @param placeholderMapPolicy - 占位符映射策略
 */
export function applyImport(
  incoming: Pack,
  conflicts: ImportConflict[],
  includeSettings = false,
  placeholderMapPolicy: 'skip' | 'overwrite' = 'overwrite',
): void {
  if (!state.pack) return;
  const next = deepClone(state.pack);

  const conflictMap = new Map<string, ImportConflict>();
  for (const c of conflicts) {
    const key = `${c.type}::${c.incoming.id}`;
    conflictMap.set(key, c);
  }

  // 处理分类
  const catIdMap = new Map<string, string>();
  for (const c of incoming.categories) {
    const cf = conflictMap.get(`category::${c.id}`);
    if (!cf) {
      const copy = deepClone(c);
      if (next.categories.find(x => x.id === copy.id)) copy.id = uid('cat');
      next.categories.push(copy);
      catIdMap.set(c.id, copy.id);
      continue;
    }

    if (cf.action === 'skip') {
      catIdMap.set(c.id, (cf.existing as Category).id);
      continue;
    }
    if (cf.action === 'overwrite') {
      (cf.existing as Category).name = c.name;
      (cf.existing as Category).collapsed = c.collapsed;
      catIdMap.set(c.id, cf.existing.id);
      continue;
    }

    const renamed = deepClone(c);
    renamed.id = uid('cat');
    renamed.name = cf.rename || `${c.name}_导入`;
    next.categories.push(renamed);
    catIdMap.set(c.id, renamed.id);
  }

  // 处理条目
  for (const it of incoming.items) {
    const mappedCat = catIdMap.get(it.categoryId || '') || it.categoryId;
    const cf = conflictMap.get(`item::${it.id}`);
    if (!cf) {
      const copy = deepClone(it);
      copy.id = next.items.find(x => x.id === copy.id) ? uid('item') : copy.id;
      copy.categoryId = mappedCat || null;
      next.items.push(copy);
      continue;
    }
    if (cf.action === 'skip') continue;
    if (cf.action === 'overwrite') {
      (cf.existing as Item).content = it.content;
      (cf.existing as Item).mode = it.mode;
      (cf.existing as Item).favorite = it.favorite;
      (cf.existing as Item).categoryId = mappedCat || null;
      continue;
    }
    const renamed = deepClone(it);
    renamed.id = uid('item');
    renamed.name = cf.rename || `${it.name}_导入`;
    renamed.categoryId = mappedCat || null;
    next.items.push(renamed);
  }

  if (includeSettings) {
    next.settings = deepClone(incoming.settings);
    next.settings.placeholderRoleMaps = mergePlaceholderRoleMaps(
      state.pack.settings,
      incoming.settings,
      placeholderMapPolicy,
    );
  }

  state.pack = next;
  persistPack();
  renderWorkbench();
  toast('导入完成');
}

/**
 * 打开高级导入模态框（带选择界面和冲突处理）
 */
export function openAdvancedImportModal(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!validatePack(parsed)) {
        toast('无效的导入数据');
        return;
      }
      const incoming = parsed as Pack;

      openImportSelectionModal(incoming, (selectedIncoming, includeSettings) => {
        if (!selectedIncoming) return;
        if (!state.pack) return;

        // 询问占位符映射策略
        const askRoleMapPolicyThenApply = (doApply: (policy: 'skip' | 'overwrite') => void) => {
          if (!includeSettings || !hasPlaceholderRoleMapConflict(state.pack!.settings, selectedIncoming.settings)) {
            doApply('overwrite');
            return;
          }

          const pW = window.parent as typeof window;
          const pD = pW.document || document;

          showModal(closePolicy => {
            const policyCard = pD.createElement('div');
            policyCard.className = 'fp-modal-card';
            policyCard.innerHTML = `
              <div class="fp-modal-title">⚖️ 映射冲突处理</div>
              <div style="font-size:12px;color:#a7c8bc;margin-bottom:10px">检测到角色映射冲突，请选择一次性全局策略。</div>
              <div class="fp-row"><label>策略</label>
                <select data-map-policy>
                  <option value="skip">全部跳过冲突键（保留本地）</option>
                  <option value="overwrite" selected>全部覆盖冲突键（采用导入）</option>
                </select>
              </div>
              <div class="fp-actions">
                <button data-close>取消</button>
                <button class="primary" data-apply>确认</button>
              </div>
            `;
            const policyCloseBtn = policyCard.querySelector('[data-close]') as HTMLElement | null;
            if (policyCloseBtn) policyCloseBtn.onclick = closePolicy;
            const policyApplyBtn = policyCard.querySelector('[data-apply]') as HTMLElement | null;
            if (policyApplyBtn)
              policyApplyBtn.onclick = () => {
                const policy = ((policyCard.querySelector('[data-map-policy]') as HTMLSelectElement | null)?.value ||
                  'overwrite') as 'skip' | 'overwrite';
                closePolicy();
                doApply(policy);
              };
            return policyCard;
          });
        };

        // 检测冲突
        const conflicts: ImportConflict[] = [];
        const catByParentAndName = new Map<string, Category>();
        for (const c of state.pack.categories) {
          catByParentAndName.set(`${c.parentId || 'root'}::${c.name}`, c);
        }
        const itemByCatAndName = new Map<string, Item>();
        for (const i of state.pack.items) {
          itemByCatAndName.set(`${i.categoryId}::${i.name}`, i);
        }

        for (const cat of selectedIncoming.categories) {
          const key = `${cat.parentId || 'root'}::${cat.name}`;
          const hit = catByParentAndName.get(key);
          if (hit) conflicts.push({ type: 'category', incoming: cat, existing: hit, action: 'skip', rename: '' });
        }
        for (const item of selectedIncoming.items) {
          const key = `${item.categoryId}::${item.name}`;
          const hit = itemByCatAndName.get(key);
          if (hit) conflicts.push({ type: 'item', incoming: item, existing: hit, action: 'skip', rename: '' });
        }

        if (!conflicts.length) {
          askRoleMapPolicyThenApply(policy => {
            applyImport(selectedIncoming, [], includeSettings, policy);
          });
          return;
        }

        openConflictResolutionModal(conflicts, resolvedConflicts => {
          askRoleMapPolicyThenApply(policy => {
            applyImport(selectedIncoming, resolvedConflicts, includeSettings, policy);
          });
        });
      });
    } catch {
      toast('JSON解析失败');
    }
  };
  input.click();
}
