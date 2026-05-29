#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "启动 OCRer..."

echo "安装 Python 依赖..."
cd "$SCRIPT_DIR/python-backend"
pip3 install -r requirements.txt -q

echo "启动 Python 后端服务..."
python3 main.py &
PYTHON_PID=$!

sleep 2

echo "启动 Electron 界面..."
cd "$SCRIPT_DIR/electron-frontend"
if [ ! -d "node_modules" ]; then
    echo "安装 Node.js 依赖..."
    npm install
fi
npm start

kill $PYTHON_PID 2>/dev/null
echo "OCRer 已退出"
