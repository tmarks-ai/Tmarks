/**
 * 标签芯片样式(按 TagTheme 主题),移植自旧版 tagStyles。
 * classic/mono: 信息/成功/警告语义色;bw: 黑白标签 token。
 */

export type TagTheme = 'classic' | 'mono' | 'bw'

const TAG_CHIP_BASE_CLASS =
  'inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-200 active:scale-95'

/** 已选标签(蓝色 section)芯片样式。 */
export function getSelectedTagClass(theme: TagTheme): string {
  if (theme === 'bw') {
    return `${TAG_CHIP_BASE_CLASS} bg-[var(--tab-tag-selected-bg)] text-[var(--tab-tag-selected-text)]`
  }
  return `${TAG_CHIP_BASE_CLASS} bg-[var(--tab-message-info-icon)] text-[var(--tab-popup-primary-text)] shadow-sm`
}

/** 标签库中每个标签的样式(按是否已选)。 */
export function getExistingTagClass(theme: TagTheme, isSelected: boolean): string {
  if (theme === 'bw') {
    return isSelected
      ? `${TAG_CHIP_BASE_CLASS} bg-[var(--tab-tag-selected-bg)] text-[var(--tab-tag-selected-text)]`
      : `${TAG_CHIP_BASE_CLASS} border border-[var(--tab-tag-border)] bg-[var(--tab-tag-unselected-bg)] text-[var(--tab-tag-unselected-text)]`
  }
  return isSelected
    ? `${TAG_CHIP_BASE_CLASS} bg-[var(--tab-message-success-icon)] text-[var(--tab-popup-primary-text)] shadow-sm`
    : `${TAG_CHIP_BASE_CLASS} border border-[var(--tab-tag-border)] bg-[var(--tab-surface)] text-[var(--tab-text)] hover:bg-[var(--tab-surface-muted)]`
}

/** AI 推荐标签芯片样式(按是否已选/是否新标签)。 */
export function getSuggestedTagClass(theme: TagTheme, isSelected: boolean, isNew: boolean): string {
  if (theme === 'bw') {
    return isSelected
      ? `${TAG_CHIP_BASE_CLASS} bg-[var(--tab-tag-selected-bg)] text-[var(--tab-tag-selected-text)]`
      : `${TAG_CHIP_BASE_CLASS} border border-[var(--tab-tag-border)] bg-[var(--tab-tag-unselected-bg)] text-[var(--tab-tag-unselected-text)]`
  }
  if (isSelected) {
    return `${TAG_CHIP_BASE_CLASS} bg-[var(--tab-message-info-icon)] text-[var(--tab-popup-primary-text)] shadow-sm`
  }
  return isNew
    ? `${TAG_CHIP_BASE_CLASS} border border-[var(--tab-message-warning-border)] bg-[var(--tab-message-warning-bg)] text-[var(--tab-message-warning-icon)]`
    : `${TAG_CHIP_BASE_CLASS} border border-[var(--tab-tag-border)] bg-[var(--tab-surface)] text-[var(--tab-text)] hover:bg-[var(--tab-surface-muted)]`
}
