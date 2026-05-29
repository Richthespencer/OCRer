import json
import os
import sys
from pathlib import Path
from typing import Optional

DEFAULT_CONFIG = {
    "ocr_provider": "paddleocr",
    "api_key": "",
    "model": "deepseek-ai/DeepSeek-OCR",
    "shortcut_key": "cmd+shift+o",
    "auto_copy_to_clipboard": True,
    "show_notification": True,
    "api_base_url": "https://api.siliconflow.cn/v1",
    "ocr_prompt": "Convert the document to markdown format. Preserve mathematical formulas in LaTeX notation using $ for inline and $$ for block formulas. Do not include bounding boxes or layout annotations.",
    "paddleocr_api_url": "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
    "paddleocr_token": "",
    "paddleocr_model": "PaddleOCR-VL-1.6",
    "port": 51234
}

def get_config_dir():
    """获取配置文件目录，打包后使用用户目录"""
    if getattr(sys, 'frozen', False):
        # 打包后的可执行文件
        if sys.platform == 'darwin':
            config_dir = Path.home() / "Library" / "Application Support" / "ocrer"
        elif sys.platform == 'win32':
            config_dir = Path(os.environ.get('APPDATA', '')) / "ocrer"
        else:
            config_dir = Path.home() / ".config" / "ocrer"
    else:
        # 开发模式
        config_dir = Path(__file__).parent.parent
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


class ConfigManager:
    def __init__(self, config_path: Optional[str] = None):
        if config_path is None:
            config_path = get_config_dir() / "config.json"
        self.config_path = Path(config_path)
        self._config = self._load_config()

    def _load_config(self) -> dict:
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    config = DEFAULT_CONFIG.copy()
                    config.update(saved)
                    return config
            except (json.JSONDecodeError, IOError):
                return DEFAULT_CONFIG.copy()
        return DEFAULT_CONFIG.copy()

    def _save_config(self):
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(self._config, f, indent=2, ensure_ascii=False)

    def get(self, key: str, default=None):
        return self._config.get(key, default)

    def set(self, key: str, value):
        self._config[key] = value
        self._save_config()

    def update(self, data: dict):
        self._config.update(data)
        self._save_config()

    def get_all(self) -> dict:
        return self._config.copy()


config = ConfigManager()
