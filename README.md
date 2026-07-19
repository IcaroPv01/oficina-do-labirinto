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

O Estúdio também possui um explorador autenticado e somente leitura do código,
dados, documentação e configuração pública do projeto. Segredos, bancos,
dependências, builds e links do sistema de arquivos nunca entram no manifesto.

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

### Uso diário sem configurar a API

Depois que `studio-server/.env.local` existe neste computador, não há campo de
chave nem endereço para preencher. No Windows, dê dois cliques em
`INICIAR-ESTUDIO.cmd`; pela linha de comando, o equivalente é:

```powershell
npm run studio:online
```

O iniciador:

1. carrega a chave local diretamente no `studio-server`, sem entregá-la ao
   navegador ou ao processo do túnel;
2. baixa na primeira execução um `cloudflared` oficial e confere seu SHA-256;
3. abre um túnel HTTPS temporário sem expor portas do roteador;
4. confirma servidor, versão, CORS, IA e propagação em dois resolvedores DNS
   públicos antes de criar o convite — o primeiro início pode levar até três
   minutos;
5. abre a UI local do proprietário e prepara nela o link público do GitHub
   Pages para o amigo.

Dentro da interface, **Convidar amigo** cria o link de coautor. No celular ele
apenas abre o link, informa o nome e passa a usar chat, IA, arquivos do projeto
e sandbox pela sua API privada. A chave continua somente no computador de casa.

O endereço `trycloudflare.com` deste MVP é temporário: vale enquanto a janela do
iniciador estiver aberta e muda a cada reinício. O túnel nomeado e iniciado como
serviço, com hostname estável, continua no gate R-205 do roadmap.

### Primeira instalação em outro computador

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
