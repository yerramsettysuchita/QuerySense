from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from app.agent.vision import analyze_performance_screenshot, generate_query_from_screenshot
from app.core.config import settings
from app.core.deps import get_current_user

router = APIRouter()


@router.post("/analyze-screenshot")
async def analyze_screenshot(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
    return await analyze_performance_screenshot(image_bytes)


@router.post("/extract-query")
async def extract_query(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    image_bytes = await file.read()
    return await generate_query_from_screenshot(image_bytes)


@router.get("/status")
async def vision_status(current_user: dict = Depends(get_current_user)):
    return {"configured": bool(settings.OPENAI_API_KEY), "model": "gpt-4o"}
