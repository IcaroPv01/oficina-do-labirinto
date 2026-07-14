# Oficina do Labirinto

Este repositório está sendo reconstruído como um jogo e editor web estáticos,
publicáveis no GitHub Pages e utilizáveis em computadores modestos.

## Estado atual

- `src/`, `main_script.py` e `JogoMedieval.spec` contêm o protótipo legado em
  Python/Pygame recuperado do Antigravity.
- `web/` é o produto principal: Phaser 4, TypeScript e Vite.
- `game-data/` contém o conteúdo versionado e validado.
- `schemas/` contém os contratos dos arquivos de projeto.
- `packages/studio-contracts/` contém as operações, revisões e regras de
  aprovação compartilhadas pelo navegador e pelo servidor.
- `studio-server/` contém convites, sessões, sincronização, chat, propostas e
  o gateway privado da Verboo para o computador de casa.
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

## Colaboração

O botão **Abrir Estúdio** leva à interface compartilhada. Ela já suporta
convite de uso único, projeto completo, presença, chat humano, conversa
consultiva com a Verboo, propostas, testes registrados e aprovação da revisão
exata pelo dono. O jogo publicado continua estático no GitHub Pages e funciona
mesmo quando o servidor doméstico está desligado.

O `.gamepack` permanece como cópia de emergência. Edição estruturada no
sandbox, promoção automática por branch/PR e assets gerados pela IA estão
registrados como próximos gates no [ROADMAP.md](ROADMAP.md).

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

## Executar o Estúdio

Na primeira instalação do computador que hospedará o serviço:

```powershell
.\scripts\configure-studio.ps1
npm run studio:invite -- --role owner --hours 24
npm run studio:dev
```

O script pede a chave da Verboo sem exibi-la e grava somente o arquivo local
ignorado `studio-server/.env.local`. O token de convite aparece uma única vez;
ele deve entrar apenas no fragmento `#invite=...` do link do Estúdio. A chave
da API nunca entra no link, no navegador ou no Git.

Para acesso externo, o servidor deve continuar em `127.0.0.1` e ser exposto
por um túnel HTTPS iniciado pelo próprio computador, sem abrir portas no
roteador. Consulte [docs/STUDIO_ARCHITECTURE.md](docs/STUDIO_ARCHITECTURE.md).

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

O estado executável e a ordem das próximas tarefas ficam centralizados no
[ROADMAP.md](ROADMAP.md). Consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
para a arquitetura-alvo e
[docs/ANTIGRAVITY_CONTEXT.md](docs/ANTIGRAVITY_CONTEXT.md) para o histórico que
orienta a reconstrução. O fluxo de duas pessoas está em
[docs/COLLABORATION.md](docs/COLLABORATION.md) e as restrições de segurança em
[docs/SECURITY.md](docs/SECURITY.md).

## Licença

O código original está disponível sob a [licença MIT](LICENSE). Consulte
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para componentes de terceiros.
Assets legados ignorados pelo Git não são concedidos por esta licença.
