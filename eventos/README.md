# Eventos ECL

Organização dos eventos e projetos da Escola de Comércio de Lisboa **a partir das conversas de email**.

Ninguém precisa de preencher formulários nem de aprender regras. As pessoas combinam os eventos por email como
sempre fizeram e põem a caixa **eventos@eclisboa.net** em cópia. A aplicação lê essas mensagens com IA (Claude, da Anthropic)
e mantém, para cada evento:

- **Quem faz o quê**: um organograma com o responsável geral, as áreas (Logística, Comunicação…), o responsável e a equipa de cada área
- **Tarefas**: quem ficou com cada uma, prazos e o que já está feito
- **Decisões tomadas** e **dúvidas por resolver**
- **Ponto de situação**: um resumo em linguagem simples para quem chega agora, mais alertas (prazos a passar, tarefas sem dono, contradições)
- **Conversa**: o que cada mensagem trouxe de novo
- **Perguntar**: qualquer pessoa pode perguntar "quem trata do som?" e a IA responde com base no registo

Quem fica com uma tarefa recebe um email. Pode responder por palavras suas ("já está", "isto passa para a Marta") e
o evento atualiza-se sozinho. Às segundas de manhã cada pessoa recebe as suas tarefas pendentes.

## Como funciona por dentro

```
Gmail (caixa eventos@)
   │  a cada 10 minutos
   ▼
Sincronizar.js ── mensagens novas, agrupadas por conversa
   │
   ├─ a conversa já pertence a um evento?      → esse evento
   ├─ o assunto tem "[EVENTO] Nome"?           → esse evento (ou um novo)
   └─ senão, a IA decide: evento existente, evento novo ou ignorar
   │
   ▼
IA.js → Claude lê o estado do evento + as mensagens novas e devolve as alterações (JSON validado por esquema)
   │
   ▼
Nucleo.js aplica as alterações ao evento → Store.js grava na Google Sheet → WebApp mostra a toda a escola
```

| Ficheiro | O que faz |
|---|---|
| `Config.js` | Opções: domínios aceites, modelo de IA, avisos, resumo semanal |
| `Nucleo.js` | Lógica pura: limpeza de emails, modelo do evento, aplicação da análise, textos para a IA |
| `IA.js` | Chamadas à API do Claude |
| `Sincronizar.js` | Leitura do Gmail, avisos por email, resumo semanal, `instalar()` |
| `Store.js` | Gravação na Google Sheet (folhas Eventos, Tarefas, Registo, Conversas) |
| `WebApp.js` + `Index.html` | A página web da aplicação |
| `test/` | Testes (Node 18+): `npm test` |

Para ver a interface sem instalar nada, abra `Index.html` no navegador. Mostra dados de demonstração.

## Instalação (cerca de 15 minutos)

1. **Caixa dedicada.** Peça ao administrador do Google Workspace uma conta como `eventos@eclisboa.net`.
   Todos os passos seguintes fazem-se com sessão iniciada nessa conta.
2. **Projeto.** Em <https://script.google.com> crie um projeto novo chamado "Eventos ECL" e copie para lá os ficheiros
   `Config.js`, `Nucleo.js`, `IA.js`, `Store.js`, `Sincronizar.js`, `WebApp.js` (como ficheiros de script) e `Index.html` (como ficheiro HTML).
   Em *Definições do projeto* ative "Mostrar o ficheiro de manifesto appsscript.json" e substitua-o pelo deste repositório.
   Alternativa para quem usa terminal: `npx @google/clasp login`, `clasp create --type webapp`, `clasp push`.
3. **Chave da IA.** Crie uma chave em <https://platform.claude.com> e guarde-a em *Definições do projeto > Propriedades do script*
   com o nome `ANTHROPIC_API_KEY`. Nunca a escreva no código.
4. **Instalar.** No editor, escolha a função `instalar` e carregue em *Executar*. Aceite as permissões pedidas
   (ler e enviar email, criar a folha de cálculo, contactar a API externa). É criada a folha "Eventos ECL — dados"
   e a leitura automática a cada 10 minutos.
5. **Publicar.** *Implementar > Nova implementação > Aplicação Web*: executar como **eu**, acesso **qualquer pessoa em eclisboa.net**.
   Partilhe o endereço com a escola.
6. **Ajustar** `Config.js` se necessário: domínios aceites, administradores, desligar avisos ou o resumo semanal.

## Boas práticas para quem escreve

- Pôr **eventos@eclisboa.net em cópia** nas conversas sobre eventos. Conversas sem ligação a eventos são ignoradas.
- De preferência, uma conversa por evento. Para garantir o evento certo, comece o assunto por `[EVENTO] Nome do evento`.
- Escrever de forma clara quem faz o quê ajuda ("Rui, ficas com o som?", "eu trato dos convites até dia 10").
- Se a IA se enganar, corrija na app (marcar como feita, mudar responsável) ou responda ao email a explicar.

## Privacidade e custos

- O texto das mensagens enviadas para a caixa de eventos é enviado à API da Anthropic para análise. Por omissão, a Anthropic não usa
  dados da API para treinar modelos. Convém informar as pessoas e não usar esta caixa para dados sensíveis de alunos
  (saúde, situação familiar…). A folha de cálculo fica no Google Drive da conta de eventos.
- Só são lidos emails de remetentes em `DOMINIOS_PERMITIDOS` (por omissão, `eclisboa.net`).
- O custo depende do volume. Cada lote de mensagens de um evento é um pedido ao modelo `claude-opus-5-5`
  (esforço "medium"; a classificação e as perguntas usam esforço "low"). Pode acompanhar o gasto na consola da Anthropic.
- A coluna *Resultado* da folha **Registo** mostra o que aconteceu a cada email: analisado, ignorado e porquê, ou erro.

## Limitações conhecidas

- Os emails só são lidos de 10 em 10 minutos (o botão "Ler agora" está disponível para administradores).
- Anexos não são lidos, só o texto das mensagens.
- Uma execução do Apps Script dura no máximo 6 minutos. Se houver muitas mensagens acumuladas, são tratadas ao longo de várias execuções.
