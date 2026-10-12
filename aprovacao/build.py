"""Monta a página de aprovação a partir de lote.json (posts + imagens em ../posts)."""
import base64, json, sys
from pathlib import Path
from io import BytesIO
from PIL import Image

here = Path(__file__).parent
lote = json.loads((here / "lote.json").read_text(encoding="utf-8"))
for p in lote["posts"]:
    im = Image.open(here.parent / p["arquivo"]).convert("RGB")
    im.thumbnail((720, 900))  # prévia leve para abrir rápido no celular
    buf = BytesIO(); im.save(buf, "JPEG", quality=82)
    p["img"] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
html = (here / "template.html").read_text(encoding="utf-8")
html = html.replace("/*DATA*/null/*END*/", "/*DATA*/" + json.dumps(lote, ensure_ascii=False) + "/*END*/")
out = here / "aprovacao.html"
out.write_text(html, encoding="utf-8")
print(out, out.stat().st_size // 1024, "KB")
