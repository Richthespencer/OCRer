const api = window.electronAPI;

const elements = {
    // 主页面
    output: document.getElementById('output'),
    outputRendered: document.getElementById('output-rendered'),
    status: document.getElementById('status'),
    autoCopy: document.getElementById('auto_copy'),
    captureBtn: document.getElementById('capture-btn'),
    clearBtn: document.getElementById('clear-btn'),
    copyBtn: document.getElementById('copy-btn'),
    toggleRender: document.getElementById('toggle-render'),
    historyBtn: document.getElementById('history-btn'),
    settingsBtn: document.getElementById('settings-btn'),

    // 历史记录页面
    historyList: document.getElementById('history-list'),
    historyBackBtn: document.getElementById('history-back-btn'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),

    // 设置页面
    ocrProvider: document.getElementById('ocr_provider'),
    siliconflowConfig: document.getElementById('siliconflow-config'),
    paddleocrConfig: document.getElementById('paddleocr-config'),
    apiKey: document.getElementById('api_key'),
    apiBaseUrl: document.getElementById('api_base_url'),
    model: document.getElementById('model'),
    paddleocrApiUrl: document.getElementById('paddleocr_api_url'),
    paddleocrToken: document.getElementById('paddleocr_token'),
    paddleocrModel: document.getElementById('paddleocr_model'),
    shortcutKey: document.getElementById('shortcut_key'),
    showNotification: document.getElementById('show_notification'),
    ocrPrompt: document.getElementById('ocr_prompt'),
    saveBtn: document.getElementById('save-btn'),
    testBtn: document.getElementById('test-btn'),
    backBtn: document.getElementById('back-btn'),
    toggleKey: document.getElementById('toggle-key'),
    togglePaddleToken: document.getElementById('toggle-paddle-token'),
    recordShortcut: document.getElementById('record-shortcut')
};

let isRecording = false;
let recordedKeys = new Set();
let isRendered = true;
let rawText = '';

// 配置marked支持LaTeX
if (typeof marked !== 'undefined' && typeof katex !== 'undefined') {
    const inlineLatexExtension = {
        name: 'inlineLatex',
        level: 'inline',
        start(src) { return src.indexOf('$'); },
        tokenizer(src) {
            const match = src.match(/^\$([^\$\n]+?)\$/);
            if (match) {
                return {
                    type: 'inlineLatex',
                    raw: match[0],
                    text: match[1]
                };
            }
        },
        renderer(token) {
            try {
                return katex.renderToString(token.text, { throwOnError: false });
            } catch (e) {
                return token.raw;
            }
        }
    };

    const blockLatexExtension = {
        name: 'blockLatex',
        level: 'block',
        start(src) { return src.indexOf('$$'); },
        tokenizer(src) {
            const match = src.match(/^\$\$([\s\S]+?)\$\$/);
            if (match) {
                return {
                    type: 'blockLatex',
                    raw: match[0],
                    text: match[1].trim()
                };
            }
        },
        renderer(token) {
            try {
                return `<div class="katex-display">${katex.renderToString(token.text, { throwOnError: false, displayMode: true })}</div>`;
            } catch (e) {
                return `<pre>$$${token.text}$$</pre>`;
            }
        }
    };

    marked.use({ extensions: [inlineLatexExtension, blockLatexExtension] });
}

// 页面切换
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId).classList.add('active');
}

// 加载配置
async function loadConfig() {
    try {
        const config = await api.getConfig();

        // 主页面设置
        elements.autoCopy.checked = config.auto_copy_to_clipboard !== false;

        // 设置页面
        elements.ocrProvider.value = config.ocr_provider || 'paddleocr';
        elements.apiKey.value = config.api_key || '';
        elements.apiBaseUrl.value = config.api_base_url || 'https://api.siliconflow.cn/v1';
        elements.model.value = config.model || 'deepseek-ai/DeepSeek-OCR';
        elements.paddleocrApiUrl.value = config.paddleocr_api_url || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
        elements.paddleocrToken.value = config.paddleocr_token || '';
        elements.paddleocrModel.value = config.paddleocr_model || 'PaddleOCR-VL-1.6';
        elements.shortcutKey.value = config.shortcut_key || 'cmd+shift+o';
        elements.showNotification.checked = config.show_notification !== false;
        elements.ocrPrompt.value = config.ocr_prompt || 'Convert the document to markdown format. Preserve mathematical formulas in LaTeX notation using $ for inline and $$ for block formulas. Do not include bounding boxes or layout annotations.';

        toggleProviderConfig();
    } catch (err) {
        showStatus('加载配置失败: ' + err.message, 'error');
    }
}

// 切换OCR服务配置显示
function toggleProviderConfig() {
    const provider = elements.ocrProvider.value;
    if (provider === 'paddleocr') {
        elements.siliconflowConfig.classList.add('hidden');
        elements.paddleocrConfig.classList.remove('hidden');
    } else {
        elements.siliconflowConfig.classList.remove('hidden');
        elements.paddleocrConfig.classList.add('hidden');
    }
}

// 保存配置
async function saveConfig() {
    const config = {
        ocr_provider: elements.ocrProvider.value,
        api_key: elements.apiKey.value,
        api_base_url: elements.apiBaseUrl.value,
        model: elements.model.value,
        paddleocr_api_url: elements.paddleocrApiUrl.value,
        paddleocr_token: elements.paddleocrToken.value,
        paddleocr_model: elements.paddleocrModel.value,
        shortcut_key: elements.shortcutKey.value,
        auto_copy_to_clipboard: elements.autoCopy.checked,
        show_notification: elements.showNotification.checked,
        ocr_prompt: elements.ocrPrompt.value
    };

    try {
        await api.updateConfig(config);
        showStatus('设置已保存', 'success');
    } catch (err) {
        showStatus('保存失败: ' + err.message, 'error');
    }
}

// 更新自动复制设置
async function updateAutoCopy() {
    try {
        await api.updateConfig({ auto_copy_to_clipboard: elements.autoCopy.checked });
    } catch (err) {
        console.error('Failed to update auto copy:', err);
    }
}

// 测试OCR（设置页面）
async function testOCR() {
    elements.testBtn.disabled = true;
    elements.testBtn.textContent = '识别中...';
    showStatus('请框选要识别的区域...', 'info');

    try {
        const result = await api.testOCR();

        if (result.success) {
            showPage('main-page');
            setOutputText(result.text);
            showStatus('识别完成，结果已复制到剪贴板', 'success');
        } else {
            showStatus(result.message || '测试失败', 'error');
        }
    } catch (err) {
        showStatus('测试失败: ' + err.message, 'error');
    } finally {
        elements.testBtn.disabled = false;
        elements.testBtn.textContent = '测试 OCR';
    }
}

// 截图OCR（主页）
async function captureOCR() {
    elements.captureBtn.disabled = true;
    elements.captureBtn.textContent = '截图中...';
    showStatus('请框选要识别的区域...', 'info');

    try {
        const result = await api.testOCR();

        if (result.success) {
            setOutputText(result.text);
            showStatus('识别完成，结果已复制到剪贴板', 'success');
        } else if (result.message === '截图已取消') {
            showStatus('截图已取消', '');
        } else {
            showStatus(result.message || '识别失败', 'error');
        }
    } catch (err) {
        showStatus('识别失败: ' + err.message, 'error');
    } finally {
        elements.captureBtn.disabled = false;
        elements.captureBtn.textContent = '开始截图';
    }
}

// 显示状态
function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `status ${type || ''}`;
}

// 清空输出
function clearOutput() {
    rawText = '';
    elements.output.value = '';
    elements.outputRendered.innerHTML = '';
    showStatus('就绪', '');
}

// 设置输出文本
function setOutputText(text) {
    rawText = text;
    elements.output.value = text;

    if (isRendered && typeof marked !== 'undefined') {
        elements.outputRendered.innerHTML = marked.parse(text);
    } else if (isRendered) {
        elements.outputRendered.textContent = text;
    }
}

// 切换渲染/源码
function toggleRender() {
    isRendered = !isRendered;

    if (isRendered) {
        elements.output.classList.add('hidden');
        elements.outputRendered.classList.remove('hidden');
        elements.toggleRender.textContent = '源码';

        if (rawText && typeof marked !== 'undefined') {
            elements.outputRendered.innerHTML = marked.parse(rawText);
        }
    } else {
        elements.output.classList.remove('hidden');
        elements.outputRendered.classList.add('hidden');
        elements.toggleRender.textContent = '渲染';
    }
}

// 复制到剪贴板
function copyToClipboard() {
    const text = rawText || elements.output.value;
    if (!text) {
        showStatus('没有内容可复制', 'info');
        return;
    }

    navigator.clipboard.writeText(text).then(() => {
        showStatus('已复制到剪贴板', 'success');
    }).catch(err => {
        showStatus('复制失败: ' + err.message, 'error');
    });
}

// 加载历史记录
async function loadHistory() {
    try {
        const history = await api.getHistory();

        if (history.length === 0) {
            elements.historyList.innerHTML = '<p class="empty-text">暂无历史记录</p>';
            return;
        }

        elements.historyList.innerHTML = history.map(item => {
            const time = new Date(item.timestamp).toLocaleString('zh-CN');
            const preview = item.text.length > 100 ? item.text.substring(0, 100) + '...' : item.text;

            return `
                <div class="history-item" data-id="${item.id}" data-text="${escapeHtml(item.text)}">
                    <div class="history-item-header">
                        <span class="history-item-time">${time}</span>
                        <span class="history-item-provider">${item.provider}</span>
                    </div>
                    <div class="history-item-preview">${escapeHtml(preview)}</div>
                    <div class="history-item-actions">
                        <button class="btn-small copy-history-btn">复制</button>
                        <button class="btn-small delete-history-btn">删除</button>
                    </div>
                </div>
            `;
        }).join('');

        elements.historyList.querySelectorAll('.copy-history-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.history-item');
                const text = item.dataset.text;
                navigator.clipboard.writeText(text).then(() => {
                    showStatus('已复制到剪贴板', 'success');
                });
            });
        });

        elements.historyList.querySelectorAll('.delete-history-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = e.target.closest('.history-item');
                const id = parseInt(item.dataset.id);
                await api.deleteHistory(id);
                loadHistory();
            });
        });

        elements.historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const text = item.dataset.text;
                showPage('main-page');
                setOutputText(text);
            });
        });
    } catch (err) {
        elements.historyList.innerHTML = '<p class="empty-text">加载失败</p>';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 清空历史记录
async function clearHistory() {
    if (confirm('确定要清空所有历史记录吗？')) {
        await api.clearHistory();
        loadHistory();
    }
}

// 快捷键录制
function toggleKeyVisibility(inputEl, btnEl) {
    if (inputEl.type === 'password') {
        inputEl.type = 'text';
        btnEl.textContent = '隐藏';
    } else {
        inputEl.type = 'password';
        btnEl.textContent = '显示';
    }
}

function startRecording() {
    isRecording = true;
    recordedKeys.clear();
    elements.shortcutKey.value = '请按下快捷键...';
    elements.recordShortcut.textContent = '停止';
    elements.shortcutKey.style.background = '#fff3cd';
}

function stopRecording() {
    isRecording = false;
    elements.recordShortcut.textContent = '录制';
    elements.shortcutKey.style.background = '';

    if (recordedKeys.size > 0) {
        const parts = [];
        if (recordedKeys.has('Meta')) parts.push('cmd');
        if (recordedKeys.has('Control')) parts.push('ctrl');
        if (recordedKeys.has('Alt')) parts.push('alt');
        if (recordedKeys.has('Shift')) parts.push('shift');

        for (const key of recordedKeys) {
            if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
                parts.push(key.toLowerCase());
            }
        }

        elements.shortcutKey.value = parts.join('+');
    }
}

// 事件监听
document.addEventListener('keydown', (e) => {
    if (!isRecording) return;

    e.preventDefault();

    let key = e.key;
    if (key === 'Meta') key = 'Meta';
    else if (key === 'Control') key = 'Control';
    else if (key === 'Alt') key = 'Alt';
    else if (key === 'Shift') key = 'Shift';
    else if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();

    recordedKeys.add(key);

    const display = [];
    if (recordedKeys.has('Meta')) display.push('⌘');
    if (recordedKeys.has('Control')) display.push('⌃');
    if (recordedKeys.has('Alt')) display.push('⌥');
    if (recordedKeys.has('Shift')) display.push('⇧');

    for (const k of recordedKeys) {
        if (!['Meta', 'Control', 'Alt', 'Shift'].includes(k)) {
            display.push(k);
        }
    }

    elements.shortcutKey.value = display.join(' + ');
});

document.addEventListener('keyup', (e) => {
    if (!isRecording) return;
    if (recordedKeys.size >= 2) {
        const hasModifier = ['Meta', 'Control', 'Alt'].some(k => recordedKeys.has(k));
        const hasKey = [...recordedKeys].some(k => !['Meta', 'Control', 'Alt', 'Shift'].includes(k));

        if (hasModifier && hasKey) {
            stopRecording();
        }
    }
});

// 主页面事件
elements.captureBtn.addEventListener('click', captureOCR);
elements.clearBtn.addEventListener('click', clearOutput);
elements.copyBtn.addEventListener('click', copyToClipboard);
elements.toggleRender.addEventListener('click', toggleRender);
elements.historyBtn.addEventListener('click', () => {
    loadHistory();
    showPage('history-page');
});
elements.settingsBtn.addEventListener('click', () => showPage('settings-page'));
elements.autoCopy.addEventListener('change', updateAutoCopy);

// 历史记录页面事件
elements.historyBackBtn.addEventListener('click', () => showPage('main-page'));
elements.clearHistoryBtn.addEventListener('click', clearHistory);

// 设置页面事件
elements.backBtn.addEventListener('click', () => showPage('main-page'));
elements.saveBtn.addEventListener('click', saveConfig);
elements.testBtn.addEventListener('click', testOCR);
elements.toggleKey.addEventListener('click', () => toggleKeyVisibility(elements.apiKey, elements.toggleKey));
elements.togglePaddleToken.addEventListener('click', () => toggleKeyVisibility(elements.paddleocrToken, elements.togglePaddleToken));
elements.recordShortcut.addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});
elements.ocrProvider.addEventListener('change', toggleProviderConfig);

// 初始化
loadConfig();

// 默认显示渲染视图
elements.output.classList.add('hidden');
elements.outputRendered.classList.remove('hidden');
elements.toggleRender.textContent = '源码';

// 监听快捷键触发的OCR处理状态
api.onOCRProcessing((processing) => {
    if (processing) {
        showStatus('截图识别中...', 'processing');
    }
});

// 监听截图完成事件
api.onScreenshotDone(() => {
    showStatus('识别中...', 'processing');
});

// 监听快捷键触发的OCR结果
api.onOCRResult((text) => {
    setOutputText(text);
    showStatus('识别完成，结果已复制到剪贴板', 'success');
});
