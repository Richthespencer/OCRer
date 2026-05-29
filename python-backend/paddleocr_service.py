import base64
import httpx
import asyncio
import json
from typing import Optional
from config_manager import config


async def recognize_text_paddleocr(image_bytes: bytes) -> str:
    api_token = config.get("paddleocr_token")
    if not api_token:
        raise ValueError("PaddleOCR token not configured")

    job_url = config.get("paddleocr_api_url", "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs")
    model = config.get("paddleocr_model", "PaddleOCR-VL-1.5")

    headers = {
        "Authorization": f"bearer {api_token}",
    }

    optional_payload = {
        "useDocOrientationClassify": False,
        "useDocUnwarping": False,
        "useChartRecognition": False
    }

    data = {
        "model": model,
        "optionalPayload": json.dumps(optional_payload)
    }

    files = {"file": ("image.png", image_bytes, "image/png")}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            job_url,
            headers=headers,
            data=data,
            files=files
        )
        response.raise_for_status()
        result = response.json()

    if response.status_code != 200:
        raise RuntimeError(f"PaddleOCR submit failed: {result}")

    job_id = result["data"]["jobId"]
    print(f"Job submitted: {job_id}")

    max_retries = 60
    for i in range(max_retries):
        await asyncio.sleep(2)

        async with httpx.AsyncClient(timeout=30.0) as client:
            job_response = await client.get(
                f"{job_url}/{job_id}",
                headers=headers
            )
            job_response.raise_for_status()
            job_result = job_response.json()

        state = job_result["data"]["state"]
        print(f"Polling {i+1}: state={state}")

        if state == "done":
            jsonl_url = job_result["data"]["resultUrl"]["jsonUrl"]

            async with httpx.AsyncClient(timeout=30.0) as client:
                jsonl_response = await client.get(jsonl_url)
                jsonl_response.raise_for_status()

            lines = jsonl_response.text.strip().split("\n")
            texts = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                result = json.loads(line)["result"]
                for page in result.get("layoutParsingResults", []):
                    md = page.get("markdown", {})
                    if "text" in md:
                        texts.append(md["text"])

            return "\n\n".join(texts) if texts else "No text recognized"

        elif state == "failed":
            error_msg = job_result["data"].get("errorMsg", "Unknown error")
            raise RuntimeError(f"PaddleOCR task failed: {error_msg}")

    raise RuntimeError("PaddleOCR task timeout")
