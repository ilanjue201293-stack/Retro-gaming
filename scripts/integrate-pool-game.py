from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

retro = Path("app/RetroApp.tsx")
text = retro.read_text()
text = replace_once(text, 'import DunkshotGame from "./DunkshotGame";\n', 'import DunkshotGame from "./DunkshotGame";\nimport PoolGame from "./PoolGame";\n', "Pool import")
text = replace_once(text, '            <DunkshotGame room={room} user={user}/>\n', '            <DunkshotGame room={room} user={user}/>\n            <PoolGame room={room} user={user}/>\n', "Pool room mount")
old_card = '''          <div className="gameLibraryCard">
            <div className="gameLibraryIcon dunkMiniIcon">🏀</div>
            <div><small>ARCADE · SOLO / 1V1</small><h3>Dunkshot</h3><p>Charge ton tir en tirant vers le bas, vise avec l'angle et enchaîne les paniers. Le panier devient mobile quand ta série monte.</p></div>
            <button className="primaryButton" disabled={roomBusy} onClick={() => void createRoom()}>Créer une room</button>
          </div>'''
new_card = old_card + '''
          <div className="gameLibraryCard">
            <div className="gameLibraryIcon poolMiniIcon">🎱</div>
            <div><small>BILLARD · SOLO / 1V1</small><h3>Billard</h3><p>Vraie table 8-ball arcade : collisions, bandes, poches, puissance et duel pleines contre rayées.</p></div>
            <button className="primaryButton" disabled={roomBusy} onClick={() => void createRoom()}>Créer une room</button>
          </div>'''
text = replace_once(text, old_card, new_card, "Pool library card")
retro.write_text(text)

layout = Path("app/layout.tsx")
text = layout.read_text()
text = replace_once(text, 'import "./dunkshot.css";\n', 'import "./dunkshot.css";\nimport "./pool.css";\n', "Pool stylesheet")
layout.write_text(text)

readme = Path("README.md")
text = readme.read_text()
needle = "- Dunkshot : solo ou 1v1 tour par tour, tir à la puissance et à l'angle, vies configurables, panier mobile et difficulté progressive\n"
if needle in text and "- Billard :" not in text:
    text = text.replace(needle, needle + "- Billard : solo ou 1v1 8-ball arcade, collisions, bandes, poches et groupes pleines/rayées\n", 1)
readme.write_text(text)

print("Pool integrated")
