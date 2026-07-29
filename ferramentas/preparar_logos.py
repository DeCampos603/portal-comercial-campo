#!/usr/bin/env python3
"""
Prepara as logomarcas para o PDF do pedido.

Cada logo passa por: recorte da moldura branca, fundo transparente,
redimensionamento e embutimento em base64 num módulo JavaScript.

Por que embutir em vez de referenciar o arquivo: o PDF é gerado por
`window.print()`, e imagem que ainda não carregou sai em branco. Em base64
ela já está no HTML — imprime sempre, inclusive offline.

Uso:
    coloque os arquivos em portal/assets/logos/ com estes nomes:
        sibb.*        (jpeg, jpg, png ou webp)
        majoaquim.*
    depois rode:
        python ferramentas/preparar_logos.py
"""

import base64
import io
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Falta a biblioteca Pillow.  pip install pillow")

for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "portal" / "assets" / "logos"
SAIDA = RAIZ / "portal" / "js" / "cotacoes" / "logos.js"

LARGURA_ALVO = 300          # ~35 mm impressos a 200 dpi: nítido e leve
LIMIAR_BRANCO = 242         # acima disto vira transparente
EXTENSOES = (".png", ".jpg", ".jpeg", ".webp")

MARCAS = {
    "sibb": "SIBB — fabricante representado",
    "majoaquim": "M A Joaquim — a representação",
}


def achar(nome):
    for ext in EXTENSOES:
        for candidato in (PASTA / f"{nome}{ext}", PASTA / f"{nome.upper()}{ext}"):
            if candidato.exists():
                return candidato
    return None


def processar(caminho):
    im = Image.open(caminho).convert("RGB")
    original = im.size

    # Recorta a moldura branca — arte exportada costuma vir com muita sobra,
    # que no PDF vira um bloco vazio ocupando espaço do cabeçalho.
    cinza = im.convert("L")
    caixa = cinza.point(lambda p: 255 if p < 245 else 0).getbbox()
    if caixa:
        im = im.crop(caixa)

    # Fundo branco vira transparente: sem isso aparece um retângulo branco
    # sobre o papel, visível quando o PDF tem qualquer cor de fundo.
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b, _ = px[x, y]
            if r > LIMIAR_BRANCO and g > LIMIAR_BRANCO and b > LIMIAR_BRANCO:
                px[x, y] = (r, g, b, 0)

    altura = round(im.size[1] * LARGURA_ALVO / im.size[0])
    im = im.resize((LARGURA_ALVO, altura), Image.LANCZOS)

    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return im, buf.getvalue(), original


def main():
    PASTA.mkdir(parents=True, exist_ok=True)
    embutidas = {}
    faltando = []

    print("=" * 58)
    print("PREPARANDO LOGOMARCAS")
    print("=" * 58)

    for nome, descricao in MARCAS.items():
        caminho = achar(nome)
        if not caminho:
            faltando.append((nome, descricao))
            print(f"  ⬜ {nome:<12} não encontrada em portal/assets/logos/")
            continue

        im, dados, original = processar(caminho)
        (PASTA / f"{nome}.png").write_bytes(dados)
        embutidas[nome] = base64.b64encode(dados).decode()
        print(f"  ✅ {nome:<12} {original[0]}x{original[1]} → "
              f"{im.size[0]}x{im.size[1]}  ({len(dados)/1024:.1f} KB)")

    linhas = [
        "/**",
        " * Logomarcas embutidas em base64.",
        " *",
        " * GERADO por ferramentas/preparar_logos.py — não edite à mão.",
        " *",
        " * Base64 em vez de <img src=arquivo> porque o PDF é gerado por",
        " * window.print(): imagem que ainda não carregou sai em branco no papel.",
        " * Embutida, ela já está no HTML — imprime sempre, inclusive offline.",
        " */",
        "",
    ]
    for nome in MARCAS:
        if nome in embutidas:
            linhas.append(f"export const LOGO_{nome.upper()} = "
                          f"'data:image/png;base64,{embutidas[nome]}';")
        else:
            linhas.append(f"/** Ainda não fornecida — ver preparar_logos.py */")
            linhas.append(f"export const LOGO_{nome.upper()} = null;")
        linhas.append("")

    SAIDA.write_text("\n".join(linhas), encoding="utf-8")
    print(f"\n✅ Módulo gerado: {SAIDA.relative_to(RAIZ)} "
          f"({SAIDA.stat().st_size/1024:.1f} KB)")

    if faltando:
        print("\nFaltam:")
        for nome, descricao in faltando:
            print(f"  • {nome} — {descricao}")
            print(f"    salve em portal/assets/logos/{nome}.png (ou .jpg) e rode de novo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
