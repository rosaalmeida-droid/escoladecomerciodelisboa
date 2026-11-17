/**
 * Config.js — tudo o que a escola pode querer ajustar está aqui.
 *
 * A chave da API da Anthropic NÃO vai aqui: guarda-se em
 * Definições do projeto > Propriedades do script > ANTHROPIC_API_KEY.
 */
var CONFIG = {
  NOME_APP: 'Eventos ECL',

  // Só se processam emails enviados por pessoas destes domínios (vazio = aceitar todos).
  DOMINIOS_PERMITIDOS: ['eclisboa.net'],

  // Endereços cujas mensagens nunca são lidas (além da própria caixa de eventos).
  ENDERECOS_IGNORADOS: [],

  // Pesquisa do Gmail que define o que é lido. A caixa de eventos deve ser uma conta dedicada
  // (ex.: eventos@eclisboa.net), que as pessoas põem em cópia nas suas conversas.
  PESQUISA: 'newer_than:30d -in:spam -in:trash -in:chats -category:promotions -category:social',
  MAX_CONVERSAS: 100,

  // Modelo de IA e esforço de raciocínio.
  MODELO: 'claude-opus-5-5',
  ESFORCO_ANALISE: 'medium',
  ESFORCO_CLASSIFICACAO: 'low',
  ESFORCO_PERGUNTA: 'low',
  MENSAGENS_POR_PEDIDO: 8,

  // Avisar por email quem fica com uma tarefa nova.
  NOTIFICAR_ATRIBUICOES: true,

  // Resumo semanal (segunda-feira de manhã) a cada pessoa com tarefas pendentes.
  RESUMO_SEMANAL: true,

  // Emails com permissões de administração na app (o dono da caixa de eventos já é admin).
  ADMINS: [],

  // Tempo máximo de cada sincronização (o Apps Script corta aos 6 minutos).
  LIMITE_MS: 4.5 * 60 * 1000,

  // Tentativas antes de desistir de uma conversa que dá erro.
  MAX_FALHAS: 3
};
