import json
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Optional


def get_config_dir():
    """获取配置文件目录，打包后使用用户目录"""
    if getattr(sys, 'frozen', False):
        # 打包后的可执行文件
        if sys.platform == 'darwin':
            config_dir = Path.home() / "Library" / "Application Support" / "OCRer"
        elif sys.platform == 'win32':
            config_dir = Path(os.environ.get('APPDATA', '')) / "OCRer"
        else:
            config_dir = Path.home() / ".config" / "ocrer"
    else:
        # 开发模式
        config_dir = Path(__file__).parent.parent
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


class HistoryManager:
    def __init__(self, history_path: Optional[str] = None):
        if history_path is None:
            history_path = get_config_dir() / "history.json"
        self.history_path = Path(history_path)
        self._history = self._load_history()

    def _load_history(self) -> list:
        if self.history_path.exists():
            try:
                with open(self.history_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return []
        return []

    def _save_history(self):
        self.history_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.history_path, "w", encoding="utf-8") as f:
            json.dump(self._history, f, indent=2, ensure_ascii=False)

    def add(self, text: str, provider: str):
        entry = {
            "id": len(self._history) + 1,
            "text": text,
            "provider": provider,
            "timestamp": datetime.now().isoformat()
        }
        self._history.append(entry)
        self._save_history()
        return entry

    def get_all(self) -> list:
        return list(reversed(self._history))

    def get_by_id(self, entry_id: int) -> Optional[dict]:
        for entry in self._history:
            if entry["id"] == entry_id:
                return entry
        return None

    def delete(self, entry_id: int) -> bool:
        for i, entry in enumerate(self._history):
            if entry["id"] == entry_id:
                self._history.pop(i)
                self._save_history()
                return True
        return False

    def clear(self):
        self._history = []
        self._save_history()


history = HistoryManager()
