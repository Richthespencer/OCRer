import subprocess
import tempfile
import os
from pathlib import Path
from pynput import keyboard
from typing import Callable, Optional


class ShortcutHandler:
    def __init__(self):
        self._listener: Optional[keyboard.Listener] = None
        self._callback: Optional[Callable] = None
        self._current_keys = set()

    def _parse_shortcut(self, shortcut_str: str):
        parts = shortcut_str.lower().split("+")
        keys = set()
        for part in parts:
            part = part.strip()
            if part in ("cmd", "command"):
                keys.add(keyboard.Key.cmd)
            elif part in ("ctrl", "control"):
                keys.add(keyboard.Key.ctrl)
            elif part in ("alt", "option"):
                keys.add(keyboard.Key.alt)
            elif part in ("shift",):
                keys.add(keyboard.Key.shift)
            elif len(part) == 1:
                keys.add(keyboard.KeyCode.from_char(part))
            else:
                try:
                    keys.add(getattr(keyboard.Key, part))
                except AttributeError:
                    keys.add(keyboard.KeyCode.from_char(part[0]))
        return keys

    def _normalize_key(self, key):
        if hasattr(key, 'char') and key.char:
            return keyboard.KeyCode.from_char(key.char.lower())
        return key

    def _on_press(self, key):
        normalized = self._normalize_key(key)
        self._current_keys.add(normalized)

    def _on_release(self, key):
        normalized = self._normalize_key(key)
        self._current_keys.discard(normalized)

    def set_shortcut(self, shortcut_str: str, callback: Callable):
        self._callback = callback
        self._target_keys = self._parse_shortcut(shortcut_str)

        def on_press(k):
            normalized = self._normalize_key(k)
            self._current_keys.add(normalized)
            if self._target_keys.issubset(self._current_keys):
                if self._callback:
                    self._callback()

        def on_release(k):
            normalized = self._normalize_key(k)
            self._current_keys.discard(normalized)

        if self._listener:
            self._listener.stop()

        self._listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        self._listener.start()

    def stop(self):
        if self._listener:
            self._listener.stop()
            self._listener = None


def take_screenshot(hide_window: bool = False) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        cmd = ["screencapture", "-i"]
        if hide_window:
            cmd.append("-C")
        cmd.append(tmp_path)
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            raise RuntimeError(f"screencapture failed: {result.stderr}")

        if not os.path.exists(tmp_path):
            raise RuntimeError("Screenshot cancelled or failed")

        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


shortcut_handler = ShortcutHandler()
