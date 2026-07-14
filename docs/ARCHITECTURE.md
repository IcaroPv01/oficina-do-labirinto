# Arquitetura-alvo

## Princípios

1. O jogo final publicado é inteiramente estático e não depende de Python,
   Flask, subprocessos ou do computador doméstico; o Estúdio colaborativo é
   um serviço separado e sua indisponibilidade nunca derruba o jogo.
2. Editor e runtime compartilham o mesmo modelo de dados e a mesma simulação.
3. Regras de gameplay são determinísticas e testáveis sem renderização.
4. Conteúdo inválido nunca chega ao build ou substitui o último estado válido.
5. Nenhum segredo ou token é incluído no bundle do navegador.

## Estrutura

```text
game-data/              conteúdo padrão versionado
schemas/                contratos JSON e versões
web/
  src/core/             simulação determinística
  src/game/             cenas e renderização Phaser
  src/editor/           editor e preview
  src/storage/          autosave e import/export
packages/
  studio-contracts/     operações, papéis, revisões e estados compartilhados
studio-server/          colaboração, chat, IA e histórico no PC doméstico
web/tests/              testes de integração e navegador
.github/workflows/      validação e deploy
src/                    protótipo Python legado temporário
```

## Fluxo de dados

O editor modifica um `GameProject` validado. A prévia recebe uma cópia desse
objeto, reinicia a cena e nunca lê caminhos arbitrários do sistema operacional.
O autosave usa IndexedDB; importação e exportação usam um formato de projeto
versionado. No fluxo transitório, a sincronização ocorre por branches e pull
requests. No Estúdio, rascunhos e chat passam pelo servidor, mas uma mudança só
chega ao conteúdo versionado após proposta, sandbox, aprovação, branch, pull
request e CI. Consulte `STUDIO_ARCHITECTURE.md` e o `ROADMAP.md` da raiz.

## Gates

Estado em 13/07/2026: Gates 1 e 2 concluídos; Gate 3 entregue no escopo inicial
de projeto, histórico e publicação. A expansão do catálogo de conteúdo ainda é
trabalho futuro.

### Gate 1 — vertical slice

- uma sala;
- movimento e tiro;
- um inimigo;
- colisão e morte;
- troca de skin refletida imediatamente;
- build estático funcionando sob um caminho base de repositório.

### Gate 2 — MVP jogável

- dungeon determinística por seed;
- salas conectadas;
- drops e progressão;
- loja, tesouro e chefe;
- menu, pausa, morte e vitória;
- sessão de 30 minutos sem crescimento indefinido de memória ou entidades.

### Gate 3 — editor colaborativo

- importação, exportação e autosave;
- schemas e migrações;
- undo/redo;
- edição de assets, entidades e salas;
- validação em pull requests;
- deploy somente após todos os checks passarem.

Entregue agora: importação/exportação, autosave, schema v1, undo/redo, skin com
hash e licença, parâmetros da expedição, mapa, validação de PR e deploy
condicionado ao E2E. Pendente: migrações futuras e edição visual de catálogos
de entidades, itens e geometria das salas.

### Gate 4 — Estúdio compartilhado

- convite e papéis independentes do GitHub;
- projeto completo, presença e chat em tempo real;
- modos Computador e Celular sobre o mesmo estado;
- propostas com explicação e operações de domínio;
- chat Verboo sem chave no navegador;
- sandbox da revisão exata e aprovação exclusiva do dono;
- promoção por branch/PR, nunca escrita direta em `main`;
- backup/restore e operação no computador doméstico.
