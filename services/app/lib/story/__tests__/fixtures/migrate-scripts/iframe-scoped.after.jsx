<Helmet>
  <title>Two clips</title>
  <script>{`

    /* migrated from Iframe "Clip A" (#clip-a) */
    {
      const video = document.getElementById('clip-a').querySelector('video');
      video.addEventListener('canplay', () => {
        document.getElementById('clip-a').classList.add('ready');
        for (const el of document.getElementById('clip-a').querySelectorAll('.state')) el.textContent = 'ready';
      });
    }

    /* migrated from Iframe "Clip B" (#migrated-frame-1) */
    {
      const video = document.getElementById('migrated-frame-1').querySelector('video');
      video.addEventListener('canplay', () => document.getElementById('migrated-frame-1').classList.add('ready'));
    }
`}</script>
  <style>{`
/* migrated from Iframe "Clip A" */
#clip-a.ready video { outline: 2px solid green; } #clip-a.wide { max-width: none; } #clip-a .state { color: gray; }
#clip-a { min-height: 240px; }
/* migrated from Iframe "Clip B" */
#migrated-frame-1.ready video { outline: 2px solid blue; }
`}</style>
</Helmet>
{/* migrated from Iframe */}
<div id="clip-a" role="group" aria-label="Clip A">
  <video src="/a.mp4" muted />
  <p className="state">loading</p>
</div>
{/* migrated from Iframe */}
<div id="migrated-frame-1" role="group" aria-label="Clip B">
  <video src="/b.mp4" muted />
</div>
