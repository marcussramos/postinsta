"""Gera um card de frase 1080x1350 (PNG -> JPEG) a partir do template.

Uso: python render.py "texto normal|texto em destaque" saida.jpg [TAG] [TAMANHO_FONTE]
O trecho depois de "|" fica na cor de destaque.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).parent
frase, saida = sys.argv[1], Path(sys.argv[2])
tag = sys.argv[3] if len(sys.argv) > 3 else "Papo reto"
size = sys.argv[4] if len(sys.argv) > 4 else "150"

normal, _, destaque = frase.partition("|")
html_frase = normal.strip() + (f"<em>{destaque.strip()}</em>" if destaque else "")
html = (ROOT / "templates/card.html").read_text(encoding="utf-8")
html = html.replace("{{FRASE}}", html_frase).replace("{{TAG}}", tag).replace("{{SIZE}}", size)

png = saida.with_suffix(".png")
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1080, "height": 1350})
    page.set_content(html)
    page.wait_for_timeout(300)
    page.screenshot(path=str(png))
    b.close()

# Instagram via API aceita apenas JPEG
Image.open(png).convert("RGB").save(saida, "JPEG", quality=92)
png.unlink()
print(saida)
