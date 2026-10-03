<Helmet>
  <title>Globe</title>
</Helmet>
<h1>A globe</h1>
{/* MIGRATE: <Iframe title="Globe"> was not inlined: it loads a classic library by <script src>; import it as a module (`import … from 'name'`) and inline the frame by hand */}
<Iframe title="Globe" height={400}>
  <canvas id="globe" />
  <script src="https://cdn.example.com/globe.bundle.js" />
  <script>{`
    window.Globe.draw(document.getElementById('globe'));
  `}</script>
</Iframe>
