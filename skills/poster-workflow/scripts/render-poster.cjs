#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

function argumentsOf(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--brief', '--out', '--browser'].includes(key) || !argv[i + 1]) {
      throw new Error('Usage: node render-poster.cjs --brief brief.json --out output-directory [--browser browser.exe]');
    }
    result[key.slice(2)] = argv[i + 1];
  }
  if (!result.brief || !result.out) throw new Error('--brief and --out are required.');
  return result;
}

function text(value, name, max, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} is required.`);
    return '';
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${name} must be text with at most ${max} characters.`);
  }
  return value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function color(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Theme colors must use #RRGGBB.');
  return value;
}

function validate(input) {
  const size = input.size || { width: 1080, height: 1440 };
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(size[key]) || size[key] < 512 || size[key] > 4096) throw new Error(`Invalid ${key}: use an integer between 512 and 4096.`);
  }
  const id = text(input.id || 'poster', 'id', 80, true);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error('id may contain only letters, numbers, hyphens and underscores.');
  const layout = input.layout || 'hero';
  if (!['hero', 'editorial', 'minimal'].includes(layout)) throw new Error('layout must be hero, editorial or minimal.');
  const bullets = input.bullets || [];
  const details = input.details || [];
  if (!Array.isArray(bullets) || bullets.length > 4) throw new Error('Use at most 4 bullets.');
  if (!Array.isArray(details) || details.length > 6) throw new Error('Use at most 6 detail rows.');
  return {
    id, size, layout,
    badge: text(input.badge, 'badge', 40),
    title: text(input.title, 'title', 80, true),
    subtitle: text(input.subtitle, 'subtitle', 150),
    cta: text(input.cta, 'cta', 60),
    footer: text(input.footer, 'footer', 100),
    bullets: bullets.map((item, i) => text(item, `bullet ${i + 1}`, 80, true)),
    details: details.map((item, i) => ({ label: text(item.label, `detail ${i + 1} label`, 30, true), value: text(item.value, `detail ${i + 1} value`, 100, true) })),
    theme: {
      background: color(input.theme?.background, '#f4f0e8'),
      ink: color(input.theme?.ink, '#18353b'),
      accent: color(input.theme?.accent, '#e56340'),
      muted: color(input.theme?.muted, '#597075')
    },
    assets: input.assets || {}
  };
}

async function asset(file, root, role) {
  if (!file) return null;
  if (typeof file !== 'string' || /^\w+:\/\//.test(file)) throw new Error(`${role} must be a local image path.`);
  const absolute = path.resolve(root, file);
  const extension = path.extname(absolute).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[extension];
  if (!mime) throw new Error(`Unsupported ${role} image format.`);
  const bytes = await fs.readFile(absolute);
  if (bytes.length > 30 * 1024 * 1024) throw new Error(`${role} is larger than 30 MB.`);
  return { data: `data:${mime};base64,${bytes.toString('base64')}`, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), role };
}

function htmlOf(b, images) {
  const e = escapeHtml;
  const title = e(b.title).replace(/\n/g, '<br>');
  const [w, h] = [b.size.width, b.size.height];
  const wide = w / h > 1.2;
  const scale = Math.min(w, h);
  const font = wide ? scale * 0.108 : scale * 0.102;
  const art = images.hero
    ? `<img class="hero-image" alt="主视觉" src="${images.hero.data}">`
    : '<div class="orb orb-one"></div><div class="orb orb-two"></div><div class="orbit"></div><span class="star">✦</span><span class="art-label">IDEA / DESIGN / POSTER</span>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">
<title>${e(b.id)}</title><style>
* { box-sizing: border-box; } html,body { margin: 0; width:${w}px; height:${h}px; }
body { font-family: 'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif; color:${b.theme.ink}; }
.poster { width:${w}px; height:${h}px; padding:${scale * 0.064}px; background:${b.theme.background}; display:grid; grid-template-rows:auto minmax(0,1fr) auto; gap:${scale * 0.026}px; overflow:hidden; position:relative; }
.top { display:flex; align-items:center; justify-content:space-between; gap:24px; min-height:${scale * 0.04}px; }
.brand { display:flex; align-items:center; gap:${scale * 0.022}px; }
.badge { font-size:${scale * 0.023}px; font-weight:700; letter-spacing:.1em; }
.logo { width:${scale * 0.15}px; max-height:${scale * 0.07}px; object-fit:contain; }
.edition { font-size:${scale * 0.02}px; color:${b.theme.muted}; border:1px solid ${b.theme.muted}; border-radius:50px; padding:.3em .9em; }
.main { min-height:0; display:grid; grid-template-rows:auto minmax(0,1fr) auto; gap:${scale * 0.021}px; }
.head { position:relative; z-index:1; }
h1 { font-size:${font}px; font-weight:900; line-height:1.24; letter-spacing:-.025em; margin:0; padding-bottom:.18em; overflow-wrap:anywhere; }
.subtitle { font-size:${scale * 0.027}px; color:${b.theme.muted}; line-height:1.65; margin:${scale * 0.018}px 0 0; max-width:93%; white-space:pre-wrap; }
.art { position:relative; min-height:0; overflow:hidden; border-radius:${scale * 0.032}px; background:linear-gradient(135deg,${b.theme.ink} 0%,${b.theme.muted} 100%); }
.hero-image { width:100%;height:100%;object-fit:contain;display:block; }
.orb { position:absolute; border-radius:50%; }
.orb-one { width:55%;aspect-ratio:1;left:8%;top:12%;background:linear-gradient(135deg,${b.theme.accent},#f5d2a9);box-shadow:24px 32px 50px #0003; }
.orb-two { width:38%;aspect-ratio:1;right:8%;bottom:7%;background:linear-gradient(135deg,#f4f0e8,#a3cac5);box-shadow:16px 24px 40px #0003; }
.orbit {position:absolute; width:72%;height:65%;left:14%;top:18%;border:${scale * 0.008}px solid #ffffffb0;border-radius:50%;transform:rotate(-24deg);}
.star {position:absolute;right:10%;top:5%;font-size:${scale * 0.1}px;color:#f6edda;}
.art-label {position:absolute;bottom:7%;left:6%;font-size:${scale * 0.016}px;letter-spacing:.14em;color:#fff;}
.info { display:grid; gap:${scale * 0.018}px; }
.bullets { display:flex; flex-wrap:wrap; gap:${scale * 0.009}px; }
.bullet { font-size:${scale * 0.022}px; border:1px solid ${b.theme.muted}70; border-radius:40px; padding:.4em .8em; }
.details { display:grid; grid-template-columns:repeat(${wide ? '2' : b.details.length > 3 ? '2' : '1'},minmax(0,1fr)); gap:${scale * 0.009}px ${scale * 0.022}px; }
.detail {font-size:${scale * 0.022}px;line-height:1.55;display:flex;gap:1em;align-items:flex-start;}
.detail-label { color:${b.theme.muted};flex-shrink:0; } .detail-value {overflow-wrap:anywhere;}
.bottom { display:flex; align-items:flex-end; justify-content:space-between; gap:${scale * 0.025}px; border-top:1px solid ${b.theme.muted}50; padding-top:${scale * 0.022}px; }
.cta { font-size:${scale * 0.029}px; font-weight:800; line-height:1.5; margin:0; color:${b.theme.accent}; }
.footer { font-size:${scale * 0.016}px; color:${b.theme.muted}; margin:.6em 0 0; }
.qr { width:${scale * 0.15}px; height:${scale * 0.15}px; padding:${scale * 0.012}px; background:white; object-fit:contain;flex-shrink:0; }
.minimal .art { background:transparent; } .minimal .art-label { color:${b.theme.muted}; }
.editorial .head { border-left:${scale * 0.008}px solid ${b.theme.accent};padding-left:${scale * 0.025}px; }
${wide ? `.main { grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); grid-template-rows:auto 1fr;gap:${scale * 0.035}px; } .art {grid-column:2;grid-row:1 / 3;} .info {align-self:end;} .subtitle{max-width:100%;} h1{font-size:${font}px;}` : ''}
</style></head><body><article class="poster ${e(b.layout)}" id="poster">
<header class="top" data-block="header"><div class="brand">${images.logo ? `<img class="logo" src="${images.logo.data}" alt="Logo">` : ''}${b.badge ? `<span class="badge" data-check>${e(b.badge)}</span>` : ''}</div><span class="edition" aria-hidden="true">✦</span></header>
<main class="main"><section class="head" data-block="headline"><h1 data-check>${title}</h1>${b.subtitle ? `<p class="subtitle" data-check>${e(b.subtitle)}</p>` : ''}</section>
<div class="art" data-block="art">${art}</div>
<section class="info" data-block="information">${b.bullets.length ? `<div class="bullets">${b.bullets.map(v => `<span class="bullet" data-check>${e(v)}</span>`).join('')}</div>` : ''}
${b.details.length ? `<div class="details">${b.details.map(v => `<div class="detail"><span class="detail-label" data-check>${e(v.label)}</span><span class="detail-value" data-check>${e(v.value)}</span></div>`).join('')}</div>` : ''}</section></main>
<footer class="bottom" data-block="footer"><div>${b.cta ? `<p class="cta" data-check>${e(b.cta)}</p>` : ''}${b.footer ? `<p class="footer" data-check>${e(b.footer)}</p>` : ''}</div>${images.qr ? `<img class="qr" src="${images.qr.data}" alt="二维码原图">` : ''}</footer>
</article></body></html>`;
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const briefPath = path.resolve(args.brief);
  const raw = await fs.readFile(briefPath, 'utf8');
  const b = validate(JSON.parse(raw.replace(/^\uFEFF/, '')));
  const output = path.resolve(args.out);
  await fs.mkdir(output, { recursive: true });
  const images = {};
  for (const key of ['hero', 'logo', 'qr']) images[key] = await asset(b.assets[key], path.dirname(briefPath), key);
  const htmlPath = path.join(output, `${b.id}.html`);
  const imagePath = path.join(output, `${b.id}.png`);
  const qaPath = path.join(output, `${b.id}.qa.json`);
  for (const target of [htmlPath, imagePath, qaPath]) {
    try { await fs.access(target); throw new Error(`Output already exists; use a new id or directory: ${path.basename(target)}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await fs.writeFile(htmlPath, htmlOf(b, images), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, ...(args.browser ? { executablePath: args.browser } : {}), args: ['--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: b.size, deviceScaleFactor: 1 });
    await page.route('**/*', route => /^https?:/.test(route.request().url()) ? route.abort() : route.continue());
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(img => img.decode())); });
    const check = await page.evaluate(() => {
      const canvas = document.querySelector('#poster').getBoundingClientRect();
      const issues = [];
      for (const node of document.querySelectorAll('[data-check], [data-block]')) {
        const rect = node.getBoundingClientRect();
        if (rect.left < canvas.left - 1 || rect.top < canvas.top - 1 || rect.right > canvas.right + 1 || rect.bottom > canvas.bottom + 1) issues.push({ kind: 'outside_canvas', text: node.textContent.slice(0, 80) });
        if (node.hasAttribute('data-check') && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2)) issues.push({ kind: 'overflow', text: node.textContent.slice(0, 80) });
      }
      const blocks = Array.from(document.querySelectorAll('[data-block]')).map(n => ({ name:n.dataset.block, rect:n.getBoundingClientRect() }));
      for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
        const [a, z] = [blocks[i], blocks[j]];
        const dx = Math.min(a.rect.right,z.rect.right) - Math.max(a.rect.left,z.rect.left);
        const dy = Math.min(a.rect.bottom,z.rect.bottom) - Math.max(a.rect.top,z.rect.top);
        if (dx > 2 && dy > 2) issues.push({ kind: 'block_overlap', blocks:[a.name,z.name] });
      }
      return { issues, rendered_text:Array.from(document.querySelectorAll('[data-check]')).map(n => n.textContent) };
    });
    await page.screenshot({ path: imagePath, animations: 'disabled' });
    const png = await fs.readFile(imagePath);
    const actualSize = { width:png.readUInt32BE(16), height:png.readUInt32BE(20) };
    const qa = {
      schema_version:1, status:check.issues.length ? 'needs_revision' : 'structural_checks_passed',
      expected_size:b.size, actual_size:actualSize, issues:check.issues, rendered_text:check.rendered_text,
      assets:Object.values(images).filter(Boolean).map(i => ({role:i.role, sha256:i.sha256})),
      qr_decode_verified:images.qr ? false : null, visual_review:'pending', print_validation:'not_requested',
      files:{poster:path.basename(imagePath), source:path.basename(htmlPath)}, created_at:new Date().toISOString()
    };
    if (actualSize.width !== b.size.width || actualSize.height !== b.size.height) { qa.issues.push({kind:'incorrect_size'}); qa.status='needs_revision'; }
    await fs.writeFile(qaPath, JSON.stringify(qa,null,2)+'\n', 'utf8');
    console.log(JSON.stringify({ image:imagePath, source:htmlPath, qa:qaPath, status:qa.status, issues:qa.issues.length }));
    if (qa.issues.length) process.exitCode = 2;
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
