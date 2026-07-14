# Segurança

## Produto web

- Não usa Flask, endpoints locais ou subprocessos.
- Não inclui tokens ou segredos no bundle.
- Importações são tratadas como dados não confiáveis e validadas antes do uso.
- Uploads aceitam apenas formatos e tamanhos explicitamente permitidos.
- PNGs passam por assinatura, estrutura de blocos, CRC, dimensões, limite de
  pixels, decodificação e SHA-256; APNG não é aceito.
- `.gamepack` importado repete a validação da skin antes de substituir o estado
  válido, inclusive no comando que aplica conteúdo ao repositório.
- HTML fornecido pelo projeto nunca é inserido com `innerHTML`.

## Estúdio compartilhado

- GitHub Pages nunca contém chave da Verboo, token GitHub, segredo de sessão ou
  credencial do túnel.
- A chave da Verboo existe apenas na configuração local do `studio-server`, em
  arquivo ignorado pelo Git ou no gerenciador de segredos do sistema.
- Chamadas de IA partem do backend autenticado. O navegador recebe somente a
  resposta filtrada ou uma proposta validável.
- Propostas da IA usam modo JSON no provedor e cruzam uma validação Zod
  estrita de operações de domínio; texto do modelo nunca é tratado como código.
- O prompt bruto não é devolvido nem persistido. A auditoria append-only guarda
  apenas SHA-256, autor, data, modelo, request ID limitado, riscos e candidata.
- A IA não recebe shell, filesystem, aprovação, publicação ou escrita em
  `main`.
- Convites são de uso único e sessões podem ser revogadas.
- O token descartável de convite aparece somente no fragmento `#invite` e é
  removido da barra após o resgate; ele não vai para o Pages, referrer ou logs
  HTTP. A URL do servidor não contém credenciais.
- Cookies externos usam `HttpOnly`, `Secure`, `SameSite=None` e `Partitioned`;
  mutações REST ainda exigem o token CSRF mantido apenas em memória.
- Toda aprovação referencia o digest exato da revisão testada; qualquer edição
  posterior invalida a aprovação.
- Aceitar uma candidata da IA cria somente um change set em rascunho ligado ao
  `proposalId`; não inicia teste, não aprova e não publica.
- Assets candidatos ficam em quarentena e repetem validação, reencodificação,
  hash e conferência de proveniência antes de serem promovidos.
- Código gerado não executa no processo do servidor. A primeira versão aceita
  apenas operações de domínio e comportamentos declarativos limitados.
- O serviço escuta em loopback e é exposto somente pelo túnel autenticado; não
  se abrem portas no roteador.
- Logs devem redigir cabeçalhos de autenticação, cookies, tokens e chaves.

## Protótipo legado

`src/web_launcher.py` é apenas referência e não deve ser exposto na rede. Não
altere o bind para `0.0.0.0`, não encaminhe a porta e não o publique por túnel.
Ele possui rotas de arquivo e execução de processos que não foram projetadas
para uso remoto.

## Relato de vulnerabilidade

Use a opção **Security → Report a vulnerability** do repositório para enviar um
relato privado. Não publique detalhes sensíveis em issues; se o formulário
privado estiver indisponível, abra apenas um pedido de contato sem incluir a
falha ou dados de exploração.
