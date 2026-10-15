"""Printable, source-labelled case reports; no invented impact or camera metrics."""
import io
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from src.core.config import settings
from src.services.mobility_service import now


LABELS = {"new": "Revisión requerida", "assigned": "Asignado", "under_review": "En revisión",
          "confirmed": "Confirmado por operador", "resolved": "Resuelto", "dismissed": "Descartado"}


def build_case_report(cases, title="Situación operativa", period="Últimos 15 min"):
    output = io.BytesIO()
    ink = colors.HexColor("#334A36")
    muted = colors.HexColor("#78886E")
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("FlowTitle", fontName="Helvetica-Bold", fontSize=25, leading=30, textColor=ink, spaceAfter=12))
    styles.add(ParagraphStyle("FlowHeading", fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=ink, spaceBefore=15, spaceAfter=9, keepWithNext=True))
    styles.add(ParagraphStyle("FlowBody", fontName="Helvetica", fontSize=9, leading=14, textColor=ink, spaceAfter=7))
    styles.add(ParagraphStyle("FlowMuted", fontName="Helvetica", fontSize=8, leading=12, textColor=muted, spaceAfter=4))
    def p(text, style="FlowBody"):
        return Paragraph(escape(str(text)), styles[style])
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=21 * mm, leftMargin=21 * mm,
                                 topMargin=22 * mm, bottomMargin=22 * mm, title="FlowSense - " + title,
                                 author="FlowSense - Mobility Intelligence")
    generated = now()
    story = [p("FLOWSENSE / MOBILITY INTELLIGENCE", "FlowMuted"), p(title, "FlowTitle"),
             p(f"{settings.PILOT_CITY} | {period}", "FlowBody"),
             p(f"Generado: {generated} (UTC)", "FlowMuted"), Spacer(1, 8 * mm)]
    summary = Table([[p("Casos registrados"), p("Confirmados"), p("Resueltos / descartados")],
                     [p(len(cases), "FlowHeading"), p(sum(c["status"] == "confirmed" for c in cases), "FlowHeading"),
                      p(sum(c["status"] in {"resolved", "dismissed"} for c in cases), "FlowHeading")]], colWidths=[56 * mm] * 3)
    summary.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF3E7")),
                                 ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 10),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 12)]))
    story.extend([summary, Spacer(1, 9 * mm), p("Procedencia y alcance", "FlowHeading"),
                  p("Cámaras públicas: Caltrans. Red vial: OpenStreetMap. Las imágenes son públicas y su disponibilidad depende del proveedor. La hora de consulta no acredita la hora de captura."),
                  p("Los casos con procedencia 'presentation' pertenecen a un escenario ilustrativo. Su confirmación registra una decisión del operador dentro del escenario; no prueba un incidente real ni una mejora de movilidad."),
                  p("Este reporte no ordena un despacho, no controla semáforos y no estima impacto municipal. Los aforos, velocidades y comparaciones reales requieren series y calibración."),
                  p("Casos y bitácora", "FlowHeading")])
    if not cases:
        story.append(p("No hay casos registrados para exportar. Asigna una revisión desde la plataforma."))
    for case in cases:
        case_story = []
        case_story.append(p(f"{case['id']} / {case['title']}", "FlowHeading"))
        case_story.append(p(f"Estado: {LABELS.get(case['status'], case['status'])} | Equipo: {case['owner']}"))
        case_story.append(p(f"Procedencia: {case['data_origin']} | Señal: {case['signal_id']} | Prioridad: {case['severity']}", "FlowMuted"))
        if case.get("evidence_camera_id"):
            case_story.append(p(f"Cámara: {case['evidence_camera_id']} | Fotograma de sesión: {case.get('evidence_frame_id') or 'no indicado'}", "FlowMuted"))
        for step in case["audit"]:
            case_story.append(p(f"{step['at']} | {LABELS.get(step['action'], step['action'])} | {step['owner']}", "FlowMuted"))
            if step.get("note"):
                case_story.append(p(step["note"]))
        case_story.append(Spacer(1, 4 * mm))
        story.append(KeepTogether(case_story))
    source_urls = ["https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm",
                   "https://quickmap.dot.ca.gov/", "https://www.openstreetmap.org/copyright"]
    story.extend([Spacer(1, 2 * mm), KeepTogether([p("Fuentes oficiales", "FlowHeading"),
                  Paragraph("<br/>".join(escape(url) for url in source_urls), styles["FlowMuted"])])])
    def footer(canvas, doc):
        canvas.setStrokeColor(colors.HexColor("#DBE4D4")); canvas.line(21 * mm, 16 * mm, 189 * mm, 16 * mm)
        canvas.setFont("Helvetica", 7); canvas.setFillColor(muted)
        canvas.drawString(21 * mm, 12 * mm, "FlowSense | Evidencia - contexto - revisión humana")
        canvas.drawRightString(189 * mm, 12 * mm, f"Página {doc.page}")
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
