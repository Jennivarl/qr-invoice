const BRAND = 'QR Invoice';

(function header() {
  const el = document.getElementById('top');
  if (!el) return;
  const here = location.pathname;
  const links = [['/dashboard', 'Invoices'], ['/embed', 'Embed'], ['/how', 'How it works']];
  el.className = 'top wrap';
  el.innerHTML = `
    <a class="brand" href="/"><span class="mark">▦</span>${BRAND}</a>
    <nav>${links.map(([h, t]) => `<a href="${h}" class="${here.startsWith(h) ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
  document.title = document.title ? `${document.title} · ${BRAND}` : BRAND;
})();

const api = async (url, body) => {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (s, n = 10) => (s && s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s || '');
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};
