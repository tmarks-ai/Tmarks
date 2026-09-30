export const Z_INDEX = {
  BASE: 0,
  RAISED: 10,
  STICKY: 20,
  MODAL: 40,
  // Popover 与嵌套 modal 高于普通 modal:对话框内打开的下拉/选择器,
  // 以及对话框上再开的确认框,必须盖过对话框本体。
  POPOVER: 45,
  MODAL_NESTED: 45,
  TOAST: 50,
  TOOLTIP: 60,
  MOBILE_BOTTOM_NAV: 20,
} as const
