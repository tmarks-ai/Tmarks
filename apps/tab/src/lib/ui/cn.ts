/**
 * 统一 className 合并器:re-export 自 lib/utils/cn(clsx + tailwind-merge)。
 * tailwind-merge 让后传的类覆盖前传的冲突类(如 radius/spacing),供整个 lib/ui kit 与各组件共用。
 */
export { cn } from '../utils/cn'
