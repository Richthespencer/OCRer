const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let tray;
let pythonProcess;
let lastTimestamp = 0;

const API_BASE = 'http://127.0.0.1:51234';
const WINDOW_CONTROL_PORT = 51235;

function isBackendRunning(callback) {
    http.get(`${API_BASE}/api/health`, (res) => {
        callback(res.statusCode === 200);
    }).on('error', () => {
        callback(false);
    });
}

function getPythonBackendPath() {
    // 开发模式
    if (app.isPackaged === false) {
        return path.join(__dirname, '..', 'python-backend', 'main.py');
    }
    // 打包后的模式
    return path.join(process.resourcesPath, 'ocrer-backend', 'ocrer-backend');
}

function startPythonBackend() {
    isBackendRunning((running) => {
        if (running) {
            console.log('Python backend already running');
            return;
        }

        const backendPath = getPythonBackendPath();
        console.log(`Starting backend from: ${backendPath}`);

        if (app.isPackaged === false) {
            // 开发模式：使用python3运行
            pythonProcess = spawn('python3', [backendPath], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } else {
            // 打包模式：直接运行可执行文件
            pythonProcess = spawn(backendPath, [], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
        }

        pythonProcess.stdout.on('data', (data) => {
            console.log(`Python stdout: ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.log(`Python stderr: ${data}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
        });
    });
}

function waitForBackend(callback, retries = 20) {
    const check = (attempt) => {
        http.get(`${API_BASE}/api/health`, (res) => {
            if (res.statusCode === 200) {
                callback();
            } else if (attempt < retries) {
                setTimeout(() => check(attempt + 1), 500);
            }
        }).on('error', () => {
            if (attempt < retries) {
                setTimeout(() => check(attempt + 1), 500);
            }
        });
    };
    check(0);
}

function convertShortcutForElectron(shortcut) {
    // 将 cmd+shift+o 转换为 CommandOrControl+Shift+O
    const parts = shortcut.toLowerCase().split('+').map(s => s.trim());
    const result = [];
    
    for (const part of parts) {
        if (part === 'cmd' || part === 'command') {
            result.push('CommandOrControl');
        } else if (part === 'ctrl' || part === 'control') {
            result.push('CommandOrControl');
        } else if (part === 'alt' || part === 'option') {
            result.push('Alt');
        } else if (part === 'shift') {
            result.push('Shift');
        } else if (part.length === 1) {
            result.push(part.toUpperCase());
        } else {
            result.push(part);
        }
    }
    
    return result.join('+');
}

function registerGlobalShortcut() {
    // 先注销所有快捷键
    globalShortcut.unregisterAll();
    
    // 获取配置的快捷键
    http.get(`${API_BASE}/api/config`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const config = JSON.parse(data);
                const shortcut = config.shortcut_key || 'cmd+shift+o';
                const electronShortcut = convertShortcutForElectron(shortcut);
                
                console.log(`Registering shortcut: ${electronShortcut}`);
                
                const ret = globalShortcut.register(electronShortcut, () => {
                    console.log('Shortcut triggered');
                    // 触发截图OCR
                    triggerShortcutOCR();
                });
                
                if (ret) {
                    console.log('Shortcut registered successfully');
                } else {
                    console.log('Shortcut registration failed');
                }
            } catch (e) {
                console.error('Failed to register shortcut:', e);
            }
        });
    }).on('error', (err) => {
        console.error('Failed to get config for shortcut:', err);
    });
}

function triggerShortcutOCR() {
    // 通知前端触发截图
    if (mainWindow) {
        mainWindow.webContents.send('trigger-capture');
    }
}

function startWindowControlServer() {
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/hide') {
            if (mainWindow) {
                mainWindow.hide();
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else if (req.method === 'POST' && req.url === '/show') {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
                // 通知前端截图已完成，开始识别
                mainWindow.webContents.send('screenshot-done');
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else if (req.method === 'GET' && req.url === '/status') {
            let status = 'hidden';
            if (mainWindow) {
                if (mainWindow.isMinimized()) {
                    status = 'minimized';
                } else if (mainWindow.isVisible()) {
                    status = 'visible';
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(WINDOW_CONTROL_PORT, '127.0.0.1', () => {
        console.log(`Window control server running on port ${WINDOW_CONTROL_PORT}`);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, 'icon.png'),
        title: 'OCRer 设置'
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    const icon = nativeImage.createFromNamedImage('NSActionTemplate', [0, 0, 1]);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示设置',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                } else {
                    createWindow();
                }
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                if (pythonProcess) {
                    pythonProcess.kill();
                }
                app.quit();
            }
        }
    ]);

    tray.setToolTip('OCRer');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
        }
    });
}

app.whenReady().then(() => {
    startPythonBackend();
    startWindowControlServer();

    waitForBackend(() => {
        createWindow();
        createTray();
        startPolling();
        registerGlobalShortcut();
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
});

ipcMain.handle('get-config', async () => {
    return new Promise((resolve, reject) => {
        http.get(`${API_BASE}/api/config`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
});

ipcMain.handle('update-config', async (event, config) => {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(config);
        const options = {
            hostname: '127.0.0.1',
            port: 51234,
            path: '/api/config',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                // 配置更新后重新注册快捷键
                registerGlobalShortcut();
                resolve(JSON.parse(body));
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
});

ipcMain.handle('test-ocr', async () => {
    // 按钮截图：隐藏窗口
    if (mainWindow) {
        mainWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: 51234,
            path: '/api/test-ocr',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(data));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });
        
        req.write(JSON.stringify({}));
        req.end();
    });
});

ipcMain.handle('cancel-ocr', async () => {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: 51234,
            path: '/api/cancel-ocr',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // 确保窗口显示
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(data));
                }
            });
        });

        req.on('error', (err) => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
            reject(err);
        });
        req.write(JSON.stringify({}));
        req.end();
    });
});

ipcMain.handle('get-history', async () => {
    return new Promise((resolve, reject) => {
        http.get(`${API_BASE}/api/history`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
});

ipcMain.handle('delete-history', async (event, entryId) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 51234,
            path: `/api/history/${entryId}`,
            method: 'DELETE'
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.end();
    });
});

ipcMain.handle('clear-history', async () => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 51234,
            path: '/api/history',
            method: 'DELETE'
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.end();
    });
});

function startPolling() {
    let lastProcessing = false;

    setInterval(() => {
        http.get(`${API_BASE}/api/latest-result`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);

                    // 检测 processing 状态变化
                    if (result.processing !== lastProcessing) {
                        lastProcessing = result.processing;
                        if (mainWindow) {
                            mainWindow.webContents.send('ocr-processing', result.processing);
                        }
                    }

                    // 检测新结果
                    if (result.timestamp > lastTimestamp && result.text) {
                        lastTimestamp = result.timestamp;
                        if (mainWindow) {
                            mainWindow.webContents.send('ocr-result', result.text);
                        }
                    }
                } catch (e) {
                    // ignore parse errors
                }
            });
        }).on('error', () => {
            // ignore connection errors
        });
    }, 500);
}
