<Helmet>
  <title>Globe</title>
</Helmet>
<h1>A globe</h1>
<Iframe title="Globe" height={400}>
  <canvas id="globe" />
  <script src="https://cdn.example.com/globe.bundle.js" />
  <script>{`
    window.Globe.draw(document.getElementById('globe'));
  `}</script>
</Iframe>
