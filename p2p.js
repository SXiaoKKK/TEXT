// ==================== P2P 实时同步 ====================

// 使用 PeerJS 官方免费信令服务器（0.peerjs.com）
const PEER_CONFIG = {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    debug: 0
};

class P2PManager {
    constructor() {
        this.peer = null;
        this.connections = {};
        this.roomId = null;
        this.isHost = false;
        this.onDataReceived = null;
        this.onSendAllData = null;
        this.onStatusChange = null;
        this.onRoomCreated = null;  // 新增：房间创建成功回调
        this.reconnectTimer = null;
    }

    // 创建房间（设备A）
    async createRoom() {
        this.isHost = true;
        this.roomId = generateRoomId();
        
        try {
            await this.initPeer();
            
            // 监听连接请求
            this.peer.on('connection', (conn) => {
                this.handleConnection(conn);
            });
            
            this.updateStatus('等待设备加入...');
            
            // 回调通知房间创建成功
            if (this.onRoomCreated) {
                this.onRoomCreated(this.roomId);
            }
            
            return this.roomId;
        } catch (err) {
            console.error('创建房间失败:', err);
            this.updateStatus('创建失败: ' + err.message);
            throw err;
        }
    }

    // 加入房间（设备B）
    async joinRoom(roomId) {
        this.isHost = false;
        this.roomId = roomId;
        
        try {
            await this.initPeer();
            
            this.updateStatus('正在连接房间 ' + roomId + '...');
            
            // 连接到主机
            const conn = this.peer.connect(roomId, { 
                reliable: true,
                serialization: 'json'
            });
            
            conn.on('open', () => {
                console.log('已连接到主机');
                this.connections[conn.peer] = conn;
                this.updateStatus('已连接 ✅');
            });
            
            conn.on('data', (data) => {
                if (this.onDataReceived) {
                    this.onDataReceived(data);
                }
            });
            
            conn.on('close', () => {
                delete this.connections[conn.peer];
                this.updateStatus('连接断开');
                this.scheduleReconnect(roomId);
            });
            
            conn.on('error', (err) => {
                console.error('连接错误:', err);
                this.updateStatus('连接失败，请检查房间码');
            });
            
            return true;
        } catch (err) {
            console.error('加入房间失败:', err);
            this.updateStatus('加入失败: ' + err.message);
            throw err;
        }
    }

    // 初始化 Peer
    async initPeer() {
        return new Promise((resolve, reject) => {
            const peerId = this.isHost ? this.roomId : generateId();
            
            this.peer = new Peer(peerId, PEER_CONFIG);

            this.peer.on('open', (id) => {
                console.log('Peer 已连接, ID:', id);
                resolve();
            });

            this.peer.on('error', (err) => {
                console.error('Peer 错误:', err);
                if (err.type === 'peer-unavailable') {
                    reject(new Error('房间不存在或主机已离线'));
                } else if (err.type === 'network') {
                    reject(new Error('网络连接失败，请检查网络'));
                } else if (err.type === 'server-error') {
                    reject(new Error('信令服务器错误，请稍后重试'));
                } else {
                    reject(new Error(err.message || '连接失败'));
                }
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
            console.log('新设备已连接');
            this.connections[conn.peer] = conn;
            this.updateStatus('已连接 ✅ (共 ' + Object.keys(this.connections).length + ' 台设备)');
            
            // 主机发送当前数据给新设备
            if (this.isHost && this.onSendAllData) {
                const allData = this.onSendAllData();
                conn.send({
                    type: 'sync-all',
                    data: allData
                });
                console.log('已发送全量数据:', allData.length, '条');
            }
        });

        conn.on('data', (raw) => {
            if (this.onDataReceived) {
                this.onDataReceived(raw);
            }
        });

        conn.on('close', () => {
            delete this.connections[conn.peer];
            const count = Object.keys(this.connections).length;
            this.updateStatus(count > 0 ? `已连接 ✅ (共 ${count} 台设备)` : '等待设备加入...');
        });

        conn.on('error', (err) => {
            console.error('连接错误:', err);
        });
    }

    // 广播消息给所有连接
    broadcast(msg) {
        Object.values(this.connections).forEach(conn => {
            if (conn.open) {
                conn.send(msg);
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
    scheduleReconnect(roomId) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(async () => {
            if (this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            } else if (roomId) {
                try {
                    await this.joinRoom(roomId);
                } catch (e) {
                    console.error('重连失败:', e);
                }
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
