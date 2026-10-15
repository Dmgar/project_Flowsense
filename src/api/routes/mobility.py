import asyncio
import csv
import io
from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from src.services.mobility_service import mobility_service

router = APIRouter(prefix="/mobility", tags=["Mobility Intelligence & Public Cameras"])


class CameraConnection(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    source: str = Field(min_length=1, max_length=1000)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class CaseInput(BaseModel):
    signal_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=2, max_length=200)
    owner: str = Field(default="Operaciones de movilidad", min_length=2, max_length=120)
    severity: Literal["low", "medium", "high"] = "medium"
    note: str = Field(default="", max_length=2000)
    data_origin: Literal["presentation", "observation"] = "presentation"
    evidence_camera_id: str | None = Field(default=None, max_length=120)
    evidence_frame_id: str | None = Field(default=None, max_length=120)
    confidence: float | None = Field(default=None, ge=0, le=1)


class CaseReview(BaseModel):
    status: Literal["assigned", "under_review", "confirmed", "resolved", "dismissed"]
    owner: str = Field(min_length=2, max_length=120)
    note: str = Field(min_length=3, max_length=2000)


@router.get("/cameras")
def cameras():
    return mobility_service.list_cameras()


@router.post("/cameras")
async def connect_camera(payload: CameraConnection):
    try:
        return await asyncio.to_thread(mobility_service.connect, payload.model_dump())
    except ValueError as error:
        raise HTTPException(400, str(error))


@router.get("/cameras/{camera_id}/snapshot")
async def snapshot(camera_id: str, frame_id: str | None = None):
    try:
        if frame_id:
            return Response(mobility_service.historical_image(camera_id, frame_id), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
        frame = await asyncio.to_thread(mobility_service.capture, camera_id)
        return Response(frame["image"], media_type="image/jpeg", headers={
            "Cache-Control": "no-store", "X-Observed-At": frame["observed_at"], "X-Frame-Id": frame["hash"]})
    except KeyError:
        raise HTTPException(404, "Cámara no encontrada.")
    except Exception:
        raise HTTPException(503, "La cámara no responde. El proveedor público puede interrumpir su señal.") from None


@router.get("/cameras/{camera_id}/observation")
async def observation(camera_id: str):
    try:
        return await asyncio.to_thread(mobility_service.observe, camera_id)
    except KeyError:
        raise HTTPException(404, "Cámara no encontrada.")
    except Exception:
        raise HTTPException(503, "No se pudo observar esta cámara. Reintenta más tarde.") from None


@router.get("/cameras/{camera_id}/history")
def history(camera_id: str):
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Cámara no encontrada.")
    return mobility_service.history(camera_id)


@router.get("/cases")
def cases():
    return mobility_service.cases()


@router.post("/cases")
def create_case(payload: CaseInput):
    return mobility_service.create_case(payload.model_dump())


@router.patch("/cases/{case_id}")
def review_case(case_id: str, payload: CaseReview):
    try:
        return mobility_service.review_case(case_id, payload.model_dump())
    except KeyError:
        raise HTTPException(404, "Caso no encontrado.")
    except ValueError as error:
        raise HTTPException(409, str(error))


@router.get("/reports/cases.csv")
def export_cases():
    output = io.StringIO()
    fields = ["id", "title", "severity", "status", "owner", "data_origin", "evidence_camera_id", "evidence_frame_id", "created_at", "updated_at"]
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for item in mobility_service.cases():
        # Spreadsheet formulas from operator-authored text must remain literal.
        writer.writerow({key: ("'" + str(value) if str(value).startswith(("=", "+", "-", "@")) else value)
                         for key, value in item.items() if key in fields})
    return Response("\ufeff" + output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="flowsense-cases.csv"'})


@router.get("/reports/cases.pdf")
def export_pdf(title: str = Query(default="Situación operativa", max_length=80),
               period: str = Query(default="Últimos 15 min", max_length=80)):
    from src.services.mobility_report import build_case_report
    return Response(build_case_report(mobility_service.cases(), title, period), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="flowsense-review.pdf"'})
