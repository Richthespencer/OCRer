import base64
import httpx
from typing import Optional
from config_manager import config


async def recognize_text(image_bytes: bytes, prompt: Optional[str] = None) -> str:
    api_key = config.get("api_key")
    if not api_key:
        raise ValueError("API key not configured")

    base_url = config.get("api_base_url", "https://api.siliconflow.cn/v1")
    model = config.get("model", "deepseek-ai/DeepSeek-OCR")
    ocr_prompt = prompt or config.get("ocr_prompt", "请识别图片中的所有文字")

    image_base64 = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": ocr_prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_base64}"
                        }
                    }
                ]
            }
        ],
        "max_tokens": 4096
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            json=payload,
            headers=headers
        )
        response.raise_for_status()
        result = response.json()

    return result["choices"][0]["message"]["content"]
