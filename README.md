# Projeto de jogo colaborativo

Este repositório está sendo reconstruído como um jogo e editor web estáticos,
publicáveis no GitHub Pages e utilizáveis em computadores modestos.

## Estado atual

- `src/`, `main_script.py` e `JogoMedieval.spec` contêm o protótipo legado em
  Python/Pygame recuperado do Antigravity.
- `web/` é o produto principal: Phaser 4, TypeScript e Vite.
- `game-data/` contém o conteúdo versionado e validado.
- `schemas/` contém os contratos dos arquivos de projeto.
- `docs/` registra arquitetura, decisões e critérios de aceite.

O Flask, o launcher Tkinter e o executável PyInstaller não fazem parte da
arquitetura de publicação. Eles são mantidos temporariamente como referência.

## Segurança e publicação

O servidor Flask legado não deve ser exposto na rede. Ele contém endpoints sem
autenticação, operações de arquivo e execução de processos locais.

Assets legados e checkouts de terceiros permanecem fora do histórico Git até a
conclusão da auditoria de licença e proveniência. O código original deste
repositório é distribuído sob a licença MIT; componentes de terceiros mantêm
suas próprias licenças e avisos.

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

Para transformar um `.gamepack` exportado pelo editor no conteúdo padrão que o
próximo build publicará:

```powershell
npm run content:apply -- C:\caminho\projeto.gamepack
```

## Gate atual

O MVP web já inclui simulação determinística em passo fixo, dungeon multi-sala,
movimento e tiro independentes, inimigos, dano, drops, portas, tesouro, loja,
chefe, moedas, chaves, progressão entre andares, vitória e modo sem fim. O
editor oferece preview Phaser, mapa navegável, configuração da expedição,
autosave, undo/redo, upload PNG validado e importação/exportação `.gamepack`.

O próximo gate amplia a edição visual de conteúdo: múltiplos arquétipos de
inimigo, itens, salas desenhadas pelo usuário, áudio e migrações de schema. O
protótipo legado permanece apenas como referência.

Consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para a arquitetura-alvo e
[docs/ANTIGRAVITY_CONTEXT.md](docs/ANTIGRAVITY_CONTEXT.md) para o histórico que
orienta a reconstrução. O fluxo de duas pessoas está em
[docs/COLLABORATION.md](docs/COLLABORATION.md) e as restrições de segurança em
[docs/SECURITY.md](docs/SECURITY.md).

## Licença

O código original está disponível sob a [licença MIT](LICENSE). Consulte
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para componentes de terceiros.
Assets legados ignorados pelo Git não são concedidos por esta licença.
