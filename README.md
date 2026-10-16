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
- **Web:** uma sala online única, sempre no mesmo link
  (https://jefferstosprojeto.github.io/damas-jeff/#sala), PC x celular, via WebRTC (PeerJS).
  Dois jogam, os demais ficam na fila assistindo; quem ganha fica.
  Cada aparelho tem uma chave própria: quem cai tem 60 s para voltar ao mesmo lugar, e
  outra pessoa com o link não pega a vaga. A sala vive no navegador de quem chegou primeiro;
  se essa pessoa sair, outro participante assume sozinho e a sala continua de onde estava.
  Abas do mesmo navegador não se duplicam: a última aberta assume.
  (`?sala=nome` cria uma sala separada, só para testes.)
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
A lógica da sala (`docs/room.js`) é testada com `node tests/room.test.js`.
