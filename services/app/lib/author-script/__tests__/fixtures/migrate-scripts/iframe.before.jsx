<Helmet>
  <title>Canvas counter</title>
  <Value name="count" type="number" default={0} />
  <style>{`.lede { font-weight: 600; }`}</style>
</Helmet>
<p className="lede">The canvas below reads the shared count.</p>
<Iframe id="Ab3d" title="Counter canvas" height={220}>
  <style>{`body {margin:16px;font:16px system-ui} canvas, button {display:block;margin-top:12px} @media (max-width: 600px) { body { margin: 4px } }`}</style>
  <button id="increment" aria-label="Increment count">Add one</button>
  <canvas id="counter" width={280} height={100} />
  <script>{`
    const canvas = document.getElementById('counter');
    const ctx = canvas.getContext('2d');
    function draw(snapshot) {
      const count = snapshot.signals.count.value;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText('Count: ' + (count ?? 0), 12, 55);
    }
    const stop = mx.subscribe(['count'], draw);
    document.getElementById('increment').addEventListener('click', async () => {
      const snapshot = await mx.read(['count']);
      await mx.set({count: Number(snapshot.signals.count.value ?? 0) + 1});
    });
    addEventListener('pagehide', stop);
  `}</script>
</Iframe>
