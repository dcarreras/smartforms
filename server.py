"""
Formblatt Local Vision Inference Sidecar
=========================================
100% Local Python server for high-precision form field detection.
Zero data or documents leave your machine (localhost only).

Engines (in priority order):
  1. FFDNet-L  — Vision transformer (YOLO) trained on real PDF forms.
                 Detects textbox, choice_button, signature directly from pixels.
  2. Heuristic — Token-affordance fallback when image unavailable or model absent.

Endpoints:
  GET  /health             - Service status, active device, model status
  POST /api/detect-fields  - Detect form fields from a single rendered page image
  POST /api/detect-pdf     - Accept a raw PDF (base64), render every page, return all fields
"""

import io
import os
import re
import time
import base64
from pathlib import Path
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, ImageOps, ImageFilter
import fitz  # PyMuPDF — for server-side PDF rendering

app = FastAPI(
    title="SmartForms Local Document Understanding Sidecar",
    description="Optional local FFDNet-L vision inference for SmartForms PDF form auto-detection.",
    version="2.0.0"
)

# Allowed origins: SmartForms production domains and local development instances.
DEFAULT_ALLOWED_ORIGINS = [
    "https://smartforms-cons.pages.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

CUSTOM_ORIGINS = [
    orig.strip()
    for orig in os.getenv("FORMOBLATT_ALLOWED_ORIGINS", "").split(",")
    if orig.strip()
]
ALLOWED_ORIGINS = list(dict.fromkeys(DEFAULT_ALLOWED_ORIGINS + CUSTOM_ORIGINS))
ALLOWED_ORIGIN_REGEX = r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|https://smartforms-cons\.pages\.dev)$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

# ── Device detection ──────────────────────────────────────────────────────────
DEVICE = "cpu"
try:
    import torch
    if torch.backends.mps.is_available():
        DEVICE = "mps"
    elif torch.cuda.is_available():
        DEVICE = "cuda"
except ImportError:
    torch = None

# ── FFDNet-L model loading ────────────────────────────────────────────────────
# Expected at: <project_root>/models/FFDNet-L.pt
# Classes: {0: 'textbox', 1: 'choice_button', 2: 'signature'}
_THIS_DIR = Path(__file__).parent
candidate_paths = [
    _THIS_DIR / "models" / "FFDNet-L.pt",
]
FFDNET_WEIGHTS = next((p for p in candidate_paths if p.exists()), candidate_paths[0])

FFDNET_MODEL = None
MODEL_STATUS = "not_loaded"

def load_ffdnet():
    global FFDNET_MODEL, MODEL_STATUS
    if not FFDNET_WEIGHTS.exists():
        print(f"[FFDNet] Weights not found at {FFDNET_WEIGHTS} — falling back to heuristic engine.")
        MODEL_STATUS = "missing_weights"
        return
    try:
        from ultralytics import YOLO
        FFDNET_MODEL = YOLO(str(FFDNET_WEIGHTS))
        # Warm-up pass with a blank 640×640 image
        import numpy as np
        dummy = np.zeros((640, 640, 3), dtype="uint8")
        FFDNET_MODEL.predict(source=dummy, conf=0.1, verbose=False)
        MODEL_STATUS = "loaded"
        print(f"[FFDNet] Model loaded successfully. Classes: {FFDNET_MODEL.names}")
    except Exception as e:
        print(f"[FFDNet] Failed to load model: {e}")
        MODEL_STATUS = f"load_error: {e}"

load_ffdnet()


# ── Pydantic schemas ──────────────────────────────────────────────────────────
class TokenItem(BaseModel):
    text: str
    box: List[float]  # [x, y, w, h]


class DetectRequest(BaseModel):
    image: Optional[str] = None   # Base64 string or data URL of the rendered page
    width: Optional[float] = 612.0
    height: Optional[float] = 792.0
    tokens: Optional[List[Dict[str, Any]]] = []
    page: Optional[int] = 1
    # Optional render DPI hint so coordinate scaling is exact.
    # If omitted the server back-calculates from image pixel dimensions.
    dpi: Optional[float] = None


class DetectResponse(BaseModel):
    success: bool
    fields: List[Dict[str, Any]]
    count: int
    latency_ms: float
    device: str
    engine: str


# ── Helpers ───────────────────────────────────────────────────────────────────
def sanitize_field_name(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\s_]", "", text or "").strip().lower()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned[:32] if cleaned else "field"


def decode_base64_image(image_data: str) -> Optional[Image.Image]:
    if not image_data:
        return None
    try:
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]
        raw_bytes = base64.b64decode(image_data)
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        return img
    except Exception as e:
        print(f"[Warning] Failed to decode base64 image: {e}")
        return None


def _ffdnet_class_to_field_type(cls_name: str, label: str = "") -> str:
    """Map FFDNet-L class names to Formblatt internal field types."""
    DATE_RE = re.compile(r"\b(date|dated|dt|datum|fecha)\b", re.I)
    if cls_name == "textbox":
        if DATE_RE.search(label):
            return "dateField"
        return "textField"
    elif cls_name == "choice_button":
        return "checkBox"
    elif cls_name == "signature":
        return "signature"
    return "textField"


def _nearest_label(px: float, py: float, pw: float, ph: float,
                   tokens: List[Dict], pdf_w: float, scale_x: float, scale_y: float,
                   is_choice: bool = False) -> str:
    """
    Find the closest text token or line phrase to a detected field box.
    - For textboxes: searches left, top, or in-box.
    - For choice_buttons (checkbox/radio): searches right (primary) or left.
    """
    field_x_pt = px / scale_x
    field_y_pt = py / scale_y
    field_w_pt = pw / scale_x
    field_h_pt = ph / scale_y
    field_y_mid = field_y_pt + field_h_pt / 2

    candidates = []
    for t in tokens:
        box = t.get("box") or [t.get("x", 0), t.get("y", 0), t.get("width", 0), t.get("height", 0)]
        if len(box) < 4:
            continue
        text = str(t.get("text") or t.get("str") or "").strip()
        if not text or re.match(r"^[\.\s_—–\-:]+$", text):
            continue
        tx, ty, tw, th = float(box[0]), float(box[1]), float(box[2]), float(box[3])
        ty_mid = ty + th / 2

        # 1. Label to the left on same row
        is_left = (tx + tw <= field_x_pt + 8) and (field_x_pt - (tx + tw) <= 220) and abs(field_y_mid - ty_mid) <= max(14.0, th)
        # 2. Label to the right on same row (standard for checkboxes/radios)
        is_right = (tx >= field_x_pt + field_w_pt - 4) and (tx - (field_x_pt + field_w_pt) <= 180) and abs(field_y_mid - ty_mid) <= max(14.0, th)
        # 3. Label above the box
        is_above = (ty + th <= field_y_pt + 4) and (field_y_pt - (ty + th) <= 35) and (tx >= field_x_pt - 40) and (tx <= field_x_pt + field_w_pt + 40)

        if is_choice and is_right:
            dist = tx - (field_x_pt + field_w_pt)
            candidates.append((dist, text, ty, tx))
        elif is_left:
            dist = field_x_pt - (tx + tw)
            candidates.append((dist, text, ty, tx))
        elif is_above:
            dist = (field_y_pt - (ty + th)) * 1.5
            candidates.append((dist, text, ty, tx))
        elif is_choice and is_left:
            dist = (field_x_pt - (tx + tw)) * 1.2
            candidates.append((dist, text, ty, tx))

    if not candidates:
        return ""

    candidates.sort(key=lambda c: c[0])
    best_dist, best_word, best_y, best_x = candidates[0]

    # Reconstruct whole phrase on that line around best_word
    line_tokens = [t for t in tokens if abs((t.get("box") or [0, 0, 0, 0])[1] - best_y) <= 4]
    line_tokens.sort(key=lambda t: (t.get("box") or [0, 0, 0, 0])[0])
    phrase_words = [str(t.get("text") or t.get("str") or "").strip() for t in line_tokens]
    phrase = " ".join(w for w in phrase_words if w and not re.match(r"^[\.\s_—–\-:]+$", w))

    clean_phrase = re.sub(r"[:\s_—–-]+$", "", phrase).strip()
    return clean_phrase[:48] if clean_phrase else best_word


def is_circular_glyph(image: Image.Image, x0: float, y0: float, x1: float, y1: float) -> bool:
    """
    Checks if a detected choice_button is a circular radio button or a square checkbox.
    In a circle, corners are empty paper; in a square checkbox, corners have border ink.
    """
    try:
        ix0, iy0, ix1, iy1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        w, h = ix1 - ix0, iy1 - iy0
        if w < 6 or h < 6:
            return False
        crop = image.crop((ix0, iy0, ix1, iy1)).convert("L")
        import numpy as np
        arr = np.array(crop)
        bg = np.percentile(arr, 90)
        dark = arr < (bg - 28)
        cw, ch = max(1, int(w * 0.16)), max(1, int(h * 0.16))
        tl = dark[:ch, :cw].any()
        tr = dark[:ch, -cw:].any()
        bl = dark[-ch:, :cw].any()
        br = dark[-ch:, -cw:].any()
        corner_hits = sum([tl, tr, bl, br])
        return corner_hits <= 1
    except Exception:
        return False


# ── FFDNet-L vision engine ────────────────────────────────────────────────────
def run_ffdnet_detection(
    image: Image.Image,
    tokens: List[Dict[str, Any]],
    page_width: float,
    page_height: float,
    page_num: int,
    conf_threshold: float = 0.15,
) -> List[Dict[str, Any]]:
    """
    Runs FFDNet-L on the rendered page image.
    Scales pixel-space bounding boxes back to PDF point coordinates.
    Assigns a nearest-token label for field naming and type refinement.
    Distinguishes circular radio buttons from square checkboxes.
    """
    img_w, img_h = image.width, image.height

    # Scale factors: pixels → PDF points
    scale_x = img_w / page_width
    scale_y = img_h / page_height

    results = FFDNET_MODEL.predict(source=image, conf=conf_threshold, verbose=False)

    detected: List[Dict[str, Any]] = []
    field_counter = 1

    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = FFDNET_MODEL.names[cls_id]
            confidence = float(box.conf[0])
            x0, y0, x1, y1 = box.xyxy[0].tolist()

            # Convert pixel bbox → PDF point bbox
            pt_x = x0 / scale_x
            pt_y = y0 / scale_y
            pt_w = (x1 - x0) / scale_x
            pt_h = (y1 - y0) / scale_y

            # Clamp to page bounds
            pt_x = max(0.0, min(pt_x, page_width - 4))
            pt_y = max(0.0, min(pt_y, page_height - 4))
            pt_w = min(pt_w, page_width - pt_x)
            pt_h = min(pt_h, page_height - pt_y)

            # Skip degenerate boxes
            if pt_w < 4 or pt_h < 4:
                continue

            label = _nearest_label(x0, y0, x1 - x0, y1 - y0, tokens, page_width, scale_x, scale_y, is_choice=(cls_name == "choice_button"))

            # Check if this choice_button is visually circular (radio button)
            if cls_name == "choice_button":
                is_circle = is_circular_glyph(image, x0, y0, x1, y1)
                field_type = "radioGroup" if is_circle else "checkBox"
            else:
                field_type = _ffdnet_class_to_field_type(cls_name, label)

            name_base = sanitize_field_name(label) if label else cls_name.replace("_", "")
            field_id = f"{cls_name[:3]}_{page_num}_{field_counter}"

            detected.append({
                "id": field_id,
                "name": f"{name_base}_{field_counter}",
                "type": field_type,
                "x": round(pt_x, 1),
                "y": round(pt_y, 1),
                "width": round(pt_w, 1),
                "height": round(pt_h, 1),
                "borderStyle": "none",
                "fillStyle": "transparent",
                "borderWidth": 0,
                "confidence": round(confidence, 4),
                "detectedBy": "ffdnet-l",
                "label": label or cls_name.replace("_", " ").title(),
            })
            field_counter += 1

    # Post-process: cluster mutually exclusive choice buttons (e.g. Yes/No, Male/Female)
    MUTUAL_RADIO_SETS = [
        {"yes", "no"},
        {"male", "female"},
        {"single", "married"},
        {"full_time", "part_time"},
        {"cash", "credit"},
        {"am", "pm"},
        {"true", "false"},
    ]
    choice_fields = [f for f in detected if f["type"] in ("checkBox", "radioGroup")]
    for i, cf1 in enumerate(choice_fields):
        for cf2 in choice_fields[i+1:]:
            is_aligned = (abs(cf1["y"] - cf2["y"]) <= 6 and abs(cf1["x"] - cf2["x"]) <= 120) or \
                         (abs(cf1["x"] - cf2["x"]) <= 6 and abs(cf1["y"] - cf2["y"]) <= 35)
            if is_aligned:
                l1 = (cf1["label"] or cf1["name"]).lower().strip().replace(" ", "_")
                l2 = (cf2["label"] or cf2["name"]).lower().strip().replace(" ", "_")
                for m_set in MUTUAL_RADIO_SETS:
                    if l1 in m_set and l2 in m_set:
                        grp_name = f"radio_group_{page_num}_{i+1}"
                        cf1["type"] = "radioGroup"
                        cf1["radioGroup"] = grp_name
                        cf1["exportValue"] = l1
                        cf2["type"] = "radioGroup"
                        cf2["radioGroup"] = grp_name
                        cf2["exportValue"] = l2

    return detected


# ── Heuristic fallback engine (token-only, no vision) ────────────────────────
def run_vision_heuristic_detection(
    image: Optional[Image.Image],
    tokens: List[Dict[str, Any]],
    page_width: float,
    page_height: float,
    page_num: int
) -> List[Dict[str, Any]]:
    """
    Token-affordance heuristic engine — EXPLICITLY BLOCKED for pure FFDNet-L testing.
    """
    print("[Sidecar] Heuristic detection engine is explicitly BLOCKED.")
    return []

    parsed_tokens = []
    for t in tokens:
        text = str(t.get("text") or t.get("str") or "").strip()
        if not text:
            continue
        box = t.get("box") or [t.get("x", 0), t.get("y", 0), t.get("width", 0), t.get("height", 0)]
        if len(box) >= 4:
            x, y, w, h = float(box[0]), float(box[1]), float(box[2]), float(box[3])
            parsed_tokens.append({"text": text, "x": x, "y": y, "w": w, "h": h, "x2": x + w, "y2": y + h})

    DATE_REGEX = re.compile(r"\b(date|dated|dt|datum|fecha)\b", re.I)
    SIG_REGEX = re.compile(r"\b(signature|sign\s*here|signed\s*by|unterschrift)\b", re.I)
    CHECKBOX_REGEX = re.compile(r"^(\[[\s_]?\]|[\u25A0\u25A1\u25AA\u25AB\u20DD\u25EF]|\u2713|\u2714)", re.I)

    for tok in parsed_tokens:
        text = tok["text"]

        if CHECKBOX_REGEX.search(text):
            detected.append({
                "id": f"cb_{page_num}_{field_counter}",
                "name": f"checkbox_{field_counter}",
                "type": "checkBox",
                "x": round(tok["x"], 1),
                "y": round(tok["y"], 1),
                "width": 14.0,
                "height": 14.0,
                "confidence": 0.95,
                "detectedBy": "heuristic-token",
                "label": "Choice"
            })
            field_counter += 1
            continue

        has_colon = text.endswith(":") or text.endswith("：")
        has_prompt = any(kw in text.lower() for kw in [
            "name", "address", "phone", "email", "city", "state", "zip",
            "title", "ssn", "ein", "amount", "total"
        ])

        if (has_colon or has_prompt) and len(text) < 40:
            is_date = bool(DATE_REGEX.search(text))
            is_sig = bool(SIG_REGEX.search(text))
            field_type = "dateField" if is_date else ("signature" if is_sig else "textField")
            field_w = 110.0 if is_date else (190.0 if is_sig else 160.0)
            field_h = 28.0 if is_sig else 20.0

            target_x = min(tok["x2"] + 6.0, page_width - field_w - 20)
            target_y = tok["y"] - (2 if not is_sig else 8)
            if target_x + field_w > page_width - 15:
                target_x = tok["x"]
                target_y = tok["y2"] + 4.0

            name_slug = sanitize_field_name(text.replace(":", ""))
            detected.append({
                "id": f"field_{page_num}_{field_counter}",
                "name": f"{name_slug}_{field_counter}",
                "type": field_type,
                "x": round(target_x, 1),
                "y": round(target_y, 1),
                "width": field_w,
                "height": field_h,
                "confidence": 0.88,
                "detectedBy": "heuristic-token",
                "label": text
            })
            field_counter += 1

    # Tax / financial line-item pattern
    LINE_TOKEN_REGEX = re.compile(r"^(?:\d{1,2}[a-z]?|[a-z])$", re.I)
    lines_dict: Dict[float, List[Dict]] = {}
    for tok in parsed_tokens:
        y_center = (tok["y"] + tok["y2"]) / 2
        matched_y = None
        for ey in lines_dict:
            if abs(ey - y_center) <= 4:
                matched_y = ey
                break
        if matched_y is None:
            matched_y = y_center
            lines_dict[matched_y] = []
        lines_dict[matched_y].append(tok)

    for y_c, row_toks in lines_dict.items():
        row_sorted = sorted(row_toks, key=lambda t: t["x"])
        row_str = " ".join(t["text"] for t in row_sorted)
        has_dots = bool(re.search(r'(?:\.\s*){4,}', row_str) or row_str.count(".") >= 5)
        has_tax_kw = any(kw in row_str.lower() for kw in [
            "wages", "salaries", "income", "tax", "deduction", "interest",
            "dividends", "total", "subtract", "add line", "gross"
        ])
        if not has_dots and not has_tax_kw:
            continue
        for idx, tok in enumerate(row_sorted):
            t_text = tok["text"].strip()
            if not re.match(r"^\d{1,2}[a-z]?$", t_text, re.I) and not (re.match(r"^[a-z]$", t_text, re.I) and has_dots):
                continue
            x_end = tok["x2"]
            next_tok = row_sorted[idx + 1] if idx + 1 < len(row_sorted) else None
            slot_x1 = x_end + 3
            slot_x2 = (next_tok["x"] - 3) if next_tok else min(576.0, page_width - 36.0)
            slot_w = slot_x2 - slot_x1
            if 48 <= slot_w <= 135:
                if slot_x2 >= page_width * 0.75 or (next_tok and next_tok["x"] >= 280):
                    has_words_in_slot = any(t["x"] >= slot_x1 - 2 and t["x2"] <= slot_x2 + 2 for t in row_sorted)
                    if has_words_in_slot:
                        continue
                    label_toks = [t["text"] for t in row_sorted[:idx] if not re.match(r"^[.\s_—–\-]+$", t["text"])]
                    label_str = " ".join(label_toks).strip() or f"line_{t_text}"
                    name_slug = sanitize_field_name(label_str[:32])
                    detected.append({
                        "id": f"field_{page_num}_{field_counter}",
                        "name": f"{name_slug}_{t_text.lower()}",
                        "type": "textField",
                        "x": round(slot_x1, 1),
                        "y": round(y_c - 6, 1),
                        "width": round(slot_w, 1),
                        "height": 13.0,
                        "confidence": 0.94,
                        "detectedBy": "heuristic-token",
                        "label": label_str[:40]
                    })
                    field_counter += 1

    return detected


# ── FastAPI routes ────────────────────────────────────────────────────────────
@app.get("/")
@app.get("/health")
def health_check():
    """Health status and capabilities check."""
    return {
        "status": "healthy",
        "service": "formblatt-ffdnet-sidecar",
        "device": DEVICE,
        "torch_available": torch is not None,
        "model": "FFDNet-L",
        "model_status": MODEL_STATUS,
        "model_classes": list(FFDNET_MODEL.names.values()) if FFDNET_MODEL else None,
        "engine": "ffdnet-l" if FFDNET_MODEL else "heuristic-fallback",
        "privacy": "100% local localhost execution - 0 bytes transmitted outside machine"
    }


@app.post("/api/detect-fields")
async def detect_fields(request: DetectRequest):
    """
    Main detection endpoint called by Formblatt editor.
    Priority:
      1. FFDNet-L vision model  (if image provided and model loaded)
      2. Heuristic token engine (fallback)
    """
    start_time = time.perf_counter()

    image = decode_base64_image(request.image) if request.image else None
    tokens = request.tokens or []
    page_width = float(request.width or 612.0)
    page_height = float(request.height or 792.0)
    page_num = int(request.page or 1)

    engine_used = "heuristic-fallback"

    if image is not None and FFDNET_MODEL is not None:
        try:
            fields = run_ffdnet_detection(
                image=image,
                tokens=tokens,
                page_width=page_width,
                page_height=page_height,
                page_num=page_num,
            )
            engine_used = "ffdnet-l"
        except Exception as e:
            print(f"[FFDNet] Inference error: {e}")
            fields = []
    else:
        # Heuristics blocked for pure vision test
        fields = []
        if image is None:
            print("[Sidecar] No image provided and heuristics are blocked.")
        elif FFDNET_MODEL is None:
            print(f"[Sidecar] FFDNet-L not loaded ({MODEL_STATUS}).")

    latency_ms = round((time.perf_counter() - start_time) * 1000, 2)

    return {
        "success": True,
        "fields": fields,
        "count": len(fields),
        "latency_ms": latency_ms,
        "device": DEVICE,
        "engine": engine_used,
    }



class DetectPdfRequest(BaseModel):
    pdf: str                          # Base64-encoded raw PDF bytes (no data-URL prefix needed)
    dpi: Optional[int] = 150         # Render resolution — higher = more accurate, slower
    conf: Optional[float] = 0.30     # FFDNet-L confidence threshold
    pages: Optional[List[int]] = None # 1-based page numbers to process; None = all pages


@app.post("/api/detect-pdf")
async def detect_pdf(request: DetectPdfRequest):
    """
    Accepts a raw PDF (base64-encoded), renders every page server-side with
    PyMuPDF at the requested DPI, runs FFDNet-L on each page image, and returns
    all detected fields grouped by page — no pre-rendering needed on the client.

    Request body:
        pdf   : base64 string of the PDF file bytes
        dpi   : render resolution (default 150; use 200 for dense forms)
        conf  : FFDNet-L confidence threshold (default 0.30)
        pages : optional list of 1-based page numbers to limit processing

    Response:
        pages  : list of { page, width_pt, height_pt, fields: [...] }
        total  : total fields across all pages
        engine : "ffdnet-l" or "heuristic-fallback"
    """
    start_time = time.perf_counter()

    # Decode the PDF bytes
    pdf_b64 = request.pdf
    if "," in pdf_b64:
        pdf_b64 = pdf_b64.split(",", 1)[1]
    try:
        pdf_bytes = base64.b64decode(pdf_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 PDF: {e}")

    # Open with PyMuPDF from memory
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open PDF: {e}")

    dpi = max(72, min(int(request.dpi or 150), 300))
    conf_threshold = float(request.conf or 0.30)
    page_filter = set(request.pages) if request.pages else None

    results_by_page = []
    engine_used = "heuristic-fallback"

    for page_idx in range(len(doc)):
        page_num = page_idx + 1
        if page_filter and page_num not in page_filter:
            continue

        page = doc[page_idx]
        pw = float(page.rect.width)
        ph = float(page.rect.height)

        # Render page to PIL image
        pix = page.get_pixmap(dpi=dpi)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Extract word tokens for semantic field naming
        tokens = []
        try:
            for w in page.get_text("words"):
                tokens.append({
                    "text": w[4],
                    "box": [w[0], w[1], w[2] - w[0], w[3] - w[1]]
                })
        except Exception:
            pass

        # Run FFDNet-L if available, else heuristic
        if FFDNET_MODEL is not None:
            try:
                fields = run_ffdnet_detection(
                    image=img,
                    tokens=tokens,
                    page_width=pw,
                    page_height=ph,
                    page_num=page_num,
                    conf_threshold=conf_threshold,
                )
                engine_used = "ffdnet-l"
            except Exception as e:
                print(f"[FFDNet] Page {page_num} inference error: {e}")
                fields = []
        else:
            fields = []

        results_by_page.append({
            "page": page_num,
            "width_pt": round(pw, 2),
            "height_pt": round(ph, 2),
            "field_count": len(fields),
            "fields": fields,
        })

    doc.close()
    total_fields = sum(p["field_count"] for p in results_by_page)
    latency_ms = round((time.perf_counter() - start_time) * 1000, 2)

    return {
        "success": True,
        "pages": results_by_page,
        "total": total_fields,
        "page_count": len(results_by_page),
        "latency_ms": latency_ms,
        "device": DEVICE,
        "engine": engine_used,
        "dpi": dpi,
    }


if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 60)
    print("Formblatt Document Understanding Local Sidecar v2")
    print(f"Engine: {'FFDNet-L (vision)' if FFDNET_MODEL else 'Heuristic (token-only)'}")
    print(f"Device: {DEVICE}")
    print("Running 100% locally at http://localhost:8000")
    print("=" * 60 + "\n")
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
