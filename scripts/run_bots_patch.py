from pathlib import Path
import re

source_path = Path('scripts/apply_bots_patch.py')
source = source_path.read_text()

pattern = r"t = rep\(t, '      \{error && <div className=\\\"errorBox rpsLobbyError\\\">\{error\}</div>\\n    </section>;', .*?\"rps bot lobby\", 1\)\nsave\(path, t\)"
replacement = '''old = '      {error && <div className="errorBox rpsLobbyError">{error}</div>}\\n    </section>;'
new = '      {isHost && online === 1 && <div className="botPlayPanel rpsBotPanel"><div><strong>🤖 Affronter un bot</strong><small>Le bot choisit aussi pendant les 3 secondes.</small></div><select value={botDifficulty} onChange={(event) => setBotDifficulty(event.target.value as BotDifficulty)}><option value="easy">Facile</option><option value="normal">Normal</option><option value="hard">Difficile</option></select><button disabled={busy} onClick={() => void start(true)}>Jouer vs BOT</button></div>}\\n      {error && <div className="errorBox rpsLobbyError">{error}</div>}\\n    </section>;'
t = rep(t, old, new, "rps bot lobby", 1)
save(path, t)'''
source, count = re.subn(pattern, replacement, source, flags=re.S)
if count != 1:
    raise SystemExit(f'could not patch RPS lobby rule in migration script: {count}')

exec(compile(source, str(source_path), 'exec'))
