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
import statistics
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops
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
EXTENSOES = (".png", ".jpg", ".jpeg", ".webp")
SUFIXO_SAIDA = ".gerada.png"    # byproduto do script, nunca entrada

# Faixa de distância de cor até o fundo que define o alfa do pixel.
#
# Abaixo do PISO é ruído de compressão, e vira transparente de verdade. Acima
# da TOLERANCIA é desenho, e vira opaco. No meio fica a rampa que preserva o
# antisserrilhado das bordas.
#
# 🔴 Sem o PISO, o ruído do JPEG dava alfa 5 a 22 ao fundo inteiro: um véu
#    cinza sobre o papel, invisível na tela mas presente, e 75% da imagem em
#    alfa parcial — o que triplicava o tamanho do PNG.
PISO = 12
TOLERANCIA = 40

MARCAS = {
    "sibb": "SIBB — fabricante representado",
    "majoaquim": "M A Joaquim — a representação",
}


def achar(nome):
    """
    O arquivo ORIGINAL da marca.

    O `.gerada.png` é saída deste script e fica de fora de propósito: quando a
    saída se chamava `{nome}.png`, a rodada seguinte a encontrava primeiro e
    reprocessava o próprio resultado — recorte sobre recorte, reamostragem
    sobre reamostragem, degradando a logo a cada execução sem avisar.
    """
    for ext in EXTENSOES:
        for candidato in (PASTA / f"{nome}{ext}", PASTA / f"{nome.upper()}{ext}"):
            if candidato.exists() and not candidato.name.endswith(SUFIXO_SAIDA):
                return candidato
    return None


def cor_de_fundo(im):
    """
    A cor real da moldura, medida na borda — não presumida.

    🔴 A versão anterior presumia fundo BRANCO (limiar fixo em 242). A logo da
       M A Joaquim veio sobre papel cinza (~228): o recorte não recortava nada e
       só 0,6% dos pixels viravam transparentes. O resultado seria um quadrado
       cinza de 1024x1024 no cabeçalho do pedido — e nada no script acusaria
       erro. Medir a borda funciona para fundo branco, cinza ou colorido.

    Mediana e não média: um detalhe da arte encostando na borda desloca a média,
    a mediana ignora.
    """
    largura, altura = im.size
    borda = []
    for x in range(0, largura, 2):
        borda.append(im.getpixel((x, 0)))
        borda.append(im.getpixel((x, altura - 1)))
    for y in range(0, altura, 2):
        borda.append(im.getpixel((0, y)))
        borda.append(im.getpixel((largura - 1, y)))
    return tuple(int(statistics.median(p[c] for p in borda)) for c in range(3))


def processar(caminho):
    im = Image.open(caminho).convert("RGB")
    original = im.size
    fundo = cor_de_fundo(im)

    # Distância de cada pixel até o fundo, canal de maior diferença.
    # A rampa até TOLERANCIA preserva o antisserrilhado das bordas: com corte
    # seco, o contorno da logo sai escadeado no papel.
    diferenca = ImageChops.difference(im, Image.new("RGB", im.size, fundo))
    r, g, b = diferenca.split()
    alfa = ImageChops.lighter(ImageChops.lighter(r, g), b).point(
        lambda p: 0 if p <= PISO else min(255, (p - PISO) * 255 // (TOLERANCIA - PISO)))

    # Recorta pela máscara, não pelo brilho: arte exportada vem com muita sobra,
    # que no PDF vira um bloco vazio ocupando o cabeçalho. O limiar alto aqui
    # ignora o ruído de compressão, que de outro modo devolveria a imagem toda.
    caixa = alfa.point(lambda p: 255 if p > 128 else 0).getbbox()
    if caixa:
        im, alfa = im.crop(caixa), alfa.crop(caixa)

    im = im.convert("RGBA")
    im.putalpha(alfa)

    altura = round(im.size[1] * LARGURA_ALVO / im.size[0])
    im = im.resize((LARGURA_ALVO, altura), Image.LANCZOS)

    # Zera o RGB onde o pixel é 100% transparente — só DEPOIS de redimensionar.
    # Antes, a interpolação puxaria esse preto para dentro das bordas e a logo
    # sairia com um halo escuro. Feito aqui, não muda um pixel visível e o PNG
    # comprime muito melhor, porque a área invisível vira uma cor só.
    visivel = im.getchannel("A").point(lambda p: 255 if p else 0)
    im = Image.composite(im, Image.new("RGBA", im.size, (0, 0, 0, 0)), visivel)

    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return im, buf.getvalue(), original, fundo


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

        im, dados, original, fundo = processar(caminho)
        (PASTA / f"{nome}{SUFIXO_SAIDA}").write_bytes(dados)
        embutidas[nome] = base64.b64encode(dados).decode()
        print(f"  ✅ {nome:<12} {caminho.name}  {original[0]}x{original[1]} → "
              f"{im.size[0]}x{im.size[1]}  ({len(dados)/1024:.1f} KB)")
        print(f"     fundo detectado rgb{fundo} → transparente")

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
