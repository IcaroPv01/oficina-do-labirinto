# Fluxo de colaboração

## Preparação

1. O proprietário cria o repositório no GitHub, mas ainda não adiciona o amigo
   como colaborador.
2. A branch `main` recebe proteção: pull request obrigatório e checks de CI.
3. GitHub Pages usa a origem **GitHub Actions**.
4. O amigo entra primeiro como **Coautor do Estúdio**, sem credenciais do
   repositório. A colaboração GitHub será o último passo, depois de o fluxo
   proposta, sandbox, aprovação e rollback estar comprovado.

## Recuperação de emergência

O `.gamepack` não é o transporte diário entre as duas pessoas. Ele existe para
backup, recuperação e importação de um projeto legado. Quando necessário:

1. exporte uma cópia no editor;
2. guarde-a fora do repositório;
3. para restaurá-la no conteúdo versionado, aplique-a numa branch isolada:

   ```powershell
   npm run content:apply -- C:\caminho\meu-projeto.gamepack
   ```

4. revise `game-data/default-project.json`;
5. execute `npm run check` e abra um pull request;
6. mescle somente após validação e revisão.

## Regras para evitar conflitos

- Uma mudança de conteúdo por branch sempre que possível.
- IDs nunca são reaproveitados para outro objeto.
- Remoções e mudanças de schema exigem migração.
- Assets usam nome estável, hash e origem documentada.
- Uma skin marcada como “licença ainda não confirmada” não deve entrar em um
  repositório público; escolha a licença no inspetor antes do pull request.
- Nenhum token, senha ou arquivo `.env` vai para o Git.

O editor não grava diretamente no GitHub. Isso evita colocar credenciais no
JavaScript público e mantém revisão e histórico como parte obrigatória do
processo.

## Trabalho diário no Estúdio

O Estúdio já fornece convite, sessão, projeto, chat, presença, IA consultiva e
revisão segura de propostas. O fluxo-alvo, concluído por etapas, é:

1. o dono abre `INICIAR-ESTUDIO.cmd` e mantém essa janela ligada;
2. em **Convidar amigo**, usa Compartilhar ou Copiar link;
3. o coautor abre o link no computador ou celular e informa somente seu nome;
4. ambos consultam o projeto completo no explorador e registram no chat o que
   fizeram e por quê;
5. criam uma proposta humana ou uma candidata estruturada da IA;
6. marcam a revisão como pronta e testam exatamente essa versão no sandbox;
7. o dono solicita ajustes, rejeita ou aprova;
8. a automação futura cria branch e pull request;
9. CI, revisão e proteção da `main` controlam a publicação.

O jogo publicado nunca é substituído por autosave ou chat. Uma edição posterior
invalida testes e aprovações anteriores. Consulte `STUDIO_ARCHITECTURE.md`.

## Publicação inicial

1. Defina o nome, a visibilidade e a licença do repositório.
2. Confirme a proveniência dos assets que serão versionados.
3. Adicione o remoto e envie `main` e a tag `legacy-antigravity`.
4. No GitHub, selecione **GitHub Actions** como origem do Pages.
5. Proteja `main` exigindo o check `validate` e limite o ambiente
   `github-pages` à branch `main`.
6. Faça uma mudança de teste por branch e confirme que o merge só publica após
   unitários, build e E2E passarem.
7. Adicione o amigo como colaborador somente depois de validar três ciclos
   completos pelo Estúdio e ensaiar uma restauração/rollback.

Um project site comum (`proprietário/repositório`) recebe automaticamente a
base `/<repositório>/`; um user site (`proprietário.github.io`) usa `/`. Para
um domínio próprio apontado à raiz, crie no repositório a variável de Actions
`VITE_BASE_PATH` com o valor `/`.

O computador antigo não precisa servir o site. O GitHub Pages entrega os
arquivos; o computador precisa apenas de um navegador para jogar e, caso vá
editar o código localmente, Node.js compatível com a versão declarada no
`package.json`.
