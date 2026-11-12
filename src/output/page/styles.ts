/**
 * Page stylesheet from the Figma design "Imperdibles" (desktop 1280, mobile 375, day and night).
 * Plain string: Worker-safe. Colors are CSS variables so `prefers-color-scheme` swaps the whole palette.
 */
export const PAGE_FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@700;900&family=Space+Grotesk:wght@700&family=DM+Sans:wght@400;700&family=IBM+Plex+Mono:wght@500&display=swap";

export const PAGE_CSS = `
:root{--ink:#171717;--muted:#60605B;--media:#F0F0EA;--accent:#FF633D;--brand:#C2410C;--on-accent:#171717;--border:#D2D2CA;--card:#FFFFFF;--button:#171717;--on-button:#FFFFFF;--bg:#F5F5F2;--band:#EAEAE3;--chip:#E9E9E2;--tile:#F0F0EA;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--brand:#FF633D;--ink:#F5F5F2;--muted:#B8B8B2;--media:#33332E;--border:#41413C;--card:#242421;--button:#F5F5F2;--on-button:#171717;--bg:#141414;--band:#20201D;--chip:#2A2A27}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'DM Sans',system-ui,sans-serif;font-size:16px;line-height:1.45}
a{color:inherit;transition:color .12s,background-color .12s}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.on-accent :focus-visible{outline-color:#171717}
h1,h2,h3,p,ol{margin:0}
ol{padding:0;list-style:none}
.wrap{max-width:1280px;margin:0 auto;padding-left:64px;padding-right:64px}
.display{font-family:Inter,system-ui,sans-serif;font-weight:900;letter-spacing:-.05em}
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-weight:500}

.hd{padding-top:16px}
.hd-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand-row{display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:baseline;gap:0;text-decoration:none;white-space:nowrap}
.brand b,.sign b{font-family:'Space Grotesk',Inter,system-ui,sans-serif;font-weight:700;letter-spacing:-.02em;line-height:1.1}
.brand i,.sign i{font-family:'Space Grotesk',Inter,system-ui,sans-serif;font-style:normal;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:var(--brand)}
.brand b,.brand i{font-size:28px}
.monogram{display:none;width:32px;height:32px;align-items:center;justify-content:center;background:var(--accent);color:var(--on-accent);font-family:Inter,system-ui,sans-serif;font-weight:900;font-size:24px;line-height:1}
.nav{display:flex;gap:28px}
.nav a{display:flex;align-items:center;min-height:44px;font-weight:700;font-size:14px;text-decoration:none}
.nav a:hover{color:var(--muted)}

.today{padding-top:20px;padding-bottom:36px;display:flex;flex-direction:column;gap:20px}
.sel{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 24px}
.sel h1{font-family:Inter,system-ui,sans-serif;font-weight:900;font-size:44px;line-height:1.13;letter-spacing:-.04em}
.meta{font-size:11px;line-height:1.45;color:var(--muted);text-transform:uppercase}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:var(--chip);border-radius:100px;padding:10px;font-weight:700;font-size:11px}
.list{display:flex;flex-direction:column;gap:16px}

.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;display:grid;grid-template-columns:652fr 426fr;gap:24px;align-items:start}
.top{display:grid;grid-template-columns:264px minmax(0,1fr);gap:24px;align-items:start}
.photo{width:264px;height:240px;border-radius:6px;background:var(--tile);display:flex;align-items:center;justify-content:center;overflow:hidden}
.photo img{width:100%;height:100%;object-fit:contain;background:#FFFFFF;display:block}
.photo .art{width:70%;height:70%;display:flex}
.photo .art svg{width:100%;height:100%}
.info{display:flex;flex-direction:column;align-items:flex-start;gap:16px;min-width:0}
.title{font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:30px;line-height:1.16;letter-spacing:-.03em;overflow-wrap:anywhere}
.badge{background:var(--accent);color:var(--on-accent);border-radius:3px;padding:5px 7px;font-weight:700;font-size:15px;line-height:1.4;white-space:nowrap}
.diff{font-weight:700;font-size:16px}
.prices{display:flex;flex-direction:column;gap:12px;min-width:0}
.price-row{display:flex;flex-direction:column;gap:5px}
.price-line{display:flex;align-items:center;justify-content:space-between;gap:12px}
.store{font-size:14px}
.store-ml{font-weight:700}
.p-ml{font-family:Inter,system-ui,sans-serif;font-weight:900;font-size:40px;line-height:1.13;letter-spacing:-.03em}
.p-rival{font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:18px;line-height:1.13;letter-spacing:-.04em}
.scale{background:var(--media);height:3px;display:flex}
.scale i{display:block;height:100%;background:var(--border)}
.scale-ml{height:5px}
.scale-ml i{background:var(--accent)}
.cta{display:flex;align-items:center;justify-content:center;min-height:48px;padding:14px;background:var(--button);color:var(--on-button);border-radius:6px;font-weight:700;font-size:15px;text-decoration:none}
.cta:hover{opacity:.86}
.note{font-size:12px;color:var(--muted)}

.empty{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:33px;display:flex;flex-direction:column;gap:20px}
.empty .zero{font-size:96px;line-height:1.05}
.empty h2{font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:28px;line-height:1.25;letter-spacing:-.03em}
.empty p{color:var(--muted)}

.why{background:var(--band);padding-top:28px;padding-bottom:36px}
.why .wrap{display:flex;flex-direction:column;gap:12px}
.why-lead{font-weight:700;font-size:22px;line-height:1.4}
.why-sub{color:var(--muted)}
.method{background:var(--band);padding-top:56px;padding-bottom:56px}
.method .wrap{display:grid;grid-template-columns:360px minmax(0,1fr);gap:64px;align-items:start}
.method-head{display:flex;flex-direction:column;gap:16px}
.method-head h2{font-size:64px;line-height:1.1}
.method-head p{font-size:18px;line-height:1.5;color:var(--muted)}
.steps{display:flex;flex-direction:column;gap:28px}
.step{border-top:1px solid var(--border);padding-top:12px;display:flex;gap:24px;align-items:flex-start}
.step-n{flex:none;width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:var(--accent);color:var(--on-accent);font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:16px;letter-spacing:-.05em}
.step h3{font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:24px;line-height:1.1;letter-spacing:-.05em}
.step p{font-size:16px;line-height:1.5;color:var(--muted);margin-top:8px}

.channel{background:var(--accent);color:#171717;padding-top:56px;padding-bottom:56px}
.channel .wrap{display:flex;flex-direction:column;gap:24px}
.channel .mono{font-size:11px;line-height:1.5}
.channel-row{display:flex;align-items:flex-end;gap:64px}
.channel-copy{flex:1 1 0;min-width:0;max-width:768px;display:flex;flex-direction:column;gap:20px}
.channel-copy h2{font-size:64px;line-height:1.1}
.channel-copy p{font-size:19px;line-height:1.5}
.channel-btn{flex:none;width:320px;display:flex;flex-direction:row-reverse;align-items:center;justify-content:space-between;padding:18px;background:#171717;color:#FFFFFF;border-radius:6px;font-weight:700;font-size:17px;line-height:1.5;text-decoration:none}
.channel-btn:hover{background:#2E2E2B}
.channel-btn span{font-size:24px}

.legal{padding-top:48px;padding-bottom:48px;display:flex;flex-direction:column;gap:28px}
.sign{display:flex;align-items:baseline;gap:0;white-space:nowrap}
.sign b{font-size:clamp(36px,9.2vw,118px)}
.sign i{font-size:clamp(36px,9.2vw,118px);line-height:1.1}
.rule{height:1px;background:var(--border)}
.notes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:48px}
.notes p{font-size:14px;line-height:1.5;color:var(--muted)}

@media (max-width:899px){
.wrap{padding-left:20px;padding-right:20px}
.hd{padding-top:12px}
.hd-row{flex-direction:column;align-items:stretch;gap:4px}
.monogram{display:flex}
.nav{justify-content:space-between;gap:12px}
.nav a{font-size:13px}
.sel h1{font-size:30px}
.card{grid-template-columns:minmax(0,1fr);gap:16px;padding:20px}
.top{grid-template-columns:96px minmax(0,1fr);gap:16px}
.photo{width:96px;height:128px;padding:8px}
.info{gap:8px}
.title{font-size:21px}
.diff{font-size:14px}
.store{font-size:13px}
.p-ml{font-size:32px;letter-spacing:-.03em}
.method .wrap{grid-template-columns:minmax(0,1fr);gap:28px}
.method-head h2{font-size:40px}
.method-head p{font-size:16px}
.method{padding-top:36px;padding-bottom:36px}
.step{gap:16px}
.step h3{font-size:20px}
.channel{padding-top:36px;padding-bottom:36px}
.channel-row{flex-direction:column;align-items:stretch;gap:24px}
.channel-copy h2{font-size:38px}
.channel-btn{width:100%}
.legal{padding-top:32px;padding-bottom:32px;gap:28px}
.notes{grid-template-columns:minmax(0,1fr);gap:16px}
.empty{padding:24px}
}
@media (prefers-reduced-motion:reduce){a{transition:none}}
`;
