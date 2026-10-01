export interface LandingConfig {
  /** GitHub repository (source / releases). Primary CTA — opens in a new tab. */
  githubUrl: string
  /** Browser extension install section (in-page anchor). */
  extensionUrl: string
  /** Hero mascot portrait (transparent PNG/WebP preferred). Placeholder SVG for now. */
  heroChara: string
  /** Mascot variant for the red manifesto section. Placeholder SVG for now. */
  manifestoChara: string
  /** Small closing mascot anchored to the footer (decorative). Placeholder SVG for now. */
  footerChara: string
}

export const CONFIG: LandingConfig = {
  // TODO: replace with your TMarks GitHub repository URL before publishing.
  // Empty = the GitHub CTAs hide themselves instead of rendering a 404 link;
  // fill it in and they come back everywhere at once.
  githubUrl: 'https://github.com/tmarks-ai/Tmarks',
  // In-page anchor by default (the install section).
  extensionUrl: '#install',
  // TODO: drop the real Pixiu portrait here (e.g. '/pixiu-hero.webp').
  heroChara: '/pixiu-hero.svg',
  manifestoChara: '/pixiu-manifesto.svg',
  footerChara: '/pixiu-footer.svg',
}

/** GitHub CTA 开关:githubUrl 未配置时整体隐藏,绝不渲染指向占位地址的死链。 */
export const hasGitHub: boolean = CONFIG.githubUrl.trim() !== ''
