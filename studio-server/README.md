# Studio Server

Backend leve para colaboração em tempo real, histórico de revisões e conversa
consultiva com a IA do Verboo. Ele foi desenhado para rodar em um PC antigo e
ficar atrás de um túnel HTTPS. O jogo publicado continua independente no GitHub
Pages quando este servidor estiver desligado.

## Segurança por padrão

- escuta apenas em `127.0.0.1` por padrão;
- aceita somente origens CORS exatas, nunca `*`;
- guarda apenas o hash de tokens de sessão e convite no SQLite;
- usa cookie de sessão opaco, `HttpOnly`, mais token CSRF;
- mantém `VERBOO_API_KEY` exclusivamente no servidor;
- expõe código e documentação somente por uma lista de caminhos segura, sem
  aceitar `.env`, bancos, chaves, links simbólicos ou diretórios de build;
- não possui rota para aplicar mudanças da IA, promover conteúdo ou escrever no
  GitHub;
- limita bytes, mensagens e concorrência mesmo quando os tokens da IA não têm
  custo.

## Uso local

Se `.env.local` já estiver pronto, o fluxo diário é iniciado na raiz por
`INICIAR-ESTUDIO.cmd` ou `npm run studio:online`. O servidor, o túnel HTTPS, a
verificação de saúde e o convite de proprietário são encadeados sem pedir a
chave novamente. O botão **Convidar amigo** gera o link mobile dentro da UI.

Para preparar uma instalação nova:

1. Na raiz do projeto, rode `scripts/configure-studio.ps1` para gravar a chave
   de forma interativa; ou copie `.env.example` para `.env.local` e preencha a
   chave sem versionar o arquivo.
2. Instale dependências com `npm install` nesta pasta.
3. Rode `npm run dev`.
4. No primeiro uso, crie um convite de proprietário localmente:

   ```powershell
   npm run invite:create -- --role owner --hours 24
   ```

5. Resgate o token uma única vez pela interface ou por `POST /auth/invites/redeem`.

Em produção, use `STUDIO_COOKIE_SECURE=true`,
`STUDIO_COOKIE_SAME_SITE=none`, desative `STUDIO_DEV_AUTH_ENABLED` e exponha
somente o túnel HTTPS. Nunca encaminhe a porta do roteador diretamente.

Para desenvolvimento estritamente local por HTTP, use temporariamente
`STUDIO_COOKIE_SECURE=false`, `STUDIO_COOKIE_SAME_SITE=lax` e, se necessário,
`STUDIO_DEV_AUTH_ENABLED=true`. O servidor recusa essa combinação fora de um
host loopback.

O navegador de arquivos descobre automaticamente a raiz deste checkout. Em um
layout diferente, `STUDIO_PROJECT_ROOT` pode apontar explicitamente para ela;
esse caminho nunca é devolvido ao navegador.

## API inicial

- `GET /health`
- `POST /auth/invites/redeem`, `POST /auth/logout`, `GET /auth/me`
- `POST /api/invites` (somente proprietário)
- `GET|POST /api/projects`
- `GET /api/projects/:id/files` e `GET /api/projects/:id/files/content?path=...`
  para o manifesto e conteúdo somente leitura, ambos autenticados
- `GET|PUT /api/projects/:id/snapshot` com revisão base otimista
- `GET|POST /api/projects/:id/chat`
- `GET|POST /api/projects/:id/change-sets`
- `GET|PATCH /api/projects/:id/change-sets/:changeSetId`
- `POST .../:changeSetId/ready`, `/testing`, `/tests` e `/review`
- `GET /api/projects/:id/activity`
- `GET /api/ai/models`, `POST /api/ai/chat` (somente consultivo)
- `POST /api/ai/propose` exige `projectId`, `prompt` e um `model` quando não há
  modelo-padrão local; retorna metadados auditáveis e candidato JSON não aplicado
- `GET /ws?projectId=...` para presença, chat e notificações de revisão

Requisições mutáveis autenticadas exigem `X-Studio-CSRF` com o valor entregue
no login ou em `GET /auth/me`.

Mudanças aceitas pelo sandbox são comandos de domínio validados pelo pacote de
contratos; texto de script, shell e caminhos arbitrários não fazem parte do
formato. O `PATCH` exige o `baseVersion` retornado pelo detalhe para impedir que
uma edição concorrente sobrescreva outra. Cada edição gera uma candidata com novo digest e invalida o teste e a
revisão atuais. A aprovação exige `decision: "approve"`, papel `owner`, teste
aprovado para o mesmo `revisionId` e `revisionDigest`, e uma revisão base que
ainda seja a atual do projeto. `request-changes` e `reject` ficam registrados no
histórico imutável. Ainda não existe publicação ou escrita no GitHub.

`/api/ai/propose` solicita JSON ao provedor e usa o JSON Schema como instrução,
mas a fronteira de confiança é a validação local estrita, incluindo
`ChangeOperationsSchema`. O resultado não cria change set, não altera snapshot e
não possui acesso a qualquer caminho de aplicação; ele precisa entrar no fluxo
normal de revisão e sandbox por uma ação posterior do usuário. Cada resposta traz
um `proposalId` opaco que pode ser usado em `sourceProposalIds`, além de
`createdAt`, autor e proveniência limitada a `provider`, `model` e `requestId`.
O texto do prompt não é persistido: somente seu digest SHA-256 aparece na
atividade append-only `ai-proposal.created`.
