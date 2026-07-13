# Fluxo de colaboração

## Preparação

1. O proprietário cria o repositório no GitHub e adiciona o amigo como
   colaborador.
2. A branch `main` recebe proteção: pull request obrigatório e checks de CI.
3. GitHub Pages usa a origem **GitHub Actions**.

## Trabalho diário

1. Atualize `main` antes de começar.
2. Crie uma branch pequena, por exemplo `content/inimigo-morcego`.
3. Abra o editor local ou a versão publicada.
4. Importe o projeto, altere e teste no preview.
5. Exporte o `.gamepack` e aplique-o ao conteúdo versionado:

   ```powershell
   npm run content:apply -- C:\caminho\meu-projeto.gamepack
   ```

6. Revise a alteração em `game-data/default-project.json`.
7. Execute `npm run check`.
8. Faça commit e abra um pull request.
9. Mescle somente após validação e revisão.

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

## Publicação inicial

1. Defina o nome, a visibilidade e a licença do repositório.
2. Confirme a proveniência dos assets que serão versionados.
3. Adicione o remoto e envie `main` e a tag `legacy-antigravity`.
4. No GitHub, selecione **GitHub Actions** como origem do Pages.
5. Adicione o colaborador, proteja `main` exigindo o check `validate` e limite
   o ambiente `github-pages` à branch `main`.
6. Faça uma mudança de teste por branch e confirme que o merge só publica após
   unitários, build e E2E passarem.

Um project site comum (`proprietário/repositório`) recebe automaticamente a
base `/<repositório>/`; um user site (`proprietário.github.io`) usa `/`. Para
um domínio próprio apontado à raiz, crie no repositório a variável de Actions
`VITE_BASE_PATH` com o valor `/`.

O computador antigo não precisa servir o site. O GitHub Pages entrega os
arquivos; o computador precisa apenas de um navegador para jogar e, caso vá
editar o código localmente, Node.js compatível com a versão declarada no
`package.json`.
