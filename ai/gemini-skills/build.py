"""Geminiのスキルのページ（index.html）と、スキルごとのZIPを作る。

  python3 ai/gemini-skills/build.py

skills.json の並びで、各フォルダの SKILL.md と添えるファイルを確かめ、<名前>/<名前>.zip を作りなおす。
ZIP は .gitignore で本体には入らない。School_Stock_files/sync.sh で配布用のリポジトリへ送る。
"""
import html
import json
import pathlib
import re
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
URL = "https://a-tozak.github.io/School_Stock/ai/gemini-skills/"
SKIP = {"README.md", "prompt.md", "tameshi.md"}  # スキルの束には入れないもの


def front(skill_md):
    t = skill_md.read_text()
    m = re.match(r"---\n(.*?)\n---\n", t, re.S)
    assert m, f"{skill_md} の先頭に --- がありません"
    meta = dict(l.split(":", 1) for l in m.group(1).splitlines() if ":" in l)
    return {k.strip(): v.strip() for k, v in meta.items()}


def bundle(name):
    d = HERE / name
    files = sorted([d / "SKILL.md"] + [f for f in d.glob("*.md") if f.name not in SKIP | {"SKILL.md"}])
    meta = front(d / "SKILL.md")
    assert meta.get("name") == name, f"{name}: SKILL.md の name が {meta.get('name')}"
    assert meta.get("description"), f"{name}: description がありません"
    assert len(files) <= 5, f"{name}: スキルのファイルが {len(files)} 個（5つまで）"
    assert (d / "SKILL.md").stat().st_size <= 25_000, f"{name}: SKILL.md が25KBを超えています"
    with zipfile.ZipFile(d / f"{name}.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f"{name}/{f.name}")
    return files


def e(s):
    return html.escape(s, quote=True)


def card(s, i):
    name = s["name"]
    if s.get("external"):
        files_html = ""
        btns = (f'<a class="btn primary" href="{e(s["external"])}">ページをひらく</a>')
        src = ""
    else:
        files = bundle(name)
        rows = "".join(
            f'<li><a href="{name}/{f.name}" download>{f.name}</a><span>{e(s["files"].get(f.name, ""))}</span></li>'
            for f in files)
        files_html = (f'<details class="files"><summary>中のファイル（{len(files)}つ）</summary>'
                      f'<ul class="flist">{rows}</ul></details>')
        btns = (f'<a class="btn primary" href="{name}/{name}.zip" download="{name}.zip">スキルをダウンロード</a>'
                f'<button class="btn copy" type="button" data-src="{name}/prompt.md">プロンプトをコピー</button>'
                f'<button class="btn copy" type="button" data-src="{name}/tameshi.md" data-part>見本をコピー</button>')
        src = f'<p class="src">元にした実践：{e(s["moto"])}</p>'
    canvas = '<span class="tag">Canvasを使う</span>' if s.get("canvas") else ""
    img = HERE / "img" / f"{name}.webp"
    fig = (f'<figure class="zu"><img src="img/{name}.webp" width="1672" height="941" loading="lazy" alt="{e(s.get("alt", s["title"]))}"></figure>'
           if img.exists() else "")
    return f"""
      <article class="sk" id="{name}">
        <div class="sk-head"><span class="no">{i:02d}</span><h3 class="ja-phrase">{e(s["title"])}</h3><code>@{name}</code>{canvas}</div>
        {fig}
        <table class="dare">
          <tr><th>誰が助かるか</th><td class="ja-phrase">{e(s["dare"])}</td></tr>
          <tr><th>できるもの</th><td class="ja-phrase">{e(s["dekiru"])}</td></tr>
          <tr><th>使う場面</th><td class="ja-phrase">{e(s["bamen"])}</td></tr>
        </table>
        <div class="btns">{btns}</div>
        {files_html}{src}
      </article>"""


def main():
    data = json.loads((HERE / "skills.json").read_text())
    cards = "".join(card(s, i + 1) for i, s in enumerate(data["skills"]))
    page = (HERE / "template.html").read_text()
    for k, v in {"{{CARDS}}": cards, "{{COUNT}}": str(len(data["skills"])), "{{URL}}": URL}.items():
        assert k in page, k
        page = page.replace(k, v)
    (HERE / "index.html").write_text(page)
    print("index.html と ZIP", sum(1 for s in data["skills"] if not s.get("external")), "本を作りました")


if __name__ == "__main__":
    main()
