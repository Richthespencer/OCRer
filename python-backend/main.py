import asyncio
import subprocess
import platform
import uuid
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
from shortcut_handler import take_screenshot
from history_manager import history
from task_manager import task_manager

latest_result = {"text": "", "timestamp": 0, "processing": False}
current_task_id = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


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


@app.get("/api/config")
async def get_config():
    return config.get_all()


@app.put("/api/config")
async def update_config(updates: ConfigUpdate):
    data = {k: v for k, v in updates.model_dump().items() if v is not None}
    config.update(data)
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
    global current_task_id
    task_id = str(uuid.uuid4())
    current_task_id = task_id
    task_manager.create_task(task_id)
    
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

        image_bytes = take_screenshot()
        
        # 截图完成后，通知前端显示窗口
        try:
            import requests
            requests.post("http://127.0.0.1:51235/show", timeout=1)
        except:
            pass
        
        if not image_bytes:
            task_manager.complete_task(task_id, error="截图已取消")
            current_task_id = None
            return {
                "success": False,
                "message": "截图已取消",
                "task_id": task_id
            }

        # 检查是否已取消
        if task_manager.is_cancelled(task_id):
            # 后台继续执行，但不等待结果
            asyncio.create_task(_background_ocr(task_id, image_bytes, provider))
            current_task_id = None
            return {
                "success": False,
                "message": "已取消，任务在后台继续",
                "task_id": task_id
            }

        # 设置30秒超时
        try:
            result = await asyncio.wait_for(do_ocr(image_bytes), timeout=30.0)
        except asyncio.TimeoutError:
            # 超时后转为后台任务
            asyncio.create_task(_background_ocr(task_id, image_bytes, provider))
            current_task_id = None
            return {
                "success": False,
                "message": "识别超时，任务在后台继续",
                "task_id": task_id
            }

        # 检查是否已取消
        if task_manager.is_cancelled(task_id):
            task_manager.complete_task(task_id, result=result)
            history.add(result, provider)
            current_task_id = None
            return {
                "success": False,
                "message": "已取消",
                "task_id": task_id
            }

        task_manager.complete_task(task_id, result=result)
        history.add(result, provider)

        if config.get("auto_copy_to_clipboard", True):
            copy_to_clipboard(result)

        current_task_id = None
        return {
            "success": True,
            "provider": provider,
            "text": result,
            "message": "识别完成，结果已复制到剪贴板",
            "task_id": task_id
        }
    except ValueError as e:
        task_manager.complete_task(task_id, error=str(e))
        current_task_id = None
        try:
            import requests
            requests.post("http://127.0.0.1:51235/show", timeout=1)
        except:
            pass
        return {
            "success": False,
            "error": str(e),
            "message": f"配置错误: {str(e)}",
            "task_id": task_id
        }
    except Exception as e:
        task_manager.complete_task(task_id, error=str(e))
        current_task_id = None
        try:
            import requests
            requests.post("http://127.0.0.1:51235/show", timeout=1)
        except:
            pass
        return {
            "success": False,
            "error": str(e),
            "message": f"识别失败: {str(e)}",
            "task_id": task_id
        }


async def _background_ocr(task_id: str, image_bytes: bytes, provider: str):
    try:
        result = await asyncio.wait_for(do_ocr(image_bytes), timeout=30.0)
        if not task_manager.is_cancelled(task_id):
            task_manager.complete_task(task_id, result=result)
            history.add(result, provider)
            if config.get("show_notification", True):
                show_notification("OCRer", "后台识别完成，结果已保存到历史记录")
    except Exception as e:
        task_manager.complete_task(task_id, error=str(e))


@app.post("/api/cancel-ocr")
async def cancel_ocr():
    global current_task_id
    if current_task_id:
        task_manager.cancel_task(current_task_id)
        try:
            import requests
            requests.post("http://127.0.0.1:51235/show", timeout=1)
        except:
            pass
        # 不立即清除current_task_id，让后台任务继续
        return {"success": True, "message": "已取消，任务在后台继续"}
    return {"success": False, "message": "没有进行中的任务"}


if __name__ == "__main__":
    import uvicorn
    port = config.get("port", 51234)
    uvicorn.run(app, host="127.0.0.1", port=port)
