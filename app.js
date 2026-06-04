// ==================== 数据管理 ====================
const STORAGE_KEY = 'express_data';

function loadData() {
    const json = localStorage.getItem(STORAGE_KEY);
    return json ? JSON.parse(json) : [];
}

function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let expressList = loadData();
let currentFilter = 'unsigned';
let selectionMode = false;
let searchMode = false;
let selectedIds = new Set();
let longPressTimer = null;
let hasMoved = false;

// 扫码相关
let scannerActive = false;
let html5QrCode = null;
let scannerLibraryLoaded = false;
let scannerLibraryLoading = false;
let scannerLibraryCallbacks = [];

// ==================== 渲染 ====================
function render() {
    const container = document.getElementById('listContainer');
    
    let filtered = searchMode ? (window.searchResults || expressList) : expressList;
    if (!searchMode) {
        if (currentFilter === 'signed') filtered = filtered.filter(e => e.signed);
        else if (currentFilter === 'unsigned') filtered = filtered.filter(e => !e.signed);
    }
    
    filtered.sort((a, b) => b.createDate - a.createDate);
    
    const groups = {};
    filtered.forEach(item => {
        const dateKey = formatDate(new Date(item.createDate));
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(item);
    });
    
    if (Object.keys(groups).length === 0) {
        container.innerHTML = '<div class="empty-state">暂无快递单号</div>';
        updateUI();
        return;
    }
    
    let html = '';
    for (const [date, items] of Object.entries(groups)) {
        html += `<div class="date-header">${date}</div>`;
        items.forEach(item => {
            const selectedClass = selectedIds.has(item.id) ? ' selected' : '';
            const statusClass = item.signed ? 'status-signed' : 'status-unsigned';
            const statusText = item.signed ? '已签收' : '未签收';
            html += `
                <div class="express-item${selectedClass}" data-id="${item.id}">
                    <span class="express-number">${escapeHtml(item.trackingNumber)}</span>
                    <span class="express-status ${statusClass}">${statusText}</span>
                </div>
            `;
        });
    }
    
    container.innerHTML = html;
    bindItemEvents();
    updateUI();
}

function bindItemEvents() {
    document.querySelectorAll('.express-item').forEach(item => {
        item.addEventListener('touchstart', function(e) {
            hasMoved = false;
            if (!selectionMode) {
                longPressTimer = setTimeout(() => {
                    if (!hasMoved) {
                        selectionMode = true;
                        toggleSelect(item.dataset.id);
                    }
                }, 500);
            }
        }, { passive: true });
        
        item.addEventListener('touchmove', function(e) {
            if (Math.abs(e.touches[0].clientX - e.touches[0].clientX) > 10 || 
                Math.abs(e.touches[0].clientY - e.touches[0].clientY) > 10) {
                hasMoved = true;
                clearTimeout(longPressTimer);
            }
        }, { passive: true });
        
        item.addEventListener('touchend', function(e) {
            clearTimeout(longPressTimer);
            if (!hasMoved) {
                if (selectionMode) {
                    toggleSelect(item.dataset.id);
                } else if (longPressTimer !== null) {
                    showItemActionDialog(item.dataset.id);
                }
            }
            longPressTimer = null;
        });
    });
}

function formatDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateUI() {
    document.getElementById('btnSearch').style.display = (!selectionMode && !searchMode) ? '' : 'none';
    document.getElementById('btnExitSearch').style.display = searchMode ? '' : 'none';
    document.getElementById('btnSelectAll').style.display = selectionMode ? '' : 'none';
    document.getElementById('btnBatch').style.display = selectionMode ? '' : 'none';
    document.getElementById('btnExitSelect').style.display = selectionMode ? '' : 'none';
    
    if (searchMode) {
        document.getElementById('toolbarTitle').textContent = '搜索结果';
    } else if (selectionMode && selectedIds.size > 0) {
        document.getElementById('toolbarTitle').textContent = `已选择 ${selectedIds.size} 项`;
    } else {
        document.getElementById('toolbarTitle').textContent = '快递管理';
    }
    
    const bar = document.getElementById('selectionBar');
    if (selectionMode && selectedIds.size > 0) {
        bar.classList.add('show');
        document.getElementById('selectionCount').textContent = `已选 ${selectedIds.size} 项`;
    } else {
        bar.classList.remove('show');
    }
    
    const filtered = expressList.filter(e => {
        if (currentFilter === 'signed') return e.signed;
        if (currentFilter === 'unsigned') return !e.signed;
        return true;
    });
    document.getElementById('btnSelectAll').textContent = 
        (selectedIds.size === filtered.length && filtered.length > 0) ? '☑' : '☐';
}

// ==================== 选择操作 ====================
function toggleSelect(id) {
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
    render();
}

function toggleSelectAll() {
    const filtered = expressList.filter(e => {
        if (currentFilter === 'signed') return e.signed;
        if (currentFilter === 'unsigned') return !e.signed;
        return true;
    });
    selectedIds.size === filtered.length ? selectedIds.clear() : filtered.forEach(e => selectedIds.add(e.id));
    render();
}

function exitSelectionMode() {
    selectionMode = false;
    selectedIds.clear();
    render();
}

// ==================== 筛选 ====================
function switchFilter(filter) {
    if (searchMode) exitSearchMode();
    currentFilter = filter;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
    render();
}

// ==================== 添加 ====================
function showAddDialog() {
    document.getElementById('addModal').classList.add('show');
    document.getElementById('addInput').focus();
    navigator.clipboard?.readText().then(text => {
        if (text) document.getElementById('addInput').value = text;
    }).catch(() => {});
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

function pasteAndAdd() {
    navigator.clipboard?.readText().then(text => {
        if (text) document.getElementById('addInput').value = text;
    }).catch(() => showToast('无法访问剪贴板'));
}

function addExpress() {
    const text = document.getElementById('addInput').value.trim();
    if (!text) return;
    
    const numbers = parseTrackingNumbers(text);
    if (numbers.length === 0) {
        showToast('未识别到有效的快递单号');
        return;
    }
    
    let addedCount = 0;
    numbers.forEach(num => {
        if (!expressList.find(e => e.trackingNumber === num)) {
            expressList.push({
                id: generateId(),
                trackingNumber: num,
                createDate: Date.now(),
                signed: false
            });
            addedCount++;
        }
    });
    
    saveData(expressList);
    closeModal('addModal');
    document.getElementById('addInput').value = '';
    showToast(`成功添加 ${addedCount} 个快递单号`);
    render();
}

// ==================== 搜索 ====================
function showSearchDialog() {
    document.getElementById('searchModal').classList.add('show');
    document.getElementById('searchInput').focus();
}

function performSearch() {
    const text = document.getElementById('searchInput').value.trim();
    if (!text) return;
    
    const numbers = parseTrackingNumbers(text);
    if (numbers.length === 0) {
        showToast('请输入有效的快递单号');
        return;
    }
    
    searchMode = true;
    window.searchResults = expressList.filter(e => numbers.some(n => e.trackingNumber.includes(n)));
    
    closeModal('searchModal');
    document.getElementById('searchInput').value = '';
    render();
    showToast(`找到 ${window.searchResults.length} 条记录`);
}

function exitSearchMode() {
    searchMode = false;
    window.searchResults = null;
    render();
}

// ==================== 批量操作 ====================
function showBatchDialog() {
    if (selectedIds.size === 0) showToast('请先选择快递单号');
}

function toggleSelectedStatus(signed) {
    const ids = Array.from(selectedIds);
    expressList.forEach(e => { if (ids.includes(e.id)) e.signed = signed; });
    saveData(expressList);
    showToast(`已标记为${signed ? '已签收' : '未签收'}`);
    exitSelectionMode();
}

function deleteSelected() {
    if (selectedIds.size === 0) return;
    showDeleteConfirmBatch();
}

function copySelected() {
    if (selectedIds.size === 0) {
        showToast('请先选择快递单号');
        return;
    }
    const text = expressList.filter(e => selectedIds.has(e.id)).map(e => e.trackingNumber).join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showToast(`已复制 ${selectedIds.size} 个快递单号`);
    }).catch(() => showToast('复制失败'));
}

// ==================== 弹窗 ====================
function createOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:500;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    return overlay;
}

function showItemActionDialog(id) {
    const item = expressList.find(e => e.id === id);
    if (!item) return;
    
    const overlay = createOverlay();
    const actionText = item.signed ? '标记为未签收' : '标记为已签收';
    
    overlay.innerHTML = `
        <div style="background:white;border-radius:16px;padding:24px;width:85%;max-width:360px;">
            <div style="font-size:18px;font-weight:bold;margin-bottom:8px;text-align:center;word-break:break-all;">操作: ${escapeHtml(item.trackingNumber)}</div>
            <div style="text-align:center;color:#666;font-size:14px;margin-bottom:20px;">当前状态: ${item.signed ? '✅ 已签收' : '📦 未签收'}</div>
            <button class="dialog-btn-primary" id="btnToggle">${actionText}</button>
            <button class="dialog-btn-danger" id="btnDelete">删除此单号</button>
            <button class="dialog-btn-cancel" id="btnClose">取消</button>
        </div>
    `;
    
    overlay.querySelector('#btnToggle').onclick = () => {
        item.signed = !item.signed;
        saveData(expressList);
        showToast(item.signed ? '已标记为已签收' : '已标记为未签收');
        overlay.remove();
        render();
    };
    overlay.querySelector('#btnDelete').onclick = () => { overlay.remove(); showDeleteConfirm(id, item.trackingNumber); };
    overlay.querySelector('#btnClose').onclick = () => overlay.remove();
}

function showDeleteConfirm(id, trackingNumber) {
    const overlay = createOverlay();
    overlay.innerHTML = `
        <div style="background:white;border-radius:16px;padding:24px;width:85%;max-width:360px;text-align:center;">
            <div style="font-size:18px;font-weight:bold;margin-bottom:12px;">确认删除</div>
            <div style="font-size:15px;color:#666;margin-bottom:8px;">确定要删除快递单号</div>
            <div style="font-size:16px;font-weight:bold;color:#e53935;margin-bottom:20px;word-break:break-all;">${escapeHtml(trackingNumber)}</div>
            <div style="display:flex;gap:10px;">
                <button class="dialog-btn-cancel" id="btnCancel" style="flex:1;">取消</button>
                <button class="dialog-btn-danger" id="btnConfirm" style="flex:1;">删除</button>
            </div>
        </div>
    `;
    overlay.querySelector('#btnCancel').onclick = () => overlay.remove();
    overlay.querySelector('#btnConfirm').onclick = () => {
        expressList = expressList.filter(e => e.id !== id);
        saveData(expressList);
        showToast('已删除');
        overlay.remove();
        render();
    };
}

function showDeleteConfirmBatch() {
    const count = selectedIds.size;
    const overlay = createOverlay();
    overlay.innerHTML = `
        <div style="background:white;border-radius:16px;padding:24px;width:85%;max-width:360px;text-align:center;">
            <div style="font-size:18px;font-weight:bold;margin-bottom:12px;">确认删除</div>
            <div style="font-size:15px;color:#666;margin-bottom:20px;">确定要删除 ${count} 个快递单号吗？</div>
            <div style="display:flex;gap:10px;">
                <button class="dialog-btn-cancel" id="btnCancel" style="flex:1;">取消</button>
                <button class="dialog-btn-danger" id="btnConfirm" style="flex:1;">删除</button>
            </div>
        </div>
    `;
    overlay.querySelector('#btnCancel').onclick = () => overlay.remove();
    overlay.querySelector('#btnConfirm').onclick = () => {
        const ids = Array.from(selectedIds);
        expressList = expressList.filter(e => !ids.includes(e.id));
        saveData(expressList);
        showToast(`已删除 ${count} 个快递单号`);
        overlay.remove();
        exitSelectionMode();
    };
}

// ==================== 扫码 ====================
function loadScannerLibrary(callback) {
    if (scannerLibraryLoaded && window.Html5Qrcode) { callback(); return; }
    if (scannerLibraryLoading) { scannerLibraryCallbacks.push(callback); return; }
    
    scannerLibraryLoading = true;
    scannerLibraryCallbacks.push(callback);
    
    const script = document.createElement('script');
    script.src = 'html5-qrcode.min.js';
    script.onload = () => {
        scannerLibraryLoaded = true;
        scannerLibraryLoading = false;
        scannerLibraryCallbacks.forEach(cb => cb());
        scannerLibraryCallbacks = [];
    };
    script.onerror = () => {
        scannerLibraryLoading = false;
        scannerLibraryCallbacks = [];
        showToast('扫码库加载失败');
    };
    document.head.appendChild(script);
}

function startScan() {
    loadScannerLibrary(() => {
        let container = document.getElementById('scannerContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'scannerContainer';
            container.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);z-index:600;display:none;flex-direction:column;align-items:center;justify-content:center;';
            container.innerHTML = `
                <div style="color:white;font-size:18px;margin-bottom:12px;">将快递单号条码置于框内</div>
                <div id="reader" style="width:100%;max-width:400px;"></div>
                <button id="btnCloseScanner" style="margin-top:16px;padding:12px 40px;border-radius:25px;border:2px solid white;background:transparent;color:white;font-size:16px;cursor:pointer;">关闭扫码</button>
            `;
            document.body.appendChild(container);
            document.getElementById('btnCloseScanner').onclick = stopScan;
        }
        container.style.display = 'flex';
        
        if (html5QrCode) {
            html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
        }
        
        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 30,
                qrbox: { width: 300, height: 100 },
                aspectRatio: 3.0,
                disableFlip: true,
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.UPC_A,
                    Html5QrcodeSupportedFormats.UPC_E,
                    Html5QrcodeSupportedFormats.ITF,
                    Html5QrcodeSupportedFormats.QR_CODE,
                ]
            },
            (decodedText) => {
                if (!scannerActive) return;
                scannerActive = false;
                if (navigator.vibrate) navigator.vibrate(200);
                const num = (decodedText.match(/[A-Za-z0-9]{8,30}/) || [decodedText])[0];
                stopScan();
                setTimeout(() => showScanResult(num), 100);
            },
            () => {}
        ).catch(err => {
            showToast('无法打开摄像头: ' + err.message);
            stopScan();
        });
        scannerActive = true;
    });
}

function stopScan() {
    scannerActive = false;
    if (html5QrCode) {
        html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
        html5QrCode = null;
    }
    const container = document.getElementById('scannerContainer');
    if (container) container.style.display = 'none';
}

function showScanResult(trackingNumber) {
    const exists = expressList.find(e => e.trackingNumber === trackingNumber);
    const overlay = createOverlay();
    overlay.style.zIndex = '700';
    overlay.innerHTML = `
        <div style="background:white;border-radius:16px;padding:24px;width:90%;max-width:360px;text-align:center;">
            <div style="font-size:18px;font-weight:bold;margin-bottom:16px;">扫码结果</div>
            <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin-bottom:16px;">
                <div style="font-size:22px;font-weight:bold;color:#333;word-break:break-all;">${escapeHtml(trackingNumber)}</div>
                <div style="font-size:14px;color:${exists ? '#2e7d32' : '#1976D2'};margin-top:8px;">${exists ? '✅ 该单号已存在' : '🆕 新单号'}</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="dialog-btn-cancel" id="btnAddScan" style="flex:1;">录入此单号</button>
                <button class="dialog-btn-primary" id="btnSearchScan" style="flex:1;">搜索此单号</button>
            </div>
            <button class="dialog-btn-cancel" id="btnCloseScan" style="width:100%;margin-top:12px;">关闭</button>
        </div>
    `;
    overlay.querySelector('#btnAddScan').onclick = () => {
        if (!expressList.find(e => e.trackingNumber === trackingNumber)) {
            expressList.push({ id: generateId(), trackingNumber, createDate: Date.now(), signed: false });
            saveData(expressList);
            showToast(`已录入: ${trackingNumber}`);
        } else {
            showToast('该单号已存在');
        }
        overlay.remove();
        render();
    };
    overlay.querySelector('#btnSearchScan').onclick = () => {
        overlay.remove();
        searchMode = true;
        window.searchResults = expressList.filter(e => e.trackingNumber.includes(trackingNumber));
        render();
        showToast(`找到 ${window.searchResults.length} 条记录`);
    };
    overlay.querySelector('#btnCloseScan').onclick = () => overlay.remove();
}

// ==================== 工具函数 ====================
function parseTrackingNumbers(text) {
    return text
        .replace(/拦截一下|拦截|退回/g, '')
        .split(/[\n\r、,，\s]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && /^[A-Za-z0-9]+$/.test(s));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

// ==================== 初始化 ====================
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.classList.remove('show');
    });
});

render();

// 预加载扫码库
setTimeout(() => loadScannerLibrary(() => {}), 1000);