"""Local TLS release fixture for real-binary evals. No production release is published."""
import http.server, ssl, pathlib, subprocess, threading, json
class ReleaseFixture:
 def __init__(self,directory,dist):
  self.root=pathlib.Path(directory);self.calls=[]
  self.files={name:(pathlib.Path(dist)/name).read_bytes() for name in ['afbin-darwin-arm64','afbin-darwin-arm64.manifest.json','afbin-skills.json']}
  self.version=json.loads(self.files['afbin-darwin-arm64.manifest.json'])['version']
  self.cert=self.root/'release-ca.pem';key=self.root/'release-key.pem'
  subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',str(key),'-out',str(self.cert),'-subj','/CN=api.github.com','-addext','subjectAltName=DNS:api.github.com,DNS:github.com'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
  context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(self.cert,key)
  fixture=self
  class Origin(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_GET(self):
    host=self.headers.get('Host','').split(':')[0];fixture.calls.append({'host':host,'path':self.path})
    if self.headers.get('Authorization'):self.send_error(400,'Release requests must not contain credentials');return
    if host=='api.github.com' and self.path=='/repos/minusxai/artifactbin/releases?per_page=100':data=json.dumps([{'tag_name':'afbin-v'+fixture.version,'draft':False,'prerelease':False}]).encode()
    elif host=='github.com' and self.path.startswith('/minusxai/artifactbin/releases/download/afbin-v'+fixture.version+'/'):
     name=self.path.rsplit('/',1)[-1];data=fixture.files.get(name)
     if data is None:self.send_error(404);return
    else:self.send_error(404);return
    self.send_response(200);self.send_header('Content-Type','application/json' if self.path.endswith('.json') or host=='api.github.com' else 'application/octet-stream');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  class Proxy(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_CONNECT(self):
    if self.path not in ['api.github.com:443','github.com:443']:self.send_error(403);return
    self.send_response(200,'Connection established');self.end_headers()
    connection=context.wrap_socket(self.connection,server_side=True)
    try:Origin(connection,self.client_address,self.server)
    finally:connection.close();self.close_connection=True
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Proxy);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.url='http://127.0.0.1:'+str(self.server.server_address[1])
 def close(self):self.server.shutdown();self.server.server_close()
