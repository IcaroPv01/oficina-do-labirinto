# Arquitetura do Estúdio compartilhado

## Objetivo

A Oficina do Labirinto terá dois produtos independentes:

1. o jogo final, estático e sempre disponível no GitHub Pages;
2. o Estúdio, conectado a um serviço leve no computador de casa para edição
   compartilhada, chat, assistência por IA, teste e aprovação.

O computador de casa não serve a versão publicada do jogo. Se ele estiver
desligado, o jogo final continua funcionando; somente colaboração, chat e IA
ficam temporariamente indisponíveis.

## Topologia

```text
GitHub Pages
  |-- jogo publicado a partir de main
  `-- interface do Estúdio
               |
               | HTTPS + WebSocket
               v
Cloudflare Tunnel (conexão iniciada pelo computador, sem abrir porta)
               |
               v
studio-server no computador de casa
  |-- autenticação, convites e papéis
  |-- projetos, revisões, chat e auditoria em SQLite
  |-- arquivos candidatos em quarentena
  |-- gateway da Verboo
  `-- promoção futura por GitHub App
               |
               v
branch -> pull request -> CI -> aprovação -> main -> GitHub Pages
```

GitHub Pages permanece estático e nunca recebe chaves, tokens, acesso ao banco
ou permissão de escrita no repositório.

## Papéis

- **Dono:** configura o Estúdio, convida pessoas, vê auditoria e segredos,
  aprova, publica e reverte.
- **Coautor do Estúdio:** vê o projeto completo, conversa, cria e edita
  propostas e usa a IA, mas não publica.
- **Testador:** executa o sandbox, registra evidências e pede ajustes.
- **IA:** recebe somente o contexto escolhido e produz resultados candidatos;
  nunca aprova, publica ou recebe ferramentas de sistema.

Ser coautor do Estúdio é independente de ser colaborador do GitHub. O convite
do repositório será deliberadamente o último passo.

## Unidade de trabalho: proposta de mudança

Nem uma pessoa nem a IA alteram diretamente o jogo publicado. Toda mudança
pertence a uma proposta com:

- revisão-base e hash do projeto-base;
- título, objetivo, explicação, riscos e autoria;
- operações tipadas de domínio;
- assets identificados por hash e com proveniência;
- testes automáticos e checklist manual;
- hash exato da revisão testada e aprovada;
- histórico imutável de eventos.

Fluxo normal:

```text
rascunho compartilhado
  -> pronto para teste
  -> em teste
  -> alterações solicitadas | rejeitado | aprovado
  -> publicando
  -> publicado
```

Qualquer edição após o teste invalida o resultado e a aprovação. Uma proposta
baseada numa versão antiga fica desatualizada e precisa ser atualizada e
testada novamente.

## Edição simultânea

O servidor é a fonte do rascunho compartilhado. Cada gravação informa a revisão
que o cliente leu; conflitos nunca sobrescrevem silenciosamente o trabalho de
outra pessoa. Presença e eventos usam WebSocket. A primeira versão favorece
edição simultânea de entidades diferentes e bloqueio curto de assets binários.

CRDT/Yjs pode ser usado posteriormente para texto e cursores simultâneos. O
modelo versionado de propostas continua sendo a fonte auditável de publicação,
mesmo quando um CRDT for adotado na interface.

O `.gamepack` continua existindo apenas como exportação de emergência e
recuperação, não como fluxo diário.

## Modos de interface

O Estúdio oferece dois layouts completos sobre o mesmo estado:

- **Computador:** explorer, editor/preview e inspetor/chat lado a lado, com
  atalhos de teclado e comparação ampla;
- **Celular:** uma área principal por vez, navegação inferior e gavetas, ações
  fixas alcançáveis com uma mão e controles de toque.

O modo **Automático** escolhe a apresentação pelo espaço disponível e pelo tipo
de ponteiro. A pessoa pode forçar Computador ou Celular, e a preferência fica
salva apenas naquele dispositivo. Trocar o layout não recarrega nem perde
rascunho, conversa, seleção ou sandbox.

Todos os fluxos funcionam em ambos os modos: convite, visão do projeto,
edição estruturada, chat, IA, upload/câmera, teste, comentário e revisão. No
celular em paisagem, o sandbox prioriza o jogo e exibe controles virtuais de
movimento e disparo. Não existem ações dependentes apenas de hover.

## Chat humano

Existem canais gerais e uma conversa por proposta. Mensagens podem referenciar
salas, entidades, assets e revisões. Uma mensagem importante pode ser promovida
a decisão, tarefa ou explicação da proposta; chat livre não substitui o registro
estruturado da mudança.

## Assistente Verboo

O provedor inicial é a Verboo Code, acessada pelo servidor em
`https://code.verboo.ai/router/v1`. A chave é lida somente de configuração local
ignorada pelo Git. O navegador nunca recebe a chave nem chama o provedor
diretamente.

Modos previstos:

1. **Perguntar:** explica o contexto concedido, sem alterar o projeto.
2. **Propor:** produz uma proposta estruturada e validável.
3. **Criar/tratar asset:** trabalha numa cópia em quarentena.
4. **Revisar:** aponta riscos e testes ausentes.

Mesmo sem custo por token no plano atual, o servidor impõe limites técnicos de
tamanho, duração e frequência para manter o computador responsivo.

Na integração atual, a Verboo aceita `json_object`, mas rejeita o formato
`json_schema`. Por isso o mesmo schema é enviado como instrução e a resposta
continua não confiável até passar pela validação Zod local. O servidor registra
um `proposalId`, autor, data, modelo, request ID, riscos e somente o SHA-256 do
prompt. O prompt bruto e a chave não entram na resposta, no log ou no SQLite.
Adicionar a candidata cria apenas um change set em rascunho ligado a esse ID.

### Comportamentos de inimigos

A primeira versão usa uma linguagem declarativa limitada, com ações como
perseguir, patrulhar, orbitar, manter distância, fugir e avançar. Parâmetros,
sensores e transições têm limites e usam o RNG determinístico do jogo. A IA não
gera JavaScript executável nessa fase.

### Sprites e PNG

Imagens geradas ou editadas ficam fora do projeto até serem aprovadas. Elas são
decodificadas, reencodificadas, limitadas por formato/dimensões/tamanho,
validadas pelo pipeline PNG existente e identificadas por SHA-256. Limpeza
simples (recorte, transparência, remoção de cor e redimensionamento pixel-art)
é determinística e não precisa de IA.

## Sandbox e aprovação

O sandbox recebe uma cópia imutável da revisão candidata. Ele valida schemas,
referências, comportamentos, assets e limites antes de abrir o preview Phaser.
O preview deixa claro que executa um candidato e permite comparar antes/depois.

A implementação do navegador limita a simulação automática a 600 passos, dez
segundos e 64 entidades, executa duas vezes para detectar não determinismo e
exige confirmação manual da prévia jogável. O Phaser é montado uma vez num host
estável e pausado quando a vista mobile sai do Sandbox. Em celular, o teste usa
os onze controles reais do jogo, inclusive movimento e tiro simultâneos; não
existe uma maquete separada que possa aprovar algo que não foi jogado.

O botão **Aprovar para o jogo** é exclusivo do dono e aprova o digest exato já
testado. A promoção futura cria uma branch e um pull request com uma GitHub App
de permissões mínimas. A proteção da `main` e o CI continuam sendo os gates
finais; nenhuma rota do Estúdio grava diretamente em `main`.

Código arbitrário, se for realmente necessário no futuro, só poderá executar
em runner descartável, sem segredos, sem rede, sem montagens do host e com
limites rígidos. Ele não será executado diretamente no computador doméstico.

## Segurança operacional

- servidor escuta em `127.0.0.1` por padrão;
- acesso externo somente por HTTPS através do túnel;
- origem CORS limitada ao Pages e aos endereços locais de desenvolvimento;
- sessões em cookies `HttpOnly`, `Secure` e `SameSite` adequados;
- convites de uso único, expiráveis e revogáveis;
- limites de payload, mensagens, uploads e conexões;
- logs sem cookies, tokens, prompts sensíveis ou chave do provedor;
- banco e assets com backup diário e teste periódico de restauração;
- processo executado por usuário sem privilégios;
- nenhum painel administrativo, SSH ou compartilhamento de arquivos exposto
  pelo túnel.

## Entregas

1. contratos de domínio, banco, configuração segura e servidor local;
2. autenticação, convites, papéis, presença e chat humano;
3. projeto completo, propostas sincronizadas e explicações;
4. sandbox imutável, teste e aprovação da revisão exata;
5. GitHub App, branch/PR, CI, publicação e rollback;
6. chat Verboo e propostas de comportamento validadas;
7. quarentena, limpeza e geração de assets;
8. testes dos modos Computador e Celular, inclusive retrato, paisagem, teclado
   virtual, toque múltiplo, reconexão e ausência de rolagem horizontal;
9. teste prolongado no computador de casa, backup/restore e três ciclos reais;
10. adicionar o amigo como colaborador do GitHub.
