# Projeto de jogo colaborativo

Este repositório está sendo reconstruído como um jogo e editor web estáticos,
publicáveis no GitHub Pages e utilizáveis em computadores modestos.

## Estado atual

- `src/`, `main_script.py` e `JogoMedieval.spec` contêm o protótipo legado em
  Python/Pygame recuperado do Antigravity.
- `web/` será o produto principal: Phaser 4, TypeScript e Vite.
- `game-data/` conterá conteúdo versionado e validado.
- `schemas/` conterá os contratos dos arquivos de projeto.
- `docs/` registra arquitetura, decisões e critérios de aceite.

O Flask, o launcher Tkinter e o executável PyInstaller não fazem parte da
arquitetura de publicação. Eles são mantidos temporariamente como referência.

## Segurança e publicação

O servidor Flask legado não deve ser exposto na rede. Ele contém endpoints sem
autenticação, operações de arquivo e execução de processos locais.

Assets legados e checkouts de terceiros permanecem fora do histórico Git até a
conclusão da auditoria de licença e proveniência. O repositório deve permanecer
privado até que uma licença do projeto seja escolhida.

## Meta de colaboração

1. O editor web salva automaticamente no navegador.
2. Um projeto pode ser importado e exportado como pacote portátil.
3. Cada colaborador trabalha em sua própria branch.
4. Pull requests executam validação, testes e build.
5. O merge em `main` publica o jogo no GitHub Pages.

## Executar localmente

Requer Node.js 24 ou superior apenas para desenvolvimento. Quem acessa a versão
do GitHub Pages precisa somente de um navegador atualizado.

```powershell
npm ci
npm run dev
```

O terminal exibirá o endereço local. Para validar antes de abrir um pull
request:

```powershell
npm run check
npm run test:e2e
```

O build estático é produzido em `web/dist/`.

## Gate atual

A primeira vertical slice já inclui simulação determinística, movimento, tiro,
inimigos, dano, drops, sala limpa, preview Phaser, autosave, undo/redo, upload
de skin e importação/exportação `.gamepack`. Dungeon completa, loja, chefe e
progressão entre andares permanecem no próximo gate; o protótipo legado não é
considerado implementação desses recursos.

Consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para a arquitetura-alvo e
[docs/ANTIGRAVITY_CONTEXT.md](docs/ANTIGRAVITY_CONTEXT.md) para o histórico que
orienta a reconstrução. O fluxo de duas pessoas está em
[docs/COLLABORATION.md](docs/COLLABORATION.md) e as restrições de segurança em
[docs/SECURITY.md](docs/SECURITY.md).
