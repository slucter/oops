"""Uji lock pemetaan/optimasi tidak tersangkut selamanya."""
import importlib.util, os, sys, time, threading
os.environ['OOPS_SERVER_URL']='http://x'; os.environ['OOPS_TOKEN']='x'
spec=importlib.util.spec_from_file_location('a', sys.argv[1])
A=importlib.util.module_from_spec(spec); spec.loader.exec_module(A)

gagal=0
def cek(l,c):
    global gagal
    if c: print('  OK  '+l)
    else:
        gagal+=1; print('GAGAL  '+l)

class WsPalsu:
    def __init__(self): self.pesan=[]
    def send_text(self,t):
        import json; self.pesan.append(json.loads(t))

print('=== lock pemetaan yang tersangkut harus bisa direbut ===')
# Tiru pemegang lock yang mati tanpa release.
A._peta_berjalan.acquire()
A._peta_mulai_pada[0] = time.time() - (A.PETA_LOCK_MAKS_DETIK + 60)

ws=WsPalsu()
A.handle_peta(ws,'uji-1')
time.sleep(3)
hasil=[p for p in ws.pesan if p.get('type')=='peta_result']
ditolak=[h for h in hasil if not h.get('ok') and 'masih berjalan' in (h.get('pesan') or '')]
cek('TIDAK ditolak dengan "masih berjalan"', len(ditolak)==0)
cek('pemetaan benar-benar dijalankan', len([p for p in ws.pesan if p.get('type')=='peta_progress'])>0)

print()
print('=== lock yang MASIH baru harus tetap menolak ===')
try: A._peta_berjalan.release()
except RuntimeError: pass
A._peta_berjalan.acquire()
A._peta_mulai_pada[0] = time.time()  # baru saja mulai
ws2=WsPalsu()
A.handle_peta(ws2,'uji-2')
time.sleep(1)
tolak=[p for p in ws2.pesan if p.get('type')=='peta_result' and not p.get('ok')]
cek('ditolak dengan pesan jelas', len(tolak)==1 and 'masih berjalan' in tolak[0]['pesan'])
cek('pesannya menyebut sudah berapa detik', 'detik' in (tolak[0]['pesan'] or ''))
try: A._peta_berjalan.release()
except RuntimeError: pass

print()
print('=== hal sama untuk lock optimasi ===')
A._optimasi_berjalan.acquire()
A._optimasi_mulai_pada[0] = time.time() - (A.OPT_LOCK_MAKS_DETIK + 60)
ws3=WsPalsu()
A.handle_optimize(ws3,'uji-3',False)
time.sleep(3)
h3=[p for p in ws3.pesan if p.get('type')=='optimize_result']
tolak3=[h for h in h3 if not h.get('ok') and 'masih berjalan' in (h.get('pesan') or '')]
cek('lock optimasi tersangkut bisa direbut', len(tolak3)==0)

sys.exit(1 if gagal else 0)

