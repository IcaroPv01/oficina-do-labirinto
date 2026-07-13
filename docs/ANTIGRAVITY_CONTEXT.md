# Contexto recuperado do Antigravity

## Intenção original

Construir um roguelike de salas procedurais inspirado no ritmo de jogos como
Binding of Isaac, mas com identidade, arte e nomes próprios. O jogo deve ser
fácil de modificar e permitir que duas pessoas construam conteúdo juntas.

## Requisitos recorrentes na conversa

- dungeon procedural e progressão contínua;
- combate com movimento e tiro em direções independentes;
- inimigos, chefes, loja, tesouro, chaves, moedas e itens ativos;
- substituição visual de jogador, inimigos, itens e cenário;
- preview jogável semelhante a uma sandbox de engine;
- editor visual sem exigir alteração manual de código;
- execução e validação antes de declarar uma tarefa concluída.

## Problemas relatados pelo usuário

- sprites distorcidos ou ignorados;
- colisões permitindo atravessar paredes e portas;
- jogo que não inicia;
- miniaturas vazias;
- seleção de skin sem efeito;
- editor sem preview real;
- interface cortada ou difícil de usar.

Esses relatos são tratados como testes de regressão obrigatórios, não como
itens cosméticos.

## Decisão de reconstrução

O protótipo Python é uma fonte de regras e exemplos, não a base de publicação.
O produto principal será uma aplicação web estática com runtime e editor na
mesma stack. O histórico completo permanece no banco local do Antigravity; este
documento guarda somente os requisitos necessários ao desenvolvimento.

