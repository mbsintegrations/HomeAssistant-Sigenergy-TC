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
      const offeredValue = getComputedStyle(this).getPropertyValue('--sigen-embedded-height').trim();
      const offered = /^\d+(?:\.\d+)?px$/.test(offeredValue) ? parseFloat(offeredValue) : NaN;
      const padding = this.parentElement ? parseFloat(getComputedStyle(this.parentElement).paddingBottom) || 0 : 0;
      const available = Math.floor(Math.min(bottom - box.top - padding, offered > 0 ? offered : Infinity));
      if (available <= 0) return;
      const value = `${available}px`;
      if (this.style.getPropertyValue('--sigen-host-height') !== value) this.style.setProperty('--sigen-host-height', value);
      // Below this space budget, preserve readable controls in a scrollable
      // layout instead of compressing panels until their contents overlap.
      const fit = box.width >= 950 && available >= 660;
      this.toggleAttribute('data-sigen-fit', fit);
      this.toggleAttribute('data-sigen-compact-fit', fit && (box.width < 1100 || available < 820));
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
:host(:not([data-sigen-fit])) ha-card.embedded-shell .hero,:host(:not([data-sigen-fit])) ha-card.embedded-shell .overview-sidebar{grid-row:auto!important;grid-column:auto!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .overview-sidebar{display:flex!important;flex-direction:column;grid-template-rows:none!important;align-self:start;min-height:0}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .overview-sidebar>.overview-summary-stack,:host(:not([data-sigen-fit])) ha-card.embedded-shell .overview-sidebar>.overview-device-links{flex:none;grid-row:auto!important;height:auto!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .main-display-stage{width:100%!important;flex:none;height:auto!important;aspect-ratio:2.05!important}
:host(:not([data-sigen-fit])) ha-card.embedded-shell .main-display-stage[data-display=house]{aspect-ratio:1.18!important}
:host([data-sigen-fit]) ha-card:has(main[data-view=overview]>.compact-overview){height:var(--sigen-host-height,calc(100dvh - 56px))!important;min-height:0!important;display:grid!important;grid-template-rows:auto minmax(0,1fr)}
:host([data-sigen-fit]) main:has(>.compact-overview){min-height:0;display:grid!important;grid-template-rows:auto minmax(0,1fr)}
:host([data-sigen-fit]) main:has(>.overview-preview-toolbar){grid-template-rows:auto auto minmax(0,1fr)}
:host([data-sigen-fit]) .compact-overview.overview-aligned-controls{height:100%;min-height:0;grid-template-rows:minmax(min-content,1fr) 196px!important}
:host([data-sigen-fit]) .compact-overview .overview-summary-stack{min-height:min-content;grid-template-rows:auto minmax(min-content,1fr) auto}
.compact-overview .main-display-stage[data-display=photo]{container-type:size;display:grid;place-items:center}
.compact-overview .main-display-stage>.sigen-photo-scene{container-type:size;display:block;position:relative!important;inset:auto!important;width:min(100cqw,calc(100cqh * 1490 / 673))!important;height:min(100cqh,calc(100cqw * 673 / 1490))!important;background:transparent!important;place-self:center;isolation:isolate}
.compact-overview .main-display-stage .sigen-photo-frame{container-type:size;flex:none;width:100%;height:100%;aspect-ratio:1490/673}
.compact-overview .sigen-photo-lower{top:auto!important;bottom:3%}
.compact-overview .sigen-photo-plane>svg{overflow:hidden}
.compact-overview .sigen-photo-label-leaders{left:50%;top:50%;width:max(100cqw,calc(100cqh * 2.490342));height:auto;aspect-ratio:1676/673;transform:translate(-50%,-50%)}
.compact-overview .sigen-photo-chargers{position:absolute;inset:0;transform:none;display:block;max-width:none;min-height:0;pointer-events:none}
.compact-overview .sigen-photo-chargers .sigen-photo-node{position:absolute;left:14.916468%;max-width:22%;top:40%}
.compact-overview .sigen-photo-chargers .sigen-photo-node:has([data-detail=dc]){top:65%}
.compact-overview .sigen-photo-scene::before{content:none!important}
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
/* A landscape tablet has less height after its shell header and sidebar.
   Fit the complete overview using real touch-sized controls, not a tall
   desktop grid with its bottom hidden outside the tablet. */
:host([data-sigen-compact-fit]) ha-card>header{padding:8px 12px 4px!important}
:host([data-sigen-compact-fit]) ha-card>header h1{font-size:20px!important}
:host([data-sigen-compact-fit]) ha-card>main{padding:0 12px 6px!important}
:host([data-sigen-compact-fit]) .primary-navigation{display:flex!important;align-items:center;flex-wrap:wrap;gap:4px 8px;margin-bottom:4px;padding-bottom:4px}
:host([data-sigen-compact-fit]) .primary-navigation>nav{order:0;flex:1 1 auto;grid-column:auto;grid-row:auto}
:host([data-sigen-compact-fit]) .energy-tab-strip>button{min-height:40px!important;padding:6px 10px!important;font-size:13px!important}
:host([data-sigen-compact-fit]) .primary-navigation>.badges{order:1;grid-row:auto;gap:4px}
:host([data-sigen-compact-fit]) .primary-navigation>.connection-strip{order:2;margin-left:auto;grid-row:auto}
:host([data-sigen-compact-fit]) .badge,:host([data-sigen-compact-fit]) .connection-indicator{min-height:28px!important;padding:4px 7px!important;font-size:10px!important}
:host([data-sigen-compact-fit]) .compact-overview.overview-grid.overview-aligned-controls{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(280px,32%)!important;grid-template-rows:minmax(0,1fr) auto!important;gap:8px!important;height:100%!important;align-items:stretch}
:host([data-sigen-compact-fit]) .compact-overview>.hero,:host([data-sigen-compact-fit]) .compact-overview>.overview-sidebar{display:grid!important;grid-template-rows:subgrid!important;grid-row:1/span 2!important;gap:10px!important;min-height:0}
:host([data-sigen-compact-fit]) .compact-overview>.hero{grid-column:1!important}
:host([data-sigen-compact-fit]) .compact-overview>.overview-sidebar{grid-column:2!important}
:host([data-sigen-compact-fit]) .compact-overview .main-display-stage{width:100%!important;height:100%!important;max-height:none!important;aspect-ratio:auto!important;min-height:0}
:host([data-sigen-compact-fit]) .compact-overview .overview-summary-stack{display:grid!important;grid-template-columns:1fr!important;grid-template-rows:auto minmax(min-content,1fr) auto!important;gap:6px!important;height:100%!important;min-height:0}
:host([data-sigen-compact-fit]) .overview-side-module>.panel{padding:6px!important;min-height:0}
:host([data-sigen-compact-fit]) .overview-side-module h2{font-size:15px!important;margin:0 0 5px!important;line-height:20px}
:host([data-sigen-compact-fit]) .overview-side-module .section-title{margin-bottom:4px;gap:4px}
:host([data-sigen-compact-fit]) .overview-forecast-panel .tile{min-height:44px!important;padding:4px 6px!important;gap:9px!important}
:host([data-sigen-compact-fit]) .overview-forecast-panel .tile strong{font-size:18px!important;line-height:22px}
:host([data-sigen-compact-fit]) .overview-forecast-panel .tile small{font-size:11px!important;line-height:14px}
:host([data-sigen-compact-fit]) [data-display-module=forecast] .tile{min-height:44px!important;padding:4px 6px!important;gap:9px!important}
:host([data-sigen-compact-fit]) [data-display-module=forecast] .tile strong{font-size:18px!important;line-height:22px}
:host([data-sigen-compact-fit]) [data-display-module=forecast] .tile small{font-size:11px!important;line-height:14px}
:host([data-sigen-compact-fit]) .forecast-source-badges .badge{font-size:9px!important;min-height:20px!important;padding:2px 4px!important}
:host([data-sigen-compact-fit]) .overview-energy-metrics{gap:5px!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;grid-template-rows:repeat(2,minmax(44px,1fr))!important}
:host([data-sigen-compact-fit]) .overview-energy-metric{min-height:44px!important;padding:3px 6px!important}
:host([data-sigen-compact-fit]) .overview-energy-metric small{font-size:11px!important;line-height:12px;margin-bottom:1px!important}
:host([data-sigen-compact-fit]) .overview-energy-metric strong{font-size:17px!important;line-height:20px;white-space:nowrap}
:host([data-sigen-compact-fit]) .overview-summary-ring{max-width:52px!important;padding:4px!important}
:host([data-sigen-compact-fit]) .overview-side-module>.overview-circle-panel{padding:4px!important}
:host([data-sigen-compact-fit]) .overview-circle-label{font-size:10px!important;line-height:13px;min-height:14px!important}
:host([data-sigen-compact-fit]) .overview-circle-panel .overview-summary-ring strong{font-size:13px!important}
:host([data-sigen-compact-fit]) .overview-ring-centre small{font-size:8px!important;margin-top:2px}
:host([data-sigen-compact-fit]) .overview-circle-button{gap:4px!important}
:host([data-sigen-compact-fit]) .overview-circle-storage{font-size:10px!important;margin-top:4px!important;line-height:12px}
:host([data-sigen-compact-fit]) .overview-primary-controls>.panel{padding:6px!important}
:host([data-sigen-compact-fit]) .instant-manual-panel h2{font-size:15px;margin:0!important}
:host([data-sigen-compact-fit]) .instant-manual-panel>.section-title{margin-bottom:4px!important;line-height:20px}
:host([data-sigen-compact-fit]) .battery-control-buttons{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px}
:host([data-sigen-compact-fit]) .control-buttons button{min-height:44px!important;font-size:12px!important;line-height:15px;padding:5px!important}
:host([data-sigen-compact-fit]) .overview-charger-controls{grid-template-columns:repeat(2,minmax(0,1fr))!important;margin-top:6px!important;padding-top:5px!important;gap:8px}
:host([data-sigen-compact-fit]) .overview-charger-heading{font-size:12px!important;line-height:16px!important;padding:0 0 4px!important;min-height:24px}
:host([data-sigen-compact-fit]) .overview-device-links{display:grid!important;grid-template-columns:1fr!important;grid-template-rows:repeat(3,minmax(44px,1fr))!important;gap:5px!important;margin:0!important;min-height:0}
:host([data-sigen-compact-fit]) .overview-device-links>*{grid-column:1!important;min-height:44px!important;font-size:12px!important;padding:6px 8px!important}
:host([data-sigen-compact-fit]) .overview-mode-control select{min-height:24px!important;font-size:13px!important}
:host([data-sigen-compact-fit]) .mobile-power-grid{display:none!important}
:host([data-sigen-compact-fit]) .house-reading,:host([data-sigen-compact-fit]) .sigen-photo-node,:host([data-sigen-compact-fit]) .sigen-photo-leader{display:block!important}
`;
