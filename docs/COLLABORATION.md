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
5. Exporte o `.gamepack` ou atualize os arquivos versionados correspondentes.
6. Execute `npm run check`.
7. Faça commit e abra um pull request.
8. Mescle somente após validação e revisão.

## Regras para evitar conflitos

- Uma mudança de conteúdo por branch sempre que possível.
- IDs nunca são reaproveitados para outro objeto.
- Remoções e mudanças de schema exigem migração.
- Assets usam nome estável, hash e origem documentada.
- Nenhum token, senha ou arquivo `.env` vai para o Git.

O editor não grava diretamente no GitHub. Isso evita colocar credenciais no
JavaScript público e mantém revisão e histórico como parte obrigatória do
processo.

