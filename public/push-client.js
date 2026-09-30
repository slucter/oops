/* Pengelola Web Push di sisi browser: daftar service worker, minta izin,
   dan sinkronkan status langganan dengan server. */
(function () {
  var statusEl = null;
  var buttonEl = null;

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'push-status' + (tone ? ' push-' + tone : '');
  }

  function setButton(label, disabled) {
    if (!buttonEl) return;
    buttonEl.textContent = label;
    buttonEl.disabled = !!disabled;
  }

  async function getRegistration() {
    return navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }

  async function currentSubscription() {
    var reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  }

  async function refreshUi() {
    if (!supported()) {
      setStatus('Browser ini tidak mendukung Web Push.', 'bad');
      setButton('Tidak tersedia', true);
      return;
    }

    if (Notification.permission === 'denied') {
      setStatus('Izin notifikasi diblokir di browser ini. Aktifkan lewat pengaturan situs, lalu muat ulang halaman.', 'bad');
      setButton('Diblokir browser', true);
      return;
    }

    var sub = await currentSubscription();
    if (!sub) {
      setStatus('Belum aktif di browser ini.', 'dim');
      setButton('Aktifkan notifikasi', false);
      return;
    }

    // Browser punya langganan, tapi server bisa saja sudah menghapusnya
    // (mis. database di-reset) — sinkronkan supaya tidak menyesatkan.
    try {
      var res = await fetch('/push/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      var data = await res.json();
      if (data.registered) {
        setStatus('Aktif di browser ini · ' + data.count + ' perangkat terdaftar', 'good');
        setButton('Matikan notifikasi', false);
      } else {
        setStatus('Langganan browser ini tidak dikenal server. Aktifkan ulang.', 'dim');
        setButton('Aktifkan notifikasi', false);
      }
    } catch (e) {
      setStatus('Tidak bisa memeriksa status ke server.', 'bad');
      setButton('Coba lagi', false);
    }
  }

  async function enable() {
    setButton('Memproses…', true);
    try {
      var permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('Izin notifikasi tidak diberikan.', 'bad');
        await refreshUi();
        return;
      }

      var reg = await getRegistration();
      await navigator.serviceWorker.ready;

      var keyRes = await fetch('/push/public-key');
      var keyData = await keyRes.json();
      if (!keyData.publicKey) throw new Error(keyData.error || 'Kunci push tidak tersedia.');

      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });

      var res = await fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      if (!res.ok) {
        var err = await res.json();
        throw new Error(err.error || 'Server menolak langganan.');
      }
    } catch (e) {
      setStatus('Gagal mengaktifkan: ' + e.message, 'bad');
    }
    await refreshUi();
  }

  async function disable() {
    setButton('Memproses…', true);
    try {
      var sub = await currentSubscription();
      if (sub) {
        await fetch('/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } catch (e) {
      setStatus('Gagal menonaktifkan: ' + e.message, 'bad');
    }
    await refreshUi();
  }

  async function toggle() {
    var sub = await currentSubscription();
    if (sub) return disable();
    return enable();
  }

  async function sendTest() {
    var testStatus = document.getElementById('push-test-status');
    if (testStatus) testStatus.textContent = 'Mengirim…';
    try {
      var res = await fetch('/push/test', { method: 'POST' });
      var data = await res.json();
      if (testStatus) testStatus.textContent = res.ok ? data.message : data.error;
    } catch (e) {
      if (testStatus) testStatus.textContent = 'Gagal: ' + e.message;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    statusEl = document.getElementById('push-status');
    buttonEl = document.getElementById('push-toggle');
    var testBtn = document.getElementById('push-test');

    if (buttonEl) buttonEl.addEventListener('click', toggle);
    if (testBtn) testBtn.addEventListener('click', sendTest);

    // Daftarkan service worker di semua halaman (bukan cuma Setting), supaya
    // push tetap diterima walau pengguna tidak pernah membuka halaman itu lagi.
    if (supported()) {
      getRegistration().catch(function () { /* diabaikan: bukan fitur kritis */ });
    }

    if (statusEl || buttonEl) refreshUi();
  });
})();
