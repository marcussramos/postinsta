# postinsta

Artes do @frasesdefunkwow, hospedadas aqui para o Metricool agendar no Instagram.

- `posts/` — artes prontas (JPEG 1080×1350). Cada arquivo vira um link público em
  `https://raw.githubusercontent.com/marcussramos/postinsta/main/posts/NOME.jpg`
- `templates/card.html` — padrão visual do card de frase (fundo grafite, destaque verde-neon, Inter Black).
- `render.py` — gera um card: `python render.py "texto|destaque" posts/arquivo.jpg "TAG" 168`

O repositório precisa continuar **público** para o Metricool conseguir baixar as imagens.

## Pauta (pasta `app/`)

Sistema próprio de agendamento: painel da agência, link de aprovação por cliente e publicação automática no Instagram pela API oficial da Meta.
Guia de instalação: [`app/SETUP.md`](app/SETUP.md).
