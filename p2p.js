// ==================== P2P 实时同步 ====================

// 免费信令服务器
const SIGNAL_SERVER = 'wss://free.zxq.co:443';

class P2PManager {
    constructor() {
        this.peer = null;
        this.connections = {};
        this.roomId = null;
        this.isHost = false;
        this.onDataReceived = null;
        this.onStatusChange = null;
        this.reconnectTimer = null;
    }

    // 创建房间（设备A）
    async createRoom() {
        this.isHost = true;
        this.roomId = generateRoomId();
        await this.initPeer();
        
        // 监听连接请求
        this.peer.on('connection', (conn) => {
            this.handleConnection(conn);
        });
        
        this.updateStatus(`房间已创建: ${this.roomId}`);
        return this.roomId;
    }

    // 加入房间（设备B）
    async joinRoom(roomId) {
        this.isHost = false;
        this.roomId = roomId;
        await this.initPeer();
        
        // 连接到主机
        const conn = this.peer.connect(roomId, { reliable: true });
        this.handleConnection(conn);
        
        this.updateStatus('正在连接...');
    }

    // 初始化 Peer
    async initPeer() {
        return new Promise((resolve, reject) => {
            const peerId = this.isHost ? this.roomId : generateId();
            
            this.peer = new Peer(peerId, {
                host: 'free.zxq.co',
                port: 443,
                secure: true,
                debug: 0
            });

            this.peer.on('open', (id) => {
                console.log('Peer 已连接, ID:', id);
                if (this.isHost) this.updateStatus(`房间: ${this.roomId}`);
                resolve();
            });

            this.peer.on('error', (err) => {
                console.error('Peer 错误:', err);
                this.updateStatus('连接失败，请重试');
                reject(err);
            });

            this.peer.on('disconnected', () => {
                this.updateStatus('连接断开，尝试重连...');
                this.scheduleReconnect();
            });
        });
    }

    // 处理连接
    handleConnection(conn) {
        conn.on('open', () => {
            console.log('设备已连接');
            this.connections[conn.peer] = conn;
            this.updateStatus('已连接 ✅');
            
            // 如果是主机，发送当前数据给新设备
            if (this.isHost && this.onSendAllData) {
                conn.send(JSON.stringify({
                    type: 'sync-all',
                    data: this.onSendAllData()
                }));
            }
        });

        conn.on('data', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (this.onDataReceived) {
                    this.onDataReceived(msg);
                }
            } catch (e) {
                console.error('解析消息失败:', e);
            }
        });

        conn.on('close', () => {
            delete this.connections[conn.peer];
            this.updateStatus('设备已断开');
        });

        conn.on('error', (err) => {
            console.error('连接错误:', err);
        });
    }

    // 广播消息给所有连接
    broadcast(msg) {
        Object.values(this.connections).forEach(conn => {
            if (conn.open) {
                conn.send(JSON.stringify(msg));
            }
        });
    }

    // 离开房间
    leaveRoom() {
        clearTimeout(this.reconnectTimer);
        Object.values(this.connections).forEach(conn => conn.close());
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connections = {};
        this.roomId = null;
        this.isHost = false;
    }

    // 重连
    scheduleReconnect() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(async () => {
            if (this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            }
        }, 3000);
    }

    updateStatus(msg) {
        this.status = msg;
        if (this.onStatusChange) this.onStatusChange(msg);
    }
}

// 生成6位数字房间码
function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 生成唯一ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// 全局实例
const p2p = new P2PManager();