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
