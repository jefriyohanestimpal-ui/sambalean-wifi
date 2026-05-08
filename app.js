// ==================== FIREBASE CONFIG (GANTI DENGAN DATA ANDA) ====================
const firebaseConfig = {
    apiKey: "AIzaSyBVTmfJQiRkC0eHAEdktRVtJRfMLQAVwes",
    authDomain: "wifi-manager-sambalean.firebaseapp.com",
    projectId: "wifi-manager-sambalean",
    storageBucket: "wifi-manager-sambalean.firebasestorage.ap",
    messagingSenderId: "437031687666",
    appId: "1:437031687666:web:3775aed72b826956df476b"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// ==================== WHATSAPP CONFIG ====================
const WHATSAPP_CONFIG = {
    enabled: false,  // Set true jika sudah punya token Fonnte
    fonnteToken: 'GANTI_DENGAN_TOKEN_FONNTE_ANDA',
    fonnteUrl: 'https://api.fonnte.com/send',
    senderName: 'WiFi Manager'
};

// ==================== GLOBAL STATE ====================
let pelangganData = [];
let pengeluaranData = [];
let transaksiData = [];
let offlineQueue = [];
let isOnline = navigator.onLine;
let currentUser = null;

const BULAN_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const PAKET_LABELS = {'40000':'40.000','60000':'60.000','70000':'70.000','150000':'150.000'};

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', function() {
    setDefaultDates();
    populateYearFilter();
    populateMonthFilter();
    setupNetworkListener();
    loadOfflineData();

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            loadDataFromFirestore();
            updateSyncStatus();
        } else {
            currentUser = null;
            document.getElementById('loginOverlay').style.display = 'flex';
            document.getElementById('appContainer').style.display = 'none';
            document.getElementById('loginEmail').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginError').textContent = '';
            // Bersihkan data lokal saat logout untuk keamanan
            pelangganData = []; pengeluaranData = []; transaksiData = [];
            renderAll();
        }
    });
});

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const el = (id) => document.getElementById(id);
    if(el('tglDaftar')) el('tglDaftar').value = today;
    if(el('tglJatuhTempo')) el('tglJatuhTempo').value = today;
    if(el('bayarTanggal')) el('bayarTanggal').value = today;
    if(el('pengeluaranTanggal')) el('pengeluaranTanggal').value = today;
    const now = new Date();
    const monthStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
    if(el('filterBulanPengeluaran')) el('filterBulanPengeluaran').value = monthStr;
    if(el('filterBulanKeuangan')) el('filterBulanKeuangan').value = monthStr;
}

function populateYearFilter() {
    const sel = document.getElementById('filterTahunBayar');
    if(!sel) return;
    const cy = new Date().getFullYear();
    for(let y = cy-2; y <= cy+1; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        if(y === cy) opt.selected = true;
        sel.appendChild(opt);
    }
}

function populateMonthFilter() {
    const sel = document.getElementById('filterBulanBayar');
    if(!sel) return;
    const now = new Date();
    for(let m = 0; m < 12; m++) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = BULAN_NAMES[m];
        if(m === now.getMonth()) opt.selected = true;
        sel.appendChild(opt);
    }
}

// ==================== NETWORK & OFFLINE ====================
function setupNetworkListener() {
    window.addEventListener('online', () => { isOnline = true; updateSyncStatus(); flushOfflineQueue(); loadDataFromFirestore(); });
    window.addEventListener('offline', () => { isOnline = false; updateSyncStatus(); });
}

function updateSyncStatus() {
    const dot = document.getElementById('syncDot');
    const text = document.getElementById('syncText');
    if(isOnline) { dot.classList.remove('offline'); text.textContent = 'Online'; }
    else { dot.classList.add('offline'); text.textContent = 'Offline'; }
}

function saveToOfflineStorage(key, data) {
    try { localStorage.setItem('wifi_'+key, JSON.stringify(data)); } catch(e) {}
}

function loadFromOfflineStorage(key) {
    try { const d = localStorage.getItem('wifi_'+key); return d ? JSON.parse(d) : null; } catch(e) { return null; }
}

function addToOfflineQueue(action, data) {
    offlineQueue.push({action, data, timestamp: Date.now()});
    saveToOfflineStorage('queue', offlineQueue);
}

function flushOfflineQueue() {
    if(offlineQueue.length === 0) return;
    offlineQueue.forEach(item => {
        const {action, data} = item;
        if(action.startsWith('restore_')) {
            const col = action.replace('restore_','');
            db.collection(col).doc(data.id).set(data).catch(e => console.warn(e));
        } else {
            executeOfflineAction(item);
        }
    });
    offlineQueue = [];
    localStorage.removeItem('wifi_queue');
}

function executeOfflineAction(item) {
    const {action, data} = item;
    switch(action) {
        case 'addPelanggan': db.collection('pelanggan').doc(data.id).set(data).catch(e => console.error(e)); break;
        case 'updatePelanggan': db.collection('pelanggan').doc(data.id).update(data).catch(e => console.error(e)); break;
        case 'addPengeluaran': db.collection('pengeluaran').doc(data.id).set(data).catch(e => console.error(e)); break;
        case 'addTransaksi': db.collection('transaksi').doc(data.id).set(data).catch(e => console.error(e)); break;
    }
}

function loadOfflineData() {
    const sp = loadFromOfflineStorage('pelanggan');
    const sg = loadFromOfflineStorage('pengeluaran');
    const st = loadFromOfflineStorage('transaksi');
    const sq = loadFromOfflineStorage('queue');
    if(sp) pelangganData = sp;
    if(sg) pengeluaranData = sg;
    if(st) transaksiData = st;
    if(sq) offlineQueue = sq;
    updateSyncStatus();
}

// ==================== FIREBASE OPERATIONS (PRODUCTION READY) ====================
function loadDataFromFirestore() {
    const handleAuthError = (err) => {
        if(err.code === 'permission-denied') {
            showToast('⛔ Akses ditolak. Silakan login ulang.','error');
            auth.signOut();
        } else {
            console.warn(err);
        }
        renderAll();
    };

    db.collection('pelanggan').orderBy('createdAt','desc').get()
        .then(snap => { pelangganData = snap.docs.map(d => ({id:d.id,...d.data()})); saveToOfflineStorage('pelanggan',pelangganData); renderAll(); })
        .catch(handleAuthError);

    db.collection('pengeluaran').orderBy('tanggal','desc').get()
        .then(snap => { pengeluaranData = snap.docs.map(d => ({id:d.id,...d.data()})); saveToOfflineStorage('pengeluaran',pengeluaranData); renderAll(); })
        .catch(handleAuthError);

    db.collection('transaksi').orderBy('timestamp','desc').limit(200).get()
        .then(snap => { transaksiData = snap.docs.map(d => ({id:d.id,...d.data()})); saveToOfflineStorage('transaksi',transaksiData); renderAll(); })
        .catch(handleAuthError);
}

// ==================== RENDER ALL ====================
function renderAll() {
    renderDashboard(); renderPelanggan(); renderPembayaran();
    renderPengeluaran(); renderKeuangan(); renderRiwayat(); updateBackupPageInfo();
}

// ==================== DASHBOARD ====================
function renderDashboard() {
    const now = new Date();
    const cm = now.getMonth(), cy = now.getFullYear();

    document.getElementById('totalPelanggan').textContent = pelangganData.length;

    let pemasukan = 0;
    transaksiData.forEach(t => {
        if(t.tipe === 'pemasukan' && t.timestamp) {
            const d = t.timestamp.toDate ? t.timestamp.toDate() : new Date(t.timestamp);
            if(d.getMonth()===cm && d.getFullYear()===cy) pemasukan += Number(t.jumlah)||0;
        }
    });

    let pengeluaran = 0;
    pengeluaranData.forEach(p => {
        const d = p.tanggal ? new Date(p.tanggal) : new Date();
        if(d.getMonth()===cm && d.getFullYear()===cy) pengeluaran += Number(p.jumlah)||0;
    });

    let saldo = 0;
    transaksiData.forEach(t => {
        if(t.tipe==='pemasukan') saldo += Number(t.jumlah)||0;
        if(t.tipe==='pengeluaran') saldo -= Number(t.jumlah)||0;
    });

    let tunggakan = 0;
    pelangganData.forEach(p => tunggakan += hitungTunggakanPelanggan(p));

    document.getElementById('pemasukanBulanIni').textContent = formatRupiah(pemasukan);
    document.getElementById('pengeluaranBulanIni').textContent = formatRupiah(pengeluaran);
    document.getElementById('saldoTotal').textContent = formatRupiah(saldo);
    document.getElementById('totalTunggakan').textContent = formatRupiah(tunggakan);

    const jt = pelangganData.filter(p => {
        if(!p.tglJatuhTempo) return false;
        const d = new Date(p.tglJatuhTempo);
        return d.getMonth()===cm && d.getFullYear()===cy;
    });
    document.getElementById('jatuhTempoList').innerHTML = jt.length === 0
        ? '<p style="color:var(--gray);font-size:13px;">Tidak ada jatuh tempo bulan ini</p>'
        : jt.map(p => `<div class="list-item"><div><strong>${p.nama}</strong><br><small>${p.nomorKTL} - ${PAKET_LABELS[p.paket]}</small></div><span class="badge badge-warning">Jatuh Tempo</span></div>`).join('');

    const last = transaksiData.filter(t=>t.tipe==='pemasukan').sort((a,b)=>{
        const da=a.timestamp?(a.timestamp.toDate?a.timestamp.toDate():new Date(a.timestamp)):new Date(0);
        const db2=b.timestamp?(b.timestamp.toDate?b.timestamp.toDate():new Date(b.timestamp)):new Date(0);
        return db2-da;
    }).slice(0,5);
    document.getElementById('pembayaranTerakhir').innerHTML = last.length===0
        ? '<p style="color:var(--gray);font-size:13px;">Belum ada transaksi</p>'
        : last.map(t=>`<div class="list-item"><div><strong>${t.keterangan||t.namaPelanggan}</strong><br><small>${t.timestamp?(t.timestamp.toDate?t.timestamp.toDate():new Date(t.timestamp)).toLocaleDateString('id-ID'):'-'}</small></div><strong style="color:var(--green)">+${formatRupiah(t.jumlah)}</strong></div>`).join('');
}

function hitungTunggakanPelanggan(p) {
    if(!p.pembayaran||!p.tglDaftar) return 0;
    const tglDaftar = new Date(p.tglDaftar);
    const now = new Date();
    let total = 0;
    const tarif = Number(p.paket)||0;
    let check = new Date(tglDaftar);
    while(check <= now) {
        const bk = check.getFullYear()+'-'+String(check.getMonth()+1).padStart(2,'0');
        const sb = p.pembayaran && p.pembayaran[bk] && p.pembayaran[bk].status==='lunas';
        if(!sb) total += tarif;
        check.setMonth(check.getMonth()+1);
    }
    return total;
}

// ==================== PELANGGAN ====================
function renderPelanggan() {
    const tbody = document.getElementById('tbodyPelanggan');
    const search = (document.getElementById('searchPelanggan')?.value||'').toLowerCase();
    let filtered = pelangganData;
    if(search) filtered = filtered.filter(p => (p.nama||'').toLowerCase().includes(search)||(p.nomorKTL||'').toLowerCase().includes(search)||(p.nomorHP||'').toLowerCase().includes(search));

    if(filtered.length===0) { tbody.innerHTML = '<tr><td colspan="9" class="loading">Belum ada data pelanggan</td></tr>'; return; }

    tbody.innerHTML = filtered.map(p => {
        const tunggakan = hitungTunggakanPelanggan(p);
        return `<tr>
            <td><strong>${p.nomorKTL||'-'}</strong></td><td>${p.nama||'-'}</td><td>${p.nomorHP||'-'}</td>
            <td>${p.alamat||'-'}</td><td><span class="badge badge-success">${PAKET_LABELS[p.paket]||p.paket}</span></td>
            <td>${p.jumlahDevice||1} device</td><td>${p.tglDaftar||'-'}</td>
            <td>${tunggakan>0?`<span class="tunggakan-badge">${formatRupiah(tunggakan)}</span>`:'<span class="badge badge-success">Lunas</span>'}</td>
            <td><div class="action-btns">
                <button class="btn-info btn-sm" onclick="detailPelanggan('${p.id}')" title="Detail"></button>
                <button class="btn-warning btn-sm" onclick="editPelanggan('${p.id}')" title="Edit">✏️</button>
                <button class="btn-success btn-sm" onclick="printKupon('${p.id}')" title="Print">🖨️</button>
                <button class="btn-danger btn-sm" onclick="hapusPelanggan('${p.id}')" title="Hapus">🗑️</button>
            </div></td>
        </tr>`;
    }).join('');
}

function filterPelanggan() { renderPelanggan(); }

function simpanPelanggan() {
    const data = {
        nomorKTL: document.getElementById('nomorKTL').value.trim(),
        nama: document.getElementById('namaPelanggan').value.trim(),
        nomorHP: document.getElementById('nomorHP').value.trim(),
        alamat: document.getElementById('alamatPelanggan').value.trim(),
        paket: document.getElementById('paketPelanggan').value,
        jumlahDevice: Number(document.getElementById('jumlahDevice').value)||1,
        tglDaftar: document.getElementById('tglDaftar').value,
        tglJatuhTempo: document.getElementById('tglJatuhTempo').value,
        pembayaran: {},
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if(!data.nama||!data.nomorKTL) { showToast('Nama dan Nomor KTL wajib diisi!','error'); return; }

    const id = 'p_'+Date.now();
    data.id = id;

    const saveToFirestore = () => db.collection('pelanggan').doc(id).set(data);

    if(isOnline) {
        saveToFirestore().then(()=>{
            showToast('Pelanggan berhasil ditambahkan!','success');
            hideModal('modalTambahPelanggan'); clearForm('modalTambahPelanggan');
            addTransaksi('info',`Pelanggan baru: ${data.nama}`,0,data.nama);
            loadDataFromFirestore();
        }).catch(err=>{
            if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); return; }
            addToOfflineQueue('addPelanggan',data);
            showToast('Disimpan offline, akan sync saat online','warning');
            hideModal('modalTambahPelanggan'); clearForm('modalTambahPelanggan');
            pelangganData.unshift(data); saveToOfflineStorage('pelanggan',pelangganData); renderAll();
        });
    } else {
        addToOfflineQueue('addPelanggan',data);
        showToast('Disimpan offline!','warning');
        hideModal('modalTambahPelanggan'); clearForm('modalTambahPelanggan');
        pelangganData.unshift(data); saveToOfflineStorage('pelanggan',pelangganData); renderAll();
    }
}

function editPelanggan(id) {
    const p = pelangganData.find(x=>x.id===id);
    if(!p) return;
    document.getElementById('editPelangganId').value = id;
    document.getElementById('editNomorKTL').value = p.nomorKTL||'';
    document.getElementById('editNamaPelanggan').value = p.nama||'';
    document.getElementById('editNomorHP').value = p.nomorHP||'';
    document.getElementById('editAlamatPelanggan').value = p.alamat||'';
    document.getElementById('editPaketPelanggan').value = p.paket||'40000';
    document.getElementById('editJumlahDevice').value = p.jumlahDevice||1;
    document.getElementById('editTglDaftar').value = p.tglDaftar||'';
    document.getElementById('editTglJatuhTempo').value = p.tglJatuhTempo||'';
    showModal('modalEditPelanggan');
}

function updatePelanggan() {
    const id = document.getElementById('editPelangganId').value;
    const data = {
        nomorKTL: document.getElementById('editNomorKTL').value.trim(),
        nama: document.getElementById('editNamaPelanggan').value.trim(),
        nomorHP: document.getElementById('editNomorHP').value.trim(),
        alamat: document.getElementById('editAlamatPelanggan').value.trim(),
        paket: document.getElementById('editPaketPelanggan').value,
        jumlahDevice: Number(document.getElementById('editJumlahDevice').value)||1,
        tglDaftar: document.getElementById('editTglDaftar').value,
        tglJatuhTempo: document.getElementById('editTglJatuhTempo').value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if(isOnline) {
        db.collection('pelanggan').doc(id).update(data).then(()=>{
            showToast('Data berhasil diupdate!','success');
            hideModal('modalEditPelanggan'); loadDataFromFirestore();
        }).catch(err=>{
            if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); return; }
            showToast('Gagal: '+err.message,'error');
        });
    } else {
        addToOfflineQueue('updatePelanggan',{id,...data});
        const idx = pelangganData.findIndex(x=>x.id===id);
        if(idx>=0) pelangganData[idx] = {...pelangganData[idx],...data};
        saveToOfflineStorage('pelanggan',pelangganData);
        showToast('Disimpan offline!','warning');
        hideModal('modalEditPelanggan'); renderAll();
    }
}

function hapusPelanggan(id) {
    if(!confirm('Yakin hapus pelanggan ini?')) return;
    const p = pelangganData.find(x=>x.id===id);
    if(isOnline) {
        db.collection('pelanggan').doc(id).delete().then(()=>{
            showToast('Pelanggan dihapus!','success'); loadDataFromFirestore();
        }).catch(err=>{
            if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); }
        });
    } else {
        pelangganData = pelangganData.filter(x=>x.id!==id);
        saveToOfflineStorage('pelanggan',pelangganData);
        showToast('Dihapus offline!','warning'); renderAll();
    }
    if(p) addTransaksi('info',`Pelanggan dihapus: ${p.nama}`,0,p.nama);
}

function detailPelanggan(id) {
    const p = pelangganData.find(x=>x.id===id);
    if(!p) return;
    const tunggakan = hitungTunggakanPelanggan(p);
    document.getElementById('detailPelangganInfo').innerHTML = `
        <div class="detail-item"><label>No. KTL</label><p>${p.nomorKTL}</p></div>
        <div class="detail-item"><label>Nama</label><p>${p.nama}</p></div>
        <div class="detail-item"><label>No. HP</label><p>${p.nomorHP}</p></div>
        <div class="detail-item"><label>Alamat</label><p>${p.alamat}</p></div>
        <div class="detail-item"><label>Paket</label><p>${PAKET_LABELS[p.paket]||p.paket}</p></div>
        <div class="detail-item"><label>Perangkat</label><p>${p.jumlahDevice||1} device</p></div>
        <div class="detail-item"><label>Tgl Daftar</label><p>${p.tglDaftar||'-'}</p></div>
        <div class="detail-item"><label>Jatuh Tempo</label><p>${p.tglJatuhTempo||'-'}</p></div>
        <div class="detail-item"><label>Total Tunggakan</label><p style="color:var(--red);font-weight:700">${formatRupiah(tunggakan)}</p></div>
    `;

    const now = new Date();
    const cy = now.getFullYear();
    const tbody = document.getElementById('tbodyDetailBayar');
    let html = '';
    for(let m=0;m<12;m++) {
        const bk = cy+'-'+String(m+1).padStart(2,'0');
        const bayar = p.pembayaran && p.pembayaran[bk];
        const status = bayar && bayar.status==='lunas';
        html += `<tr>
            <td>${BULAN_NAMES[m]} ${cy}</td>
            <td>${status?'<span class="badge badge-success">✅ Lunas</span>':'<span class="badge badge-danger">❌ Belum</span>'}</td>
            <td>${status?(bayar.tglBayar||'-'):'-'}</td>
            <td>${!status?`<button class="btn-success btn-sm" onclick="bayarDariDetail('${p.id}','${bk}',${m},${cy})">💰 Bayar</button>`:`<button class="btn-danger btn-sm" onclick="batalBayar('${p.id}','${bk}')">↩️</button> <button class="btn-info btn-sm" onclick="printBayarKupon('${p.id}','${bk}')">️</button>`}</td>
        </tr>`;
    }
    tbody.innerHTML = html;
    showModal('modalDetailPelanggan');
}

function bayarDariDetail(pid, bk, m, y) {
    const p = pelangganData.find(x=>x.id===pid);
    if(!p) return;
    document.getElementById('bayarPelangganId').value = pid;
    document.getElementById('bayarBulan').value = m;
    document.getElementById('bayarTahun').value = y;
    document.getElementById('bayarNama').value = p.nama;
    document.getElementById('bayarPaket').value = PAKET_LABELS[p.paket]||p.paket;
    document.getElementById('bayarBulanTahun').value = BULAN_NAMES[m]+' '+y;
    document.getElementById('bayarTanggal').value = new Date().toISOString().split('T')[0];
    document.getElementById('bayarJumlah').value = p.paket;
    hideModal('modalDetailPelanggan');
    showModal('modalBayar');
}

// ==================== PEMBAYARAN ====================
function renderPembayaran() {
    const bulan = Number(document.getElementById('filterBulanBayar').value);
    const tahun = Number(document.getElementById('filterTahunBayar').value);
    const fp = document.getElementById('filterPaketBayar').value;
    const tbody = document.getElementById('tbodyPembayaran');
    let filtered = pelangganData;
    if(fp) filtered = filtered.filter(p=>p.paket===fp);

    let html = '';
    filtered.forEach(p => {
        const bk = tahun+'-'+String(bulan+1).padStart(2,'0');
        const bayar = p.pembayaran && p.pembayaran[bk];
        const status = bayar && bayar.status==='lunas';
        html += `<tr>
            <td>${p.nomorKTL}</td><td>${p.nama}</td><td>${PAKET_LABELS[p.paket]||p.paket}</td>
            <td>${status?'<span class="badge badge-success">✅ Lunas</span>':'<span class="badge badge-danger">❌ Belum</span>'}</td>
            <td>${status?(bayar.tglBayar||'-'):'-'}</td>
            <td>${!status?`<button class="btn-success btn-sm" onclick="bayarPelanggan('${p.id}',${bulan},${tahun})">💰 Bayar</button>`:`<button class="btn-danger btn-sm" onclick="batalBayar('${p.id}','${bk}')">↩️</button> <button class="btn-info btn-sm" onclick="printBayarKupon('${p.id}','${bk}')">🖨️</button>`}</td>
        </tr>`;
    });
    tbody.innerHTML = html || '<tr><td colspan="6" class="loading">Tidak ada data</td></tr>';
}

function bayarPelanggan(pid, bulan, tahun) {
    const p = pelangganData.find(x=>x.id===pid);
    if(!p) return;
    document.getElementById('bayarPelangganId').value = pid;
    document.getElementById('bayarBulan').value = bulan;
    document.getElementById('bayarTahun').value = tahun;
    document.getElementById('bayarNama').value = p.nama;
    document.getElementById('bayarPaket').value = PAKET_LABELS[p.paket]||p.paket;
    document.getElementById('bayarBulanTahun').value = BULAN_NAMES[bulan]+' '+tahun;
    document.getElementById('bayarTanggal').value = new Date().toISOString().split('T')[0];
    document.getElementById('bayarJumlah').value = p.paket;
    showModal('modalBayar');
}

function prosesBayar() {
    const pid = document.getElementById('bayarPelangganId').value;
    const bulan = Number(document.getElementById('bayarBulan').value);
    const tahun = Number(document.getElementById('bayarTahun').value);
    const tglBayar = document.getElementById('bayarTanggal').value;
    const jumlah = Number(document.getElementById('bayarJumlah').value);
    const p = pelangganData.find(x=>x.id===pid);
    if(!p) return;

    const bk = tahun+'-'+String(bulan+1).padStart(2,'0');
    if(!p.pembayaran) p.pembayaran = {};
    p.pembayaran[bk] = { status:'lunas', tglBayar, jumlah, dibayarPada:new Date().toISOString() };

    if(isOnline) {
        db.collection('pelanggan').doc(pid).update({ pembayaran:p.pembayaran, updatedAt:firebase.firestore.FieldValue.serverTimestamp() })
        .then(()=>{
            addTransaksi('pemasukan',`Pembayaran ${BULAN_NAMES[bulan]} ${tahun} - ${p.nama}`,jumlah,p.nama);
            showToast(`Pembayaran ${BULAN_NAMES[bulan]} ${tahun} berhasil!`,'success');
            hideModal('modalBayar'); loadDataFromFirestore();
        }).catch(err=>{
            if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); return; }
            showToast('Gagal: '+err.message,'error');
        });
    } else {
        const idx = pelangganData.findIndex(x=>x.id===pid);
        if(idx>=0) pelangganData[idx] = p;
        saveToOfflineStorage('pelanggan',pelangganData);
        addTransaksi('pemasukan',`Pembayaran ${BULAN_NAMES[bulan]} ${tahun} - ${p.nama}`,jumlah,p.nama);
        showToast('Pembayaran disimpan offline!','warning');
        hideModal('modalBayar'); renderAll();
    }
}

function batalBayar(pid, bk) {
    if(!confirm('Batalkan pembayaran ini?')) return;
    const p = pelangganData.find(x=>x.id===pid);
    if(!p||!p.pembayaran||!p.pembayaran[bk]) return;
    delete p.pembayaran[bk];
    if(isOnline) {
        db.collection('pelanggan').doc(pid).update({ pembayaran:p.pembayaran, updatedAt:firebase.firestore.FieldValue.serverTimestamp() })
        .then(()=>{ showToast('Pembayaran dibatalkan','success'); loadDataFromFirestore(); })
        .catch(err=>{ if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); } });
    } else {
        const idx = pelangganData.findIndex(x=>x.id===pid);
        if(idx>=0) pelangganData[idx] = p;
        saveToOfflineStorage('pelanggan',pelangganData);
        showToast('Dibatalkan offline','warning'); renderAll();
    }
}

// ==================== PENGELUARAN ====================
function renderPengeluaran() {
    const fb = document.getElementById('filterBulanPengeluaran').value;
    const tbody = document.getElementById('tbodyPengeluaran');
    let filtered = pengeluaranData;
    if(fb) filtered = filtered.filter(p=>p.tanggal&&p.tanggal.startsWith(fb));

    let total = 0;
    let html = filtered.map(p => {
        total += Number(p.jumlah)||0;
        return `<tr><td>${p.tanggal||'-'}</td><td>${p.keterangan||'-'}</td><td>${formatRupiah(p.jumlah)}</td><td><button class="btn-danger btn-sm" onclick="hapusPengeluaran('${p.id}')">🗑️</button></td></tr>`;
    }).join('');
    tbody.innerHTML = html || '<tr><td colspan="4" class="loading">Belum ada pengeluaran</td></tr>';
    document.getElementById('totalPengeluaranList').textContent = formatRupiah(total);
}

function simpanPengeluaran() {
    const data = {
        tanggal: document.getElementById('pengeluaranTanggal').value,
        keterangan: document.getElementById('pengeluaranKeterangan').value.trim(),
        jumlah: Number(document.getElementById('pengeluaranJumlah').value)||0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if(!data.keterangan||!data.jumlah) { showToast('Keterangan dan jumlah wajib diisi!','error'); return; }
    const id = 'pg_'+Date.now();
    data.id = id;

    if(isOnline) {
        db.collection('pengeluaran').doc(id).set(data).then(()=>{
            addTransaksi('pengeluaran',data.keterangan,data.jumlah);
            showToast('Pengeluaran ditambahkan!','success');
            hideModal('modalTambahPengeluaran'); clearForm('modalTambahPengeluaran');
            loadDataFromFirestore();
        }).catch(err=>{
            if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); return; }
            showToast('Gagal: '+err.message,'error');
        });
    } else {
        addToOfflineQueue('addPengeluaran',data);
        addTransaksi('pengeluaran',data.keterangan,data.jumlah);
        pengeluaranData.unshift(data); saveToOfflineStorage('pengeluaran',pengeluaranData);
        showToast('Disimpan offline!','warning');
        hideModal('modalTambahPengeluaran'); clearForm('modalTambahPengeluaran'); renderAll();
    }
}

function hapusPengeluaran(id) {
    if(!confirm('Hapus pengeluaran ini?')) return;
    const p = pengeluaranData.find(x=>x.id===id);
    if(isOnline) {
        db.collection('pengeluaran').doc(id).delete().then(()=>{ showToast('Dihapus!','success'); loadDataFromFirestore(); })
        .catch(err=>{ if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); } });
    } else {
        pengeluaranData = pengeluaranData.filter(x=>x.id!==id);
        saveToOfflineStorage('pengeluaran',pengeluaranData);
        showToast('Dihapus offline','warning'); renderAll();
    }
    if(p) addTransaksi('info',`Pengeluaran dihapus: ${p.keterangan}`,0);
}

// ==================== LAPORAN KEUANGAN ====================
function renderKeuangan() {
    const fb = document.getElementById('filterBulanKeuangan').value;
    let masuk = 0, keluar = 0;
    transaksiData.filter(t=>t.tipe==='pemasukan').forEach(t => {
        if(!fb||(t.timestamp&&t.timestamp.toDate&&t.timestamp.toDate().toISOString().startsWith(fb))) masuk += Number(t.jumlah)||0;
    });
    pengeluaranData.forEach(p => {
        if(!fb||(p.tanggal&&p.tanggal.startsWith(fb))) keluar += Number(p.jumlah)||0;
    });
    transaksiData.filter(t=>t.tipe==='pengeluaran').forEach(t => {
        if(!fb||(t.timestamp&&t.timestamp.toDate&&t.timestamp.toDate().toISOString().startsWith(fb))) keluar += Number(t.jumlah)||0;
    });
    document.getElementById('laporanPemasukan').textContent = formatRupiah(masuk);
    document.getElementById('laporanPengeluaran').textContent = formatRupiah(keluar);
    document.getElementById('laporanSaldo').textContent = formatRupiah(masuk-keluar);

    const all = [];
    transaksiData.forEach(t => { if(!fb||(t.timestamp&&t.timestamp.toDate&&t.timestamp.toDate().toISOString().startsWith(fb))) all.push(t); });
    pengeluaranData.forEach(p => { if(!fb||(p.tanggal&&p.tanggal.startsWith(fb))) all.push({tipe:'pengeluaran',keterangan:p.keterangan,jumlah:p.jumlah,timestamp:new Date(p.tanggal)}); });
    all.sort((a,b)=>{
        const da=a.timestamp?(a.timestamp.toDate?a.timestamp.toDate():new Date(a.timestamp)):new Date(0);
        const db2=b.timestamp?(b.timestamp.toDate?b.timestamp.toDate():new Date(b.timestamp)):new Date(0);
        return db2-da;
    });
    document.getElementById('tbodyLaporanKeuangan').innerHTML = all.map(t=>`<tr>
        <td>${t.timestamp?(t.timestamp.toDate?t.timestamp.toDate().toLocaleDateString('id-ID'):new Date(t.timestamp).toLocaleDateString('id-ID')):'-'}</td>
        <td><span class="badge ${t.tipe==='pemasukan'?'badge-success':t.tipe==='pengeluaran'?'badge-danger':'badge-warning'}">${t.tipe}</span></td>
        <td>${t.keterangan||'-'}</td>
        <td style="color:${t.tipe==='pemasukan'?'var(--green)':t.tipe==='pengeluaran'?'var(--red)':'var(--gray)'}">${t.tipe==='pemasukan'?'+':t.tipe==='pengeluaran'?'-':''}${formatRupiah(t.jumlah)}</td>
    </tr>`).join('')||'<tr><td colspan="4" class="loading">Tidak ada transaksi</td></tr>';
}

// ==================== RIWAYAT ====================
function renderRiwayat() {
    const tbody = document.getElementById('tbodyRiwayat');
    const sorted = [...transaksiData].sort((a,b)=>{
        const da=a.timestamp?(a.timestamp.toDate?a.timestamp.toDate():new Date(a.timestamp)):new Date(0);
        const db2=b.timestamp?(b.timestamp.toDate?b.timestamp.toDate():new Date(b.timestamp)):new Date(0);
        return db2-da;
    });
    tbody.innerHTML = sorted.slice(0,100).map(t=>`<tr>
        <td>${t.timestamp?(t.timestamp.toDate?t.timestamp.toDate().toLocaleString('id-ID'):new Date(t.timestamp).toLocaleString('id-ID')):'-'}</td>
        <td><span class="badge ${t.tipe==='pemasukan'?'badge-success':t.tipe==='pengeluaran'?'badge-danger':'badge-warning'}">${t.tipe}</span></td>
        <td>${t.keterangan||'-'}</td>
        <td style="font-weight:600;color:${t.tipe==='pemasukan'?'var(--green)':t.tipe==='pengeluaran'?'var(--red)':'var(--gray)'}">${t.tipe==='pemasukan'?'+':t.tipe==='pengeluaran'?'-':''}${formatRupiah(t.jumlah)}</td>
    </tr>`).join('')||'<tr><td colspan="4" class="loading">Belum ada riwayat</td></tr>';
}

// ==================== TRANSAKSI HELPER ====================
function addTransaksi(tipe, keterangan, jumlah, namaPelanggan) {
    const data = { tipe, keterangan, jumlah, namaPelanggan:namaPelanggan||'', timestamp:firebase.firestore.FieldValue.serverTimestamp(), createdAt:firebase.firestore.FieldValue.serverTimestamp() };
    const id = 'tx_'+Date.now();
    transaksiData.unshift({id,...data,timestamp:new Date()});
    saveToOfflineStorage('transaksi',transaksiData);
    if(isOnline) db.collection('transaksi').doc(id).set(data).catch(e=>console.error(e));
    else addToOfflineQueue('addTransaksi',{id,...data});
}

// ==================== WHATSAPP ====================
function formatPhoneNumber(phone) {
    let c = (phone||'').replace(/[\s\-\(\)]/g,'');
    if(c.startsWith('0')) c = '62'+c.substring(1);
    if(c.startsWith('+62')) c = '62'+c.substring(3);
    return c;
}

async function sendWhatsAppNotification(phone, message) {
    if(!WHATSAPP_CONFIG.enabled) { console.log('WA disabled'); return {success:false,message:'WhatsApp disabled'}; }
    const fp = formatPhoneNumber(phone);
    try {
        const res = await fetch(WHATSAPP_CONFIG.fonnteUrl, {
            method:'POST',
            headers:{'Authorization':WHATSAPP_CONFIG.fonnteToken,'Content-Type':'application/json'},
            body:JSON.stringify({target:fp,message:message,countryCode:'62'})
        });
        const result = await res.json();
        if(result.status) { showToast('✅ WA terkirim ke '+phone,'success'); return {success:true,result}; }
        else { showToast('❌ Gagal: '+result.reason,'error'); return {success:false,error:result.reason}; }
    } catch(e) { showToast('Error kirim WA','error'); return {success:false,error:e.message}; }
}

function generateReminderMessage(p, bulan, tahun, daysUntilDue) {
    let urgency = daysUntilDue<=0?'🔴 *SUDAH JATUH TEMPO*':daysUntilDue<=3?'🟡 *SEGERA BAYAR*':'🟢 *PENGINGAT*';
    return `*${urgency}*

Halo *${p.nama}*,

Ini pengingat tagihan WiFi bulan *${bulan} ${tahun}*

📋 Detail Tagihan:
- Nomor KTL: ${p.nomorKTL}
- Paket: ${formatRupiah(p.paket)}
- Jatuh Tempo: ${p.tglJatuhTempo||'-'}

💰 Silakan segera melakukan pembayaran.

Terima kasih 
_*WiFi Manager*_`.trim();
}

async function sendBulkReminders(daysBefore = 3) {
    if(!confirm(`Kirim pengingat H-${daysBefore} ke semua pelanggan yang belum bayar?`)) return;
    const now = new Date();
    const cm = now.getMonth(), cy = now.getFullYear();
    let sent = 0, failed = 0;
    showToast('📤 Mengirim pengingat...','warning');

    for(const p of pelangganData) {
        const bk = cy+'-'+String(cm+1).padStart(2,'0');
        const sb = p.pembayaran && p.pembayaran[bk] && p.pembayaran[bk].status==='lunas';
        if(!sb) {
            let days = 999;
            if(p.tglJatuhTempo) {
                const jt = new Date(p.tglJatuhTempo);
                days = Math.ceil((jt-now)/(1000*60*60*24));
            }
            if(days <= daysBefore && p.nomorHP) {
                const msg = generateReminderMessage(p, BULAN_NAMES[cm], cy, days);
                const res = await sendWhatsAppNotification(p.nomorHP, msg);
                if(res.success) sent++; else failed++;
                await new Promise(r=>setTimeout(r,1200));
            }
        }
    }
    showToast(`✅ Terkirim: ${sent}, Gagal: ${failed}`,'success');
}

function sendManualWA() {
    const phone = document.getElementById('manualWAPhone').value;
    const msg = document.getElementById('manualWAMessage').value;
    if(!phone||!msg) { showToast('Nomor dan pesan wajib diisi!','error'); return; }
    sendWhatsAppNotification(phone, msg);
    document.getElementById('manualWAPhone').value = '';
    document.getElementById('manualWAMessage').value = '';
}

// ==================== PRINT ====================
function printPage() { window.print(); }

function printKupon(pid) {
    const p = pelangganData.find(x=>x.id===pid);
    if(!p) return;
    const now = new Date();
    const bk = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
    printBayarKupon(pid, bk);
}

function printBayarKupon(pid, bk) {
    const p = pelangganData.find(x=>x.id===pid);
    if(!p) return;
    const [tahun, bulan] = bk.split('-');
    const bulanNama = BULAN_NAMES[parseInt(bulan)-1]+' '+tahun;
    const bayar = p.pembayaran && p.pembayaran[bk];
    const status = bayar && bayar.status==='lunas';
    const tarif = formatRupiah(p.paket);

    const html = `<html><head><title>Kupon - ${p.nama} - ${bulanNama}</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Courier New',monospace;font-size:11px;padding:10px;}
        .kc{display:flex;width:100%;max-width:550px;margin:0 auto;}
        .kh{width:50%;border:2px solid #333;padding:10px;}
        .kh.arsip{border-right:3px dashed #999;}
        .kh.pelanggan{border-left:none;}
        .kt{text-align:center;font-weight:bold;font-size:14px;border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:8px;}
        .kt small{font-weight:normal;font-size:10px;}
        .kr{display:flex;margin-bottom:4px;align-items:baseline;}
        .kl{width:85px;font-weight:bold;font-size:10px;}
        .kv{flex:1;border-bottom:1px dotted #999;padding-bottom:1px;min-height:14px;}
        .kd{border-top:2px solid #333;margin:10px 0;}
        .kf{text-align:center;margin-top:12px;font-size:9px;border-top:1px solid #ccc;padding-top:6px;}
        .kf .ttd{margin-top:30px;display:flex;justify-content:space-around;}
        .kf .ttd div{text-align:center;}
        .kf .ttd .line{border-top:1px solid #333;width:100px;margin:30px auto 4px;}
        .sl{color:green;font-weight:bold;}.sb{color:red;font-weight:bold;}
        @media print{.np{display:none;}}
    </style></head><body>
    <h2 style="text-align:center;margin-bottom:15px;font-family:sans-serif;">KUPON TAGIHAN WIFI</h2>
    <div class="kc">
        <div class="kh arsip">
            <div class="kt">📡 KUPON TAGIHAN WIFI<br><small>(ARSIP - PEMILIK)</small></div>
            <div class="kr"><span class="kl">NOMOR HP</span><span class="kv">${p.nomorHP||'-'}</span></div>
            <div class="kr"><span class="kl">NOMOR KTL</span><span class="kv">${p.nomorKTL||'-'}</span></div>
            <div class="kr"><span class="kl">NAMA</span><span class="kv">${p.nama||'-'}</span></div>
            <div class="kr"><span class="kl">ALAMAT</span><span class="kv">${p.alamat||'-'}</span></div>
            <div class="kr"><span class="kl">BULAN</span><span class="kv">${bulanNama}</span></div>
            <div class="kr"><span class="kl">TARIFF</span><span class="kv">${tarif}</span></div>
            <div class="kr"><span class="kl">STATUS</span><span class="kv ${status?'sl':'sb'}">${status?'✅ LUNAS':'❌ BELUM BAYAR'}</span></div>
            <div class="kr"><span class="kl">TGL BAYAR</span><span class="kv">${bayar?bayar.tglBayar:'-'}</span></div>
            <div class="kd"></div>
            <div class="kr"><span class="kl">JUMLAH RP</span><span class="kv" style="font-weight:bold;font-size:13px;">${tarif}</span></div>
            <div class="kf"><div class="ttd"><div><div class="line"></div>Penerima</div><div><div class="line"></div>Penagih</div></div><p style="margin-top:8px;">Cetak: ${new Date().toLocaleDateString('id-ID')}</p></div>
        </div>
        <div class="kh pelanggan">
            <div class="kt">📡 KUPON TAGIHAN WIFI<br><small>(PELANGGAN)</small></div>
            <div class="kr"><span class="kl">NOMOR HP</span><span class="kv">${p.nomorHP||'-'}</span></div>
            <div class="kr"><span class="kl">NOMOR KTL</span><span class="kv">${p.nomorKTL||'-'}</span></div>
            <div class="kr"><span class="kl">NAMA</span><span class="kv">${p.nama||'-'}</span></div>
            <div class="kr"><span class="kl">ALAMAT</span><span class="kv">${p.alamat||'-'}</span></div>
            <div class="kr"><span class="kl">BULAN</span><span class="kv">${bulanNama}</span></div>
            <div class="kr"><span class="kl">TARIFF</span><span class="kv">${tarif}</span></div>
            <div class="kr"><span class="kl">STATUS</span><span class="kv ${status?'sl':'sb'}">${status?'✅ LUNAS':'❌ BELUM BAYAR'}</span></div>
            <div class="kr"><span class="kl">TGL BAYAR</span><span class="kv">${bayar?bayar.tglBayar:'-'}</span></div>
            <div class="kd"></div>
            <div class="kr"><span class="kl">JUMLAH RP</span><span class="kv" style="font-weight:bold;font-size:13px;">${tarif}</span></div>
            <div class="kf"><div class="ttd"><div><div class="line"></div>Penerima</div><div><div class="line"></div>Penagih</div></div><p style="margin-top:8px;">Cetak: ${new Date().toLocaleDateString('id-ID')}</p></div>
        </div>
    </div>
    <div class="np" style="text-align:center;margin-top:20px;"><button onclick="window.print()" style="padding:10px 30px;font-size:16px;cursor:pointer;">🖨️ Print</button> <button onclick="window.close()" style="padding:10px 30px;font-size:16px;cursor:pointer;margin-left:10px;">Tutup</button></div>
    </body></html>`;

    const w = window.open('','_blank');
    w.document.write(html);
    w.document.close();
}

// ==================== BACKUP / EXPORT ====================
function cleanFirestoreTimestamps(obj) {
    if(!obj||typeof obj!=='object') return obj;
    const c = Array.isArray(obj)?[]:{};
    for(let k in obj) {
        const v = obj[k];
        if(v&&typeof v==='object') {
            if(v._seconds!==undefined) c[k]=new Date(v._seconds*1000).toISOString();
            else if(v.toDate) c[k]=v.toDate().toISOString();
            else c[k]=cleanFirestoreTimestamps(v);
        } else c[k]=v;
    }
    return c;
}

async function exportAllData() {
    const el = document.getElementById('exportStatus');
    el.innerHTML = '<div class="spinner"></div><p style="margin-top:8px;">Mengumpulkan data...</p>';
    try {
        let p=pelangganData, pg=pengeluaranData, t=transaksiData;
        if(isOnline) {
            const [s1,s2,s3] = await Promise.all([db.collection('pelanggan').get(),db.collection('pengeluaran').get(),db.collection('transaksi').get()]);
            p=s1.docs.map(d=>({id:d.id,...d.data()}));
            pg=s2.docs.map(d=>({id:d.id,...d.data()}));
            t=s3.docs.map(d=>({id:d.id,...d.data()}));
        }
        const backup = {
            version:"1.0", exportDate:new Date().toISOString(), exportedFrom:"WiFi Manager Pro",
            summary:{totalPelanggan:p.length,totalTransaksi:t.length,totalPengeluaran:pg.length},
            pelanggan:p.map(cleanFirestoreTimestamps), pengeluaran:pg.map(cleanFirestoreTimestamps), transaksi:t.map(cleanFirestoreTimestamps)
        };
        const blob = new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href=url; a.download=`wifi_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        el.innerHTML='<p style="color:var(--green);font-weight:600;">✅ Backup berhasil! Cek folder Downloads.</p>';
        showToast('Backup selesai!','success');
    } catch(err) { 
        if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); }
        else { el.innerHTML=`<p style="color:var(--red);">❌ Gagal: ${err.message}</p>`; showToast('Gagal export','error'); }
    }
}

function updateBackupPageInfo() {
    const el = document.getElementById('dbInfo');
    if(!el) return;
    el.innerHTML=`
        <div class="detail-item"><label>Total Pelanggan</label><p>${pelangganData.length} orang</p></div>
        <div class="detail-item"><label>Total Transaksi</label><p>${transaksiData.length} record</p></div>
        <div class="detail-item"><label>Total Pengeluaran</label><p>${pengeluaranData.length} record</p></div>
        <div class="detail-item"><label>Status</label><p>${isOnline?'🟢 Online':'🔴 Offline'}</p></div>
    `;
}

// ==================== IMPORT / RESTORE ====================
function handleImportFile(input) {
    const file = input.files[0];
    if(!file) return;
    if(!file.name.toLowerCase().endsWith('.json')) { showToast('Hanya file .json!','error'); input.value=''; return; }

    const statusEl = document.getElementById('importStatus');
    const progressEl = document.getElementById('importProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    statusEl.innerHTML='<p>📖 Membaca file...</p>';
    progressEl.style.display='block'; progressBar.style.width='0%'; progressText.textContent='0%';

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if(!data||typeof data!=='object'||!Array.isArray(data.pelanggan)||!Array.isArray(data.pengeluaran)||!Array.isArray(data.transaksi)) throw new Error('Format tidak valid');
            startImport(data);
        } catch(err) { statusEl.innerHTML=`<p style="color:var(--red);">❌ ${err.message}</p>`; progressEl.style.display='none'; showToast('File tidak valid','error'); }
    };
    reader.onerror = () => { statusEl.innerHTML='<p style="color:var(--red);">❌ Gagal membaca file</p>'; progressEl.style.display='none'; };
    reader.readAsText(file);
    input.value='';
}

async function startImport(data) {
    const statusEl = document.getElementById('importStatus');
    const progressEl = document.getElementById('importProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    statusEl.innerHTML='<p style="color:var(--blue);">⏳ Memproses import...</p>';

    try {
        const total = data.pelanggan.length+data.pengeluaran.length+data.transaksi.length;
        let processed = 0;
        const updateProg = (c) => { processed+=c; const p=Math.min(100,Math.round((processed/total)*100)); progressBar.style.width=p+'%'; progressText.textContent=p+'%'; };

        async function batchWrite(col, docs) {
            if(docs.length===0) return;
            for(let i=0;i<docs.length;i+=500) {
                const slice = docs.slice(i,i+500);
                if(!isOnline) { slice.forEach(d=>addToOfflineQueue('restore_'+col,d)); }
                else {
                    const batch = db.batch();
                    slice.forEach(d => {
                        let docRef;
                        if(d.id&&d.id.trim()!=='') docRef = db.collection(col).doc(d.id);
                        else { docRef = db.collection(col).doc(); d.id = docRef.id; }
                        batch.set(docRef,d);
                    });
                    await batch.commit();
                }
                updateProg(slice.length);
                await new Promise(r=>setTimeout(r,80));
            }
        }

        await batchWrite('pelanggan',data.pelanggan);
        await batchWrite('pengeluaran',data.pengeluaran);
        await batchWrite('transaksi',data.transaksi);

        pelangganData = data.pelanggan; pengeluaranData = data.pengeluaran; transaksiData = data.transaksi;
        saveToOfflineStorage('pelanggan',pelangganData);
        saveToOfflineStorage('pengeluaran',pengeluaranData);
        saveToOfflineStorage('transaksi',transaksiData);

        progressBar.style.width='100%'; progressText.textContent='100%';
        statusEl.innerHTML='<p style="color:var(--green);font-weight:600;">✅ Restore berhasil!</p>';
        showToast('Data berhasil di-restore!','success');
        renderAll();
    } catch(err) { 
        if(err.code === 'permission-denied') { showToast('⛔ Akses ditolak. Login ulang.','error'); auth.signOut(); }
        else { statusEl.innerHTML=`<p style="color:var(--red);">❌ Gagal: ${err.message}</p>`; showToast('Import gagal','error'); }
    }
    finally { setTimeout(()=>{progressEl.style.display='none';},2000); }
}

// ==================== NAVIGATION ====================
function showPage(name) {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'));
    document.getElementById('page-'+name).classList.add('active');
    if(event&&event.target) event.target.classList.add('active');
    const titles = {'dashboard':'Dashboard','pelanggan':'Data Pelanggan','pembayaran':'Pembayaran','pengeluaran':'Pengeluaran','keuangan':'Laporan Keuangan','riwayat':'Riwayat Transaksi','notifikasi':'Notifikasi WhatsApp','backup':'Backup & Import'};
    document.getElementById('pageTitle').textContent = titles[name]||'Dashboard';
    document.getElementById('sidebar').classList.remove('open');
    if(name==='backup') setTimeout(updateBackupPageInfo,100);
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ==================== MODALS ====================
function showModal(id) { document.getElementById(id).classList.add('active'); }
function hideModal(id) { document.getElementById(id).classList.remove('active'); }
function clearForm(mid) {
    const m = document.getElementById(mid);
    m.querySelectorAll('input[type="text"],input[type="tel"],input[type="number"]').forEach(i=>{if(i.id!=='jumlahDevice')i.value='';});
}

document.querySelectorAll('.modal-overlay').forEach(o=>{
    o.addEventListener('click',function(e){if(e.target===this)this.classList.remove('active');});
});

// ==================== AUTH ====================
function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    if(!email||!password) { errEl.textContent='Email dan password wajib diisi!'; return; }
    errEl.textContent='Memproses...';
    auth.signInWithEmailAndPassword(email,password).then(()=>{
        showToast('✅ Login berhasil!','success');
    }).catch(err=>{
        let msg=err.message;
        if(err.code==='auth/user-not-found') msg='Email tidak terdaftar';
        if(err.code==='auth/wrong-password') msg='Password salah';
        if(err.code==='auth/invalid-email') msg='Format email tidak valid';
        if(err.code==='auth/too-many-requests') msg='Terlalu banyak percobaan. Coba lagi nanti.';
        errEl.textContent=msg;
    });
}

function doLogout() {
    if(!confirm('Yakin ingin logout?')) return;
    auth.signOut().then(()=>showToast('Logout berhasil','warning'));
}

function resetPassword() {
    const email = prompt('Masukkan email admin untuk reset password:');
    if(!email) return;
    auth.sendPasswordResetEmail(email).then(()=>showToast(' Link reset dikirim ke email!','success')).catch(err=>showToast('❌ '+err.message,'error'));
}

// ==================== UTILITIES ====================
function formatRupiah(a) { if(!a&&a!==0) return 'Rp 0'; return 'Rp '+Number(a).toLocaleString('id-ID'); }

function showToast(msg,type='success') {
    const ex=document.querySelector('.toast'); if(ex) ex.remove();
    const t=document.createElement('div'); t.className='toast toast-'+type; t.textContent=msg;
    document.body.appendChild(t); setTimeout(()=>t.remove(),3000);
}