from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1))

replace_once(
    "app/layout.tsx",
    'import "./bots.css";\n',
    'import "./bots.css";\nimport "./dunkshot.css";\n',
    "layout css",
)

replace_once(
    "app/RetroApp.tsx",
    'import RpsGame from "./RpsGame";\n',
    'import RpsGame from "./RpsGame";\nimport DunkshotGame from "./DunkshotGame";\n',
    "RetroApp import",
)

replace_once(
    "app/RetroApp.tsx",
    '            <RpsGame room={room} user={user}/>\n',
    '            <RpsGame room={room} user={user}/>\n            <DunkshotGame room={room} user={user}/>\n',
    "RetroApp room game",
)

replace_once(
    "app/RetroApp.tsx",
    '<span className="availablePill">3 JEUX</span>',
    '<span className="availablePill">4 JEUX</span>',
    "library count",
)

rps_card = '''          <div className="gameLibraryCard">\n            <div className="gameLibraryIcon rpsMiniIcon">✊ ✋ ✌️</div>\n            <div><small>DUEL · 2 JOUEURS</small><h3>Pierre · Feuille · Ciseaux</h3><p>3 secondes pour choisir, puis Pierre, Feuille, Ciseaux et révélation simultanée.</p></div>\n            <button className="primaryButton" disabled={roomBusy} onClick={() => void createRoom()}>Créer une room</button>\n          </div>\n'''
dunk_card = rps_card + '''          <div className="gameLibraryCard">\n            <div className="gameLibraryIcon dunkMiniIcon">🏀</div>\n            <div><small>ARCADE · SOLO / 1V1</small><h3>Dunkshot</h3><p>Charge ton tir en tirant vers le bas, vise avec l'angle et enchaîne les paniers. Le panier devient mobile quand ta série monte.</p></div>\n            <button className="primaryButton" disabled={roomBusy} onClick={() => void createRoom()}>Créer une room</button>\n          </div>\n'''
replace_once("app/RetroApp.tsx", rps_card, dunk_card, "library card")

replace_once(
    "app/api/dunkshot/route.ts",
    'startedAt: Date.now() + 80',
    'startedAt: Date.now() + 280',
    "duel shot sync delay",
)

print("Dunkshot integrated")
