// One-line embed:
// <script src="https://YOUR-HOST/button.js" data-label="Ebook" data-amount="0.0005"></script>
(function () {
  const me = document.currentScript;
  const host = new URL(me.src).origin;
  const label = me.dataset.label || 'Payment';
  const amount = me.dataset.amount;
  const text = me.dataset.text || `Pay ${amount} ZEC privately`;

  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = 'background:#f4b728;color:#3a2a00;border:0;border-radius:10px;padding:12px 18px;font:600 15px system-ui,sans-serif;cursor:pointer';
  me.after(btn);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const res = await fetch(`${host}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, amount, source: 'embed' }),
    });
    const order = await res.json();
    btn.disabled = false;
    if (!res.ok) return alert(order.error);

    const shade = document.createElement('div');
    shade.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:2147483647;padding:16px';
    const frame = document.createElement('iframe');
    frame.src = `${host}/pay/${order.id}?embed=1`;
    frame.style.cssText = 'width:min(480px,100%);height:min(760px,92vh);border:0;border-radius:16px;background:#fff';
    shade.appendChild(frame);
    shade.addEventListener('click', (e) => e.target === shade && shade.remove());
    document.body.appendChild(shade);

    window.addEventListener('message', function onMsg(e) {
      if (e.origin !== host || e.data?.type !== 'zec-paid' || e.data.order !== order.id) return;
      window.removeEventListener('message', onMsg);
      me.dispatchEvent(new CustomEvent('zec-paid', { detail: order, bubbles: true }));
    });
  });
})();
