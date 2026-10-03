<Helmet>
  <title>Two clips</title>
</Helmet>
<Iframe id="clip-a" title="Clip A" height={240}>
  <style>{`body.ready video { outline: 2px solid green; } html.wide body { max-width: none; } body .state { color: gray; }`}</style>
  <video src="/a.mp4" muted />
  <p className="state">loading</p>
  <script>{`
    const video = document.querySelector('video');
    video.addEventListener('canplay', () => {
      document.body.classList.add('ready');
      for (const el of document.querySelectorAll('.state')) el.textContent = 'ready';
    });
  `}</script>
</Iframe>
<Iframe title="Clip B">
  <style>{`body.ready video { outline: 2px solid blue; }`}</style>
  <video src="/b.mp4" muted />
  <script>{`
    const video = document.querySelector('video');
    video.addEventListener('canplay', () => document.body.classList.add('ready'));
  `}</script>
</Iframe>
