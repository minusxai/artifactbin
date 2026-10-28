import {it,expect} from 'vitest';
import {artifactFilePayload} from '../../services/cli/scripts/artifact-file-payload.mjs';
it('reads the actual script JSON instead of the instructional comment naming that script',()=>{
 const html='<!-- Edit <script id="afbin-file"> JSON below. Leave code unchanged. -->\n<script type="application/json" id="afbin-file">{"source":"<p>Saved</p>"}</script>';
 expect(artifactFilePayload(html)).toEqual({source:'<p>Saved</p>'});
});
it('refuses absent, duplicate and executable carriers',()=>{
 for(const html of ['<!-- <script id="afbin-file">fake</script> -->','<script id="afbin-file">{}</script>','<script id="afbin-file" type="application/json">{}</script><script id="afbin-file" type="application/json">{}</script>'])expect(()=>artifactFilePayload(html)).toThrow();
});
