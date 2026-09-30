import { useId } from 'react'

/**
 * TMark 品牌图标(橙色羊角锤):横向锤头(右端 V 形羊角开口)+ 居中下垂锤柄。
 * 与 public/favicon.svg 同形(同一造型),内联渲染(零额外网络请求)。
 * viewBox 贴边裁剪到字形外缘(x28..100 / y24..108,零留白),让锤子在给定高度下 100% 填满,
 * 从而与 ShellHeader 两行文字等高(移动 ~41px / sm ~42px,匹配实测文字块 40.79 / 41.79)。
 * favicon 仍保留 0 0 128 128 宽留白以适配 16px 标签页;此处贴边用于顶栏 logo。
 * useId 生成唯一渐变 id,允许同页多实例安全复用。
 */
export function TMarkLogo({ className }: { className?: string }) {
  const gid = `tmark-${useId().replace(/:/g, '')}`
  return (
    <svg
      viewBox="28 24 72 84"
      className={className}
      role="img"
      aria-label="TMark"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.62 0.14 39)" />
          <stop offset="1" stopColor="oklch(0.55 0.16 50)" />
        </linearGradient>
      </defs>
      {/* 锤头(横向,右端 V 形羊角)+ 居中下垂锤柄;单条 path,与 favicon 同形 */}
      <path fill={`url(#${gid})`} d="M28 24 L100 24 L100 32 L86 40 L100 48 L100 56 L72 56 L72 108 L56 108 L56 56 L28 56 Z" />
    </svg>
  )
}
