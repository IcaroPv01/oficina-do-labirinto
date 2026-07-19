# Roadmap — Oficina do Labirinto

Este arquivo é a fonte única do estado de execução do projeto. Ele registra o
que está pronto, o que está em andamento, a ordem das próximas tarefas e a
evidência necessária para considerar cada gate concluído.

Detalhes técnicos e decisões ficam em `docs/STUDIO_ARCHITECTURE.md`. Regras de
trabalho ficam em `docs/COLLABORATION.md`; segurança, em `docs/SECURITY.md`.

Última atualização: 18/07/2026, branch `codex/studio-foundation`.

## Regras que não podem regredir

- O jogo final permanece no GitHub Pages e funciona com o PC de casa desligado.
- Chat, sincronização e IA passam pelo `studio-server`; nenhuma chave entra no
  bundle, no Git ou no navegador do amigo.
- Toda mudança humana ou da IA vira proposta, é testada numa revisão imutável e
  exige aprovação do dono antes de chegar ao jogo final.
- A IA nunca aprova, publica, recebe shell ou escreve diretamente em `main`.
- Computador e celular são modos completos sobre o mesmo estado.
- O código é autoexplicativo: nomes claros, responsabilidades pequenas,
  contratos tipados, constantes nomeadas e comentários somente para intenção,
  invariantes e riscos que o código sozinho não revela.
- `.gamepack` é recuperação de emergência, não o fluxo diário.
- Adicionar o amigo como colaborador do GitHub é o último passo.

## Estado resumido

| Gate | Estado | Critério de conclusão |
|---|---|---|
| 0. Jogo web público | Concluído | Site publicado, `main` protegida e CI/Pages verdes |
| 1. Fundação do Estúdio | Concluído | Contratos, servidor, segredo local, banco e builds verdes |
| 2. Colaboração direta | Em validação final | Convite mobile integrado, projeto compartilhado, chat/presença e reconexão utilizáveis em duas sessões reais |
| 3. Proposta e sandbox | Concluído para dados estruturados | Candidata jogável e testada no desktop/mobile; assets aguardam R-203 |
| 4. Promoção segura | Pendente | Aprovação cria branch/PR; CI publica; rollback ensaiado |
| 5. IA aplicada | Parcial avançado | Chat, propostas auditáveis e comportamento prontos; sprites/PNG aguardam R-203 |
| 6. Operação doméstica | Pendente | PC antigo, túnel HTTPS, serviço automático e backup/restore verificados |
| 7. Colaborador GitHub | Bloqueado por design | Somente depois de três ciclos completos e auditoria final |

## Entregue e verificado

- [x] Repositório público, licença MIT e histórico legado preservado.
- [x] GitHub Pages: <https://icaropv01.github.io/oficina-do-labirinto/>.
- [x] `main` protegida por PR, aprovação e check `validate`.
- [x] Jogo/editor Phaser com dungeon, preview, autosave e `.gamepack` de emergência.
- [x] Contratos do Estúdio em `packages/studio-contracts`:
  - papéis, estados e transições;
  - operações de domínio sem JSON Patch irrestrito;
  - DSL segura de comportamento de inimigos;
  - revisão, teste, aprovação, chat, atividade e proveniência;
  - 98 testes aprovados, inclusive vínculos ator/revisão, arquivos do projeto e bloqueio de
    credenciais em metadados.
- [x] Fundação em `studio-server`:
  - HTTP/WebSocket e SQLite WAL;
  - convites de uso único, sessão opaca, cookie `HttpOnly`, CSRF e CORS exato;
  - snapshot otimista, explicação por revisão, chat, presença e auditoria;
  - gateway Verboo consultivo e limites técnicos;
  - proposta, teste, histórico imutável e aprovação por ID + SHA-256 exatos;
  - 23 testes de integração aprovados e smoke HTTP compilado.
- [x] Chave Verboo em `.env.local`, ignorada/não rastreada e com ACL restrita.
- [x] API Verboo validada sem imprimir a chave:
  - smoke real de modelos e chat consultivo com `applied=false` em 18/07/2026;
  - `pro/deepseek-v4-flash` — padrão, contexto 1.048.576;
  - `pro/glm-4.7-flash` — contexto 200.704;
  - `pro/qwen3.6-27b` — contexto 262.144.
- [x] Estúdio ligado ao servidor: convite somente em `#invite`, sessão/CSRF,
  seleção/criação de projeto, chat, IA, propostas e presença com reconexão.
- [x] Eventos WebSocket de chat, presença, revisão do projeto e propostas são
  validados antes de atualizar a tela.
- [x] Shell com modos `auto`, `desktop` e `mobile`, navegação por toque,
  comparação e aprovação bloqueada por revisão.
- [x] Controles reais de toque no Phaser: movimento, disparo, ação, pausa e
  reinício; teste mobile em retrato/paisagem criado.
- [x] Sandbox candidato no navegador:
  - clone imutável, operações tipadas, diff e checklist;
  - simulação limitada executada duas vezes para provar determinismo;
  - preview Phaser atual/candidato e evidência presa ao digest exato;
  - jogo real por toque e teste em 320 px e paisagem, sem sobreposição.
- [x] Propostas estruturadas da Verboo:
  - modos separados **Perguntar** e **Propor mudança**;
  - JSON validado localmente e nunca executado como código;
  - candidata marcada **NÃO APLICADA**, com operações e riscos;
  - autor, data, modelo, request ID e hash do prompt em atividade append-only;
  - aceite explícito cria somente um rascunho, sem testar, aprovar ou publicar.
- [x] Projeto completo visível no Estúdio, em modo somente leitura:
  - manifesto autenticado de 194 arquivos rastreados relevantes;
  - busca e grupos para código, jogo, documentação, assets e configuração;
  - viewer desktop/mobile com caminho, tamanho, SHA-256 e linhas;
  - PNG/JPEG/WebP/GIF isolados; SVG sempre exibido como texto inerte;
  - `.env`, chaves, bancos, `.git`, dependências, builds e links bloqueados.
- [x] Acesso remoto sem configuração diária da API:
  - `INICIAR-ESTUDIO.cmd` e `npm run studio:online` carregam o segredo local;
  - conector Cloudflare oficial baixado com verificação SHA-256;
  - processo do túnel recebe ambiente mínimo e nunca herda a chave Verboo;
  - health, versão, CORS e chegada ao edge verificados antes do convite;
  - UI do dono permanece local e independente do DNS público temporário;
  - botão **Convidar amigo** cria convite de editor e usa Web Share no celular;
  - token descartável fica apenas em `#invite` e sai da barra antes da rede.

## Em andamento agora

### R-101 — Ligar o shell ao servidor

Responsável: Luna/front-end.

- [x] rota pública “Estúdio compartilhado” e retorno ao jogo;
- [x] login por convite e sessão;
- [x] logout explícito na barra do Estúdio;
- [x] carregar/criar o projeto padrão;
- [ ] snapshot compartilhado com conflito visível;
- [x] chat e presença por WebSocket com reconexão;
- [x] seletor dos três modelos e chat consultivo;
- [x] preferência Computador/Celular preservada por dispositivo;
- [x] testes unitários, build e E2E dos dois modos.

Conclui quando duas sessões veem o mesmo projeto e chat, uma queda de conexão se
recupera sem perder o rascunho e nenhuma credencial aparece no bundle.

### R-102 — Ciclo de proposta, teste e aprovação

Responsável: Terra/backend.

- [x] CRUD de propostas usando os contratos compartilhados;
- [x] revisão candidata e digest canônico;
- [x] resultado de sandbox ligado ao digest exato;
- [x] edição posterior invalida teste e aprovação;
- [x] projeto-base desatualizado bloqueia aprovação;
- [x] somente o dono aprova; coautor testa e pede ajustes;
- [x] atividade auditável e testes negativos.

Conclui quando o servidor torna impossível aprovar um conteúdo diferente do que
foi testado.

### R-103 — Fechar QA mobile dos controles do jogo

Responsável: integração/QA.

- [x] alvos de toque e `any-pointer: coarse`;
- [x] dois ponteiros simultâneos para mover e atirar;
- [x] ativação assistiva e liberação ao perder foco/visibilidade;
- [x] jogo deixa de avançar enquanto a pessoa edita fora do preview;
- [x] rótulo Pausar/Continuar sincronizado;
- [x] rerodar E2E em 320 px, Pixel 5 e paisagem após a integração do shell;
- [x] confirmar zero sobreposição e zero rolagem horizontal.

## Concluído nesta etapa

### R-201 — Sandbox funcional no navegador

- [x] aplicar operações a um clone imutável do `GameProject`;
- [x] validar Zod/schema, IDs, referências e limites;
- [x] bloquear operações de asset enquanto a quarentena R-203 não existe;
- [x] executar simulação determinística com limites de passos e entidades;
- [x] montar preview marcado como **CANDIDATO**;
- [x] comparar atual/candidato e guardar checklist/evidência;
- [x] aprovar somente o digest devolvido pelo backend.

### R-202 — IA que propõe sem aplicar

- [x] prompt recebe somente o contexto selecionado;
- [x] resposta em JSON estrito validada como operações de domínio;
- [x] comportamento de mob usa a DSL permitida e runtime determinístico;
- [x] resultado entra em proposta isolada e nunca no jogo final;
- [x] registrar modelo, autor, data, prompt hash e riscos;
- [x] testar respostas inválidas, grandes ou maliciosas.

## Próximas tarefas, em ordem

### R-203 — Sprites e tratamento de PNG

A API Verboo Code documenta chat/modelos, não uma rota de geração de imagem.
Portanto a primeira entrega usa:

- sprite pixel-art como DSL de paleta, dimensões, frames e pixels indexados,
  produzida pelo modelo de texto e renderizada localmente;
- limpeza determinística: recorte, alpha threshold, remoção de cor,
  nearest-neighbor e reencodificação;
- quarentena, SHA-256, limites, proveniência e revisão de licença;
- comparação antes/depois e teste dentro do jogo.

### R-204 — GitHub App e promoção

- GitHub App com acesso apenas a este repositório e permissões mínimas;
- criar branch e draft PR a partir da proposta aprovada;
- CI obrigatório, `main` sem escrita direta e notificação de falhas;
- merge somente pelo dono;
- rollback para a última versão publicada.

### R-205 — Instalar no computador de casa

- confirmar sistema operacional, CPU, RAM, espaço e estabilidade de rede;
- [x] iniciador temporário instala e verifica `cloudflared` automaticamente;
- instalar Node 24 e trocar o Quick Tunnel por túnel nomeado persistente;
- dar ao Estúdio um domínio/origem dedicado, separado dos demais sites Pages;
- serviço sem privilégios e inicialização automática;
- hostname HTTPS persistente sem abrir portas no roteador;
- backup diário de SQLite/assets e restauração testada;
- monitorar CPU, memória, disco e reconexão por 24 horas.

### R-206 — Aceite real de duas pessoas

- três ciclos proposta → teste → aprovação → PR → Pages;
- pelo menos um conflito simultâneo resolvido;
- teste em computador, celular retrato e celular paisagem;
- queda do PC/túnel sem afetar o jogo publicado;
- rollback e restauração ensaiados.

### R-999 — Último passo

- [ ] adicionar o amigo como colaborador do GitHub;
- [ ] revisar permissões dele e repetir um PR pequeno de treinamento.

## Comandos de evidência

Gate local em 18/07/2026:

- web: 28 arquivos e 158 testes unitários;
- contratos: 98 testes;
- servidor: 23 testes;
- iniciador remoto: 18 testes;
- navegador: 14 cenários E2E, incluindo convite público, arquivos, candidata
  jogável, IA e mobile em retrato/paisagem;
- smoke real da Verboo, Quick Tunnel HTTPS/CORS e navegador em 320×700
  aprovados sem expor credenciais;
- typecheck, conteúdo e builds aprovados.

Antes de marcar um item técnico como concluído:

```powershell
npm run check
npm run test:e2e
git diff --check
```

Para o servidor, também verificar que `.env.local` continua ignorado e que uma
busca no conteúdo rastreado não encontra prefixos de chave, cookies ou tokens.
