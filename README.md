# Damas Jeff

Jogo de damas brasileiras, escrito do zero. Duas versões com as mesmas regras e a mesma IA:

- **Web** (`docs/`): abre no navegador do computador ou do celular, sem instalar nada.
  Publicada em https://jefferstosprojeto.github.io/damas-jeff/
- **Windows** (`damas/`, Python + tkinter): gera o `Damas Jeff.exe`.

## Recursos

- Regra oficial brasileira (peça simples captura para trás, dama voadora, lei da maioria)
  e variante opcional em que a peça simples não inicia a captura para trás.
- Contra o computador em 5 níveis: Iniciante, Amador, Intermediário, Experiente, Profissional.
- Torneio: eliminatória de 8 fases contra adversários cada vez mais fortes.
- Dois jogadores no mesmo aparelho.
- Voltar e avançar jogadas, salvar/abrir jogos (10 posições), editar tabuleiro,
  records por nível (menor tempo de vitória).
- **Web:** partida com um amigo por link (ex.: WhatsApp), PC x celular, via WebRTC (PeerJS).
  Revanche com cores trocadas, desistência e reconexão pelo mesmo link.
- **Windows:** partida em rede local / internet por IP (porta 5577).

Dados locais: na web ficam no navegador (`localStorage`); no Windows, em `%APPDATA%\DamasJeff`.

## Versão Windows

```sh
python main.py                                   # rodar pelo Python
python -m unittest discover -s tests -t .        # testes das regras e da IA
python -m tests.gui_smoke                        # teste automatizado da interface
python -m PyInstaller --onefile --windowed --name "Damas Jeff" main.py   # gera "dist/Damas Jeff.exe"
```

## Versão web

Arquivos estáticos em `docs/` (servidos pelo GitHub Pages). Para testar localmente:

```sh
python -m http.server 8765 --directory docs      # abrir http://127.0.0.1:8765/
```

`docs/engine.js` e `docs/ai.js` são traduções fiéis de `damas/engine.py` e `damas/ai.py`.
