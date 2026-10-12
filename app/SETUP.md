# Pauta — guia de instalação

O Pauta é o seu sistema de posts: você cria o post, o cliente aprova pelo link, e o post é publicado sozinho no Instagram no horário marcado.

São 4 etapas. Reserve umas 2 horas para a primeira vez (sem contar a análise da Meta).

| Etapa | Onde | Custo |
|---|---|---|
| 1. Banco de dados e imagens | Supabase | Grátis (500 MB de dados, 1 GB de imagens) |
| 2. Hospedar o app | Vercel | Grátis para testar · **Pro US$ 20/mês para uso comercial** (veja a observação abaixo) |
| 3. App na Meta (Instagram) | developers.facebook.com | Grátis |
| 4. Agendador | Supabase | Grátis |

> **Observação sobre a Vercel:** o plano gratuito (Hobby) é para uso pessoal e não comercial, pelos termos da Vercel. Teste no Hobby e, quando for atender clientes pagantes, mude para o Pro.

---

## Etapa 1 — Supabase (banco de dados e imagens)

1. Crie uma conta em **supabase.com** e clique em **New project**.
   - Nome: `pauta` · Região: **South America (São Paulo)** · Crie e guarde a senha do banco.
2. Quando o projeto estiver pronto, abra **SQL Editor → New query**.
3. Copie todo o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql), cole e clique em **Run**. Deve aparecer "Success".
4. Vá em **Project Settings → API** e anote:
   - **Project URL**, que vai na variável `SUPABASE_URL`
   - A chave **service_role** (clique em "Reveal"), que vai na variável `SUPABASE_SERVICE_KEY`

   ⚠️ A chave `service_role` dá acesso total ao banco. Nunca mande essa chave para ninguém e nunca coloque no código.

---

## Etapa 2 — Vercel (hospedar o app)

1. Crie uma conta em **vercel.com** entrando com o GitHub.
2. Clique em **Add New → Project** e importe o repositório **postinsta**.
3. Na tela de configuração:
   - **Root Directory:** clique em Edit e escolha `app`
   - **Framework Preset:** `Other`
   - Build Command e Output Directory: deixe vazios
4. Abra **Environment Variables** e adicione:

| Nome | Valor |
|---|---|
| `APP_URL` | o endereço do app, ex.: `https://pauta-marcus.vercel.app`. Na primeira vez você ainda não sabe: coloque qualquer valor, publique e depois corrija |
| `ADMIN_PASSWORD` | a senha para entrar no painel. Use uma senha forte |
| `SESSION_SECRET` | um texto aleatório de 40 caracteres ou mais |
| `CRON_SECRET` | outro texto aleatório de 40 caracteres ou mais |
| `SUPABASE_URL` | da Etapa 1 |
| `SUPABASE_SERVICE_KEY` | da Etapa 1 |
| `IG_APP_ID` | da Etapa 3 (por enquanto, coloque `pendente`) |
| `IG_APP_SECRET` | da Etapa 3 (por enquanto, coloque `pendente`) |
| `APP_TIMEZONE` | `America/Cuiaba` |

   Para gerar os textos aleatórios, use um gerador de senhas (do navegador ou do seu gerenciador de senhas), com 40 caracteres ou mais.

5. Clique em **Deploy**. Quando terminar, copie o endereço (`https://...vercel.app`), corrija o `APP_URL` em **Settings → Environment Variables** e faça **Redeploy**.
6. Abra o endereço e entre com o `ADMIN_PASSWORD`. Se faltar alguma variável, o painel mostra um aviso amarelo dizendo qual é.

---

## Etapa 3 — App na Meta (conexão com o Instagram)

Os nomes dos menus da Meta mudam com frequência. Se algum não bater exatamente, procure o equivalente.

### 3.1 Criar o app
1. Acesse **developers.facebook.com** e entre com seu Facebook. Se for a primeira vez, cadastre-se como desenvolvedor.
2. **Meus apps → Criar app**.
3. No caso de uso, escolha a opção do Instagram para **gerenciar mensagens e conteúdo no Instagram**.
4. Tipo do app: **Empresa (Business)**. Vincule ao seu Portfólio Empresarial, ou crie um com o seu CNPJ.

### 3.2 Configurar o login do Instagram
1. No app, abra o caso de uso do Instagram e vá em **Configuração da API com login do Instagram**.
2. Anote o **ID do app do Instagram** e a **Chave secreta do app do Instagram**. Eles vão em `IG_APP_ID` e `IG_APP_SECRET` na Vercel. Atenção: não são o ID do app do Facebook, que fica no topo da página.
3. Em **Configurar o login empresarial do Instagram → URLs de redirecionamento OAuth**, adicione:
   ```
   https://SEU-APP.vercel.app/api/ig/callback
   ```
4. Confira se as permissões `instagram_business_basic` e `instagram_business_content_publish` estão no caso de uso.
5. Volte na Vercel, atualize `IG_APP_ID` e `IG_APP_SECRET` e faça **Redeploy**.

### 3.3 Liberar os perfis dos clientes (modo de desenvolvimento)
Enquanto a Meta não aprova o app, ele só publica em perfis cadastrados como **testadores**:

1. No app da Meta, vá em **Funções do app → Funções → Adicionar pessoas → Testador do Instagram** e digite o @ do cliente.
2. O cliente aceita o convite: no navegador, em **instagram.com → Configurações → Apps e sites → Convites de testador**.
3. O perfil precisa ser **Profissional** (Comercial ou Criador de conteúdo).
4. Conecte o perfil de um destes dois jeitos:
   - **O próprio cliente conecta (recomendado):** mande o link de aprovação. Enquanto o Instagram dele não estiver conectado, a página mostra o botão **Conectar Instagram**. Ele entra direto no Instagram e você não precisa da senha dele.
   - **Você conecta:** no painel, em **Clientes → Conectar Instagram**, faça login com a conta do cliente e aceite as permissões.

Isso já atende seus 10 clientes enquanto a análise da Meta (3.4) não sai.

### 3.4 Pedir a aprovação da Meta (para funcionar com qualquer perfil)
1. **Verificação da empresa:** em **business.facebook.com → Configurações → Central de segurança → Verificação da empresa**, envie os dados do CNPJ e um comprovante.
2. Em **Configurações do app → Básico**, preencha:
   - **URL da Política de Privacidade:** `https://SEU-APP.vercel.app/privacidade`
     (antes, troque os campos entre colchetes no arquivo `public/privacidade.html` pelos seus dados)
   - **Instruções de exclusão de dados:** a mesma URL
   - Ícone e categoria do app
3. Em **Análise do app → Permissões e recursos**, peça **Acesso avançado** para `instagram_business_basic` e `instagram_business_content_publish`.
   - Grave um vídeo de tela mostrando: conectar um Instagram, criar um post, o cliente aprovar e o post aparecer publicado.
   - Explique o uso em uma frase, por exemplo: *"Agência de social media publica posts aprovados pelos próprios clientes nos perfis deles."*
4. A análise costuma levar de alguns dias a algumas semanas. Se a Meta recusar, ela diz o motivo. Me mande o texto e eu ajusto o que for preciso.

---

## Etapa 4 — Agendador (publicação automática a cada 5 minutos)

1. No Supabase, abra o **SQL Editor** e cole o bloco do final do `schema.sql` que começa em `create extension if not exists pg_cron;`.
2. Tire os `--` do começo das linhas e troque:
   - `SEU-APP.vercel.app` pelo endereço do app
   - `SEU_CRON_SECRET` pelo mesmo valor do `CRON_SECRET` da Vercel
3. Clique em **Run**. Para conferir, rode `select * from cron.job;`, que deve listar `pauta-publicador`.

Como reserva, a Vercel também chama o publicador uma vez por dia (configurado no `vercel.json`).

---

## Como usar no dia a dia

1. **Clientes → + Novo cliente.** Cadastre o nome e o WhatsApp de quem aprova, depois clique em **Conectar Instagram**.
2. **+ Novo post.** Escolha a imagem (o Pauta já ajusta para o formato do Instagram), escreva a legenda e defina a data e a hora.
3. **Enviar para aprovação.** Mande o **link fixo** do cliente pelo botão do WhatsApp. O link é sempre o mesmo, então ele pode salvar nos favoritos.
4. O cliente abre o link no celular e toca em **Aprovar** ou **Pedir ajuste**. A agenda atualiza sozinha.
5. **Aprovado = publicado no horário.** Você não precisa fazer mais nada.
6. Se o cliente pedir ajuste, o pedido aparece em vermelho na agenda. Edite o post e clique em **Salvar e reenviar**.

### Regras que vale saber
- Mudar imagem ou legenda de um post aprovado faz ele voltar para rascunho, para o cliente aprovar a versão nova. Mudar só a data ou a hora mantém a aprovação.
- Se o horário passar sem aprovação, o post **não** é publicado. Ele fica marcado como "Horário já passou" para você remarcar.
- O token do Instagram vale 60 dias e é renovado sozinho. Se um cliente trocar a senha ou remover o acesso, o card dele mostra **Reconectar Instagram**.
- Se der erro na publicação, o post vira **Falhou** e mostra o motivo, com o botão **Tentar de novo**. Erros temporários do Instagram são tentados de novo automaticamente, até 3 vezes.
- Limite da Meta: 100 posts publicados pela API por perfil a cada 24 horas.

---

## Para quem for mexer no código

- Sem dependências: o backend são as funções em `api/`, em Node 20+, e o painel é JavaScript puro em `public/`.
- Teste local com Supabase e Instagram simulados: `node test/dev-server.js` e abra http://localhost:4321 (senha `senha-teste`).
- Testes automáticos: `npm test`.
