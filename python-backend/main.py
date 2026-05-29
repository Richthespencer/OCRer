import asyncio
import subprocess
import platform
from io import BytesIO
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from PIL import Image, ImageDraw, ImageFont
from config_manager import config, ConfigManager
from ocr_service import recognize_text
from paddleocr_service import recognize_text_paddleocr
from shortcut_handler import shortcut_handler, take_screenshot
from history_manager import history

latest_result = {"text": "", "timestamp": 0, "processing": False}


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_shortcut()
    yield
    shortcut_handler.stop()


app = FastAPI(title="OCRer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConfigUpdate(BaseModel):
    ocr_provider: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    shortcut_key: Optional[str] = None
    auto_copy_to_clipboard: Optional[bool] = None
    hide_window_on_screenshot: Optional[bool] = None
    show_notification: Optional[bool] = None
    api_base_url: Optional[str] = None
    ocr_prompt: Optional[str] = None
    paddleocr_api_url: Optional[str] = None
    paddleocr_token: Optional[str] = None
    paddleocr_model: Optional[str] = None


class OCRRequest(BaseModel):
    prompt: Optional[str] = None


def copy_to_clipboard(text: str):
    if platform.system() == "Darwin":
        process = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
        process.communicate(text.encode("utf-8"))
    else:
        import pyperclip
        pyperclip.copy(text)


def show_notification(title: str, message: str):
    if platform.system() == "Darwin":
        subprocess.run([
            "osascript", "-e",
            f'display notification "{message}" with title "{title}"'
        ])


async def do_ocr(image_bytes: bytes, prompt: Optional[str] = None) -> str:
    provider = config.get("ocr_provider", "siliconflow")
    if provider == "paddleocr":
        return await recognize_text_paddleocr(image_bytes)
    else:
        return await recognize_text(image_bytes, prompt)


def setup_shortcut():
    shortcut_key = config.get("shortcut_key", "cmd+shift+o")

    def on_shortcut():
        global latest_result
        try:
            latest_result = {"text": latest_result.get("text", ""), "timestamp": latest_result.get("timestamp", 0), "processing": True}

            hide_window = config.get("hide_window_on_screenshot", True)
            image_bytes = take_screenshot(hide_window)
            if not image_bytes:
                latest_result["processing"] = False
                return

            loop = asyncio.new_event_loop()
            result = loop.run_until_complete(do_ocr(image_bytes))
            loop.close()

            provider = config.get("ocr_provider", "siliconflow")
            history.add(result, provider)

            latest_result = {
                "text": result,
                "timestamp": __import__('time').time(),
                "processing": False
            }

            if config.get("auto_copy_to_clipboard", True):
                copy_to_clipboard(result)

            if config.get("show_notification", True):
                show_notification("OCRer", "识别完成，结果已复制到剪贴板")

        except Exception as e:
            latest_result["processing"] = False
            show_notification("OCRer 错误", str(e))

    shortcut_handler.set_shortcut(shortcut_key, on_shortcut)


@app.get("/api/config")
async def get_config():
    return config.get_all()


@app.put("/api/config")
async def update_config(updates: ConfigUpdate):
    data = {k: v for k, v in updates.model_dump().items() if v is not None}
    config.update(data)
    setup_shortcut()
    return config.get_all()


@app.post("/api/ocr")
async def ocr_from_clipboard(req: OCRRequest):
    try:
        image_bytes = take_screenshot()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Screenshot cancelled")

        result = await do_ocr(image_bytes, req.prompt)

        if config.get("auto_copy_to_clipboard", True):
            copy_to_clipboard(result)

        return {"text": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/latest-result")
async def get_latest_result():
    return latest_result


@app.get("/api/history")
async def get_history():
    return history.get_all()


@app.delete("/api/history/{entry_id}")
async def delete_history(entry_id: int):
    if history.delete(entry_id):
        return {"success": True}
    raise HTTPException(status_code=404, detail="Entry not found")


@app.delete("/api/history")
async def clear_history():
    history.clear()
    return {"success": True}


def create_test_image() -> bytes:
    img = Image.new('RGB', (400, 100), color='white')
    d = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 36)
    except:
        font = ImageFont.load_default()

    d.text((20, 30), "Hello OCR 测试文字", fill='black', font=font)

    buf = BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


@app.post("/api/test-ocr")
async def test_ocr():
    try:
        provider = config.get("ocr_provider", "siliconflow")

        if provider == "paddleocr":
            token = config.get("paddleocr_token")
            if not token:
                raise ValueError("PaddleOCR token not configured")
        else:
            api_key = config.get("api_key")
            if not api_key:
                raise ValueError("SiliconFlow API key not configured")

        hide_window = config.get("hide_window_on_screenshot", True)
        image_bytes = take_screenshot(hide_window)
        if not image_bytes:
            return {
                "success": False,
                "message": "截图已取消"
            }

        result = await do_ocr(image_bytes)

        history.add(result, provider)

        if config.get("auto_copy_to_clipboard", True):
            copy_to_clipboard(result)

        return {
            "success": True,
            "provider": provider,
            "text": result,
            "message": "识别完成，结果已复制到剪贴板"
        }
    except ValueError as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"配置错误: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"识别失败: {str(e)}"
        }


if __name__ == "__main__":
    import uvicorn
    port = config.get("port", 51234)
    uvicorn.run(app, host="127.0.0.1", port=port)
