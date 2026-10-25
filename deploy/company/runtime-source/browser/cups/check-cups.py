"""Valid IPP loopback fixture; no printer daemon, hardware or external credentials."""
import argparse,ctypes,hashlib,http.server,json,os,struct,subprocess,sys,sysconfig,threading
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument("client");parser.add_argument("--library",type=Path);args=parser.parse_args()

def attr(tag,name,value):
 name=name.encode();value=value.encode();return bytes([tag])+struct.pack('!H',len(name))+name+struct.pack('!H',len(value))+value
class Fixture(http.server.BaseHTTPRequestHandler):
 def do_POST(self):
  assert self.path=='/printers/fixture'
  assert self.headers['Content-Type']=='application/ipp'
  payload=self.rfile.read(int(self.headers['Content-Length']));assert payload[:2] in [b'\x01\x01',b'\x02\x00']
  assert payload[2:4]==b'\x00\x0b' # ordinary Get-Printer-Attributes
  response=payload[:2]+b'\x00\x00'+payload[4:8]+b'\x01'+attr(0x47,'attributes-charset','utf-8')+attr(0x48,'attributes-natural-language','en')+b'\x04'+attr(0x42,'printer-name','fixture')+b'\x03'
  self.send_response(200);self.send_header('Content-Type','application/ipp');self.send_header('Content-Length',str(len(response)));self.end_headers();self.wfile.write(response)
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Fixture);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
 subprocess.run([args.client,str(server.server_port)],check=True,timeout=15)
 library=args.library or Path('/usr/lib')/sysconfig.get_config_var('MULTIARCH')/'libcups.so.2'
 lib=ctypes.CDLL(str(library));lib.cupsUserAgent.restype=ctypes.c_char_p
 assert b'CUPS/2' in lib.cupsUserAgent()
 if not args.library:
  provenance=json.loads(Path('/usr/share/doc/libcups2t64/runtime-source.json').read_text())
  assert provenance['version']=='2.4.20-1+runtime1'
  assert hashlib.sha256(library.read_bytes()).hexdigest()==provenance['library_sha256']
 print('PASS real loaded libcups ABI and normal client user-agent')
finally:server.shutdown();server.server_close()
