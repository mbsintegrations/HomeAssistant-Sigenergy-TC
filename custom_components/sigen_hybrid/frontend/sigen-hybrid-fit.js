/* SPDX-License-Identifier: GPL-3.0-only */
// Measure the space offered by a dashboard, rather than assuming a full-screen
// page. A shell can explicitly offer --sigen-embedded-height. Native panel views
// are capped by the visible viewport below their actual top edge.
export function installHostFit(Card) {
  const render = Card.prototype._render;
  Card.prototype._render = function () {
    render.call(this);
    const style = this.shadowRoot.querySelector?.('style');
    if (style) style.textContent += HOST_FIT_STYLE;
    this._hostFitMeasure?.();
  };
  const connected = Card.prototype.connectedCallback;
  const disconnected = Card.prototype.disconnectedCallback;
  Card.prototype.connectedCallback = function () {
    connected?.call(this);
    if (typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const box = this.getBoundingClientRect();
      if (!box.width || !this.isConnected) return;
      const viewport = globalThis.visualViewport;
      const bottom = viewport ? viewport.height + viewport.offsetTop : globalThis.innerHeight;
      const offered = parseFloat(getComputedStyle(this).getPropertyValue('--sigen-embedded-height'));
      const padding = this.parentElement ? parseFloat(getComputedStyle(this.parentElement).paddingBottom) || 0 : 0;
      const available = Math.floor(Math.min(bottom - box.top - padding, offered > 0 ? offered : Infinity));
      if (available <= 0) return;
      const value = `${available}px`;
      if (this.style.getPropertyValue('--sigen-host-height') !== value) this.style.setProperty('--sigen-host-height', value);
      this.toggleAttribute('data-sigen-fit', box.width >= 1100 && available >= 820);
    };
    this._hostFitMeasure = measure;
    this._hostFitObserver = new ResizeObserver(measure);
    this._hostFitObserver.observe(this);
    if (this.parentElement) this._hostFitObserver.observe(this.parentElement);
    globalThis.addEventListener('resize', measure);
    globalThis.visualViewport?.addEventListener('resize', measure);
    measure();
  };
  Card.prototype.disconnectedCallback = function () {
    this._hostFitObserver?.disconnect();
    globalThis.removeEventListener('resize', this._hostFitMeasure);
    globalThis.visualViewport?.removeEventListener('resize', this._hostFitMeasure);
    disconnected?.call(this);
  };
}

export const HOST_FIT_STYLE = `
/* Last in the cascade: embedded bounds must beat full-window media rules. */
ha-card.embedded-shell{height:var(--sigen-host-height,var(--sigen-embedded-height,100%))!important;max-height:var(--sigen-host-height,none);overflow:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable;min-width:0}
ha-card.embedded-shell>main{min-width:0;min-height:0}
:host(:not([data-sigen-fit])) ha-card.embedded-shell:has(main[data-view=overview]>.compact-overview){display:block!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell main:has(>.compact-overview){display:block!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .compact-overview{height:auto!important;grid-template-rows:minmax(min-content,1fr) auto!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .overview-summary-stack{height:auto!important;min-height:min-content;grid-template-rows:auto auto auto!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .hero{display:flex!important;flex-direction:column;grid-template-rows:none!important;min-width:0}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .main-display-stage{width:100%!important;flex:none;height:auto!important;aspect-ratio:2.05!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .main-display-stage[data-display=house]{aspect-ratio:1.18!important}
:host([data-sigen-fit]) ha-card:has(main[data-view=overview]>.compact-overview){height:var(--sigen-host-height,calc(100dvh - 56px))!important;min-height:0!important;display:grid!important;grid-template-rows:auto minmax(0,1fr)}
:host([data-sigen-fit]) main:has(>.compact-overview){min-height:0;display:grid!important;grid-template-rows:auto minmax(0,1fr)}
:host([data-sigen-fit]) main:has(>.overview-preview-toolbar){grid-template-rows:auto auto minmax(0,1fr)}
:host([data-sigen-fit]) .compact-overview.overview-aligned-controls{height:100%;min-height:0;grid-template-rows:minmax(min-content,1fr) 196px!important}
:host([data-sigen-fit]) .compact-overview .overview-summary-stack{min-height:min-content;grid-template-rows:auto minmax(min-content,1fr) auto}
.compact-overview .main-display-stage>.sigen-photo-scene{container-type:size;display:grid;place-items:center;isolation:isolate}
.compact-overview .main-display-stage .sigen-photo-frame{container-type:inline-size;flex:none;width:min(100cqw,calc(100cqh * 1490 / 673));height:min(100cqh,calc(100cqw * 673 / 1490));aspect-ratio:1490/673}
.compact-overview .sigen-photo-scene::before{content:'';position:absolute;inset:-20px;z-index:-1;background-image:var(--sigen-photo-image);background-size:cover;background-position:center;filter:blur(16px);opacity:.45}
/* The artwork, cables and labels keep one shared aspect ratio. */
@container sigen-card (min-width:651px) and (max-width:949px){
 .compact-overview .main-display-stage{aspect-ratio:2.05!important;max-height:none!important}
 .compact-overview .main-display-stage>.scene-wrap:has(>.house-layout){container-type:size;display:grid;place-items:center}
 .compact-overview .house-layout{width:min(100cqw,calc(100cqh * 1.18));height:min(100cqh,calc(100cqw / 1.18));aspect-ratio:1.18}
 .compact-overview .house-reading,.compact-overview .sigen-photo-node,.compact-overview .sigen-photo-leader{display:none!important}
 .compact-overview .mobile-power-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
}
@container sigen-card (max-width:650px){
 .compact-overview .house-canvas{left:0!important;top:0!important;width:100%!important;height:100%!important}
}
`;
