const test = require('node:test');
const assert = require('node:assert');
const N = require('../Nucleo.js');

test('assunto e endereços', () => {
  assert.strictEqual(N.nomeEventoDoAssunto('Re: RE: [Evento] Feira de Emprego 2027'), 'Feira de Emprego 2027');
  assert.strictEqual(N.nomeEventoDoAssunto('Reunião geral'), null);
  assert.strictEqual(N.slug('Feira de Emprego — 2027!'), 'feira-de-emprego-2027');
  const e = N.enderecos('"Silva, Ana" <Ana@x.pt>, rui.costa@x.pt, Marta Reis <marta@x.pt>');
  assert.deepStrictEqual(e, [
    { nome: 'Silva, Ana', email: 'ana@x.pt' },
    { nome: 'Rui Costa', email: 'rui.costa@x.pt' },
    { nome: 'Marta Reis', email: 'marta@x.pt' },
  ]);
  assert.strictEqual(N.idUnico('feira', ['feira', 'feira-2']), 'feira-3');
});

test('texto citado e assinaturas são retirados', () => {
  const corpo = [
    'Já reservei o ginásio.',
    '',
    'Em seg., 16/11/2026 às 10:00, Ana Silva <ana@x.pt>',
    'escreveu:',
    '> Rui, podes reservar o ginásio?',
  ].join('\n');
  assert.strictEqual(N.textoNovo(corpo), 'Já reservei o ginásio.');
  assert.strictEqual(N.textoNovo('Olá\n--\nProf. Ana\nECL'), 'Olá');
  assert.strictEqual(N.textoNovo('Ok\n\nDe: Rui <r@x>\nEnviado: hoje\nPara: ana'), 'Ok');
});

function msg(id, data, de, corpo, envolvidos) {
  return { id, threadId: 't1', data, de, envolvidos: envolvidos || [], assunto: 'Feira', corpo };
}
const ANA = { nome: 'Ana Silva', email: 'ana.silva@eclisboa.net' };
const RUI = { nome: 'Rui Costa', email: 'rui.costa@eclisboa.net' };

function vazia(extra) {
  return Object.assign({
    mensagens: [], informacao: { nome: null, data: null, hora: null, local: null, descricao: null, estado: null },
    coordenador: null, areas: [], saidas: [], tarefas_novas: [], tarefas_atualizadas: [], decisoes_novas: [],
    questoes_em_aberto: [], alertas: [], ponto_situacao: '',
  }, extra);
}

test('aplicar análise: criar, atribuir, concluir, resolver nomes', () => {
  const ev = N.novoEvento('Feira de Emprego 2027', '2026-11-10T09:00:00Z');
  const m1 = msg('m1', '2026-11-10T09:00:00Z', ANA, 'Rui, podes reservar o ginásio? A Prof. Carla trata dos convites.', [RUI]);

  let notif = N.aplicarAnalise(ev, [m1], vazia({
    mensagens: [{ id: 'm1', resumo: 'A Ana lançou a feira e distribuiu tarefas.' }],
    informacao: { nome: null, data: '2027-03-15', hora: '09:30', local: 'Ginásio', descricao: null, estado: 'nao-existe' },
    coordenador: { nome: 'Ana Silva', email: '' },
    areas: [{ nome: 'logística', responsavel: { nome: 'Rui', email: '' }, membros: [{ nome: 'Prof. Carla', email: '' }] }],
    tarefas_novas: [
      { descricao: 'Reservar o ginásio', responsavel: { nome: 'Rui Costa', email: '' }, prazo: '2027-03-01', area: 'Logística', ja_concluida: false, mensagem_id: 'm1' },
      { descricao: 'Enviar convites às empresas', responsavel: { nome: 'Prof. Carla', email: '' }, prazo: '2027-02-31', area: null, ja_concluida: false, mensagem_id: 'm1' },
      { descricao: 'reservar o ginásio', responsavel: null, prazo: null, area: null, ja_concluida: false, mensagem_id: 'm1' },
    ],
    questoes_em_aberto: [{ texto: 'Há orçamento para o coffee break?', quem: { nome: 'Ana', email: '' } }],
    ponto_situacao: 'Em planeamento.',
  }));

  assert.strictEqual(ev.data, '2027-03-15');
  assert.strictEqual(ev.estado, 'planeamento', 'estado inválido é ignorado');
  assert.deepStrictEqual(ev.coordenador, ANA, 'nome resolvido para o email do remetente');
  assert.strictEqual(ev.areas[0].nome, 'Logística');
  assert.deepStrictEqual(ev.areas[0].responsavel, RUI, 'primeiro nome resolvido pelo diretório');
  assert.strictEqual(ev.tarefas.length, 2, 'tarefa duplicada não é criada');
  assert.strictEqual(ev.tarefas[1].prazo, null, 'data inválida é ignorada');
  assert.strictEqual(ev.questoes[0].quem.email, ANA.email);
  assert.strictEqual(ev.historico[0].resumo, 'A Ana lançou a feira e distribuiu tarefas.');
  assert.deepStrictEqual(notif.map(n => n.pessoa.nome), ['Rui Costa', 'Prof. Carla']);

  // A Prof. Carla escreve pela primeira vez: o email dela liga-se a todos os papéis.
  const CARLA = { nome: 'Prof. Carla', email: 'carla.matos@eclisboa.net' };
  const m2 = msg('m2', '2026-11-12T10:00:00Z', CARLA, 'Convites enviados!');
  notif = N.aplicarAnalise(ev, [m2], vazia({
    mensagens: [{ id: 'm2', resumo: 'Convites enviados.' }],
    tarefas_atualizadas: [
      { id: 2, estado: 'concluida', responsavel: null, prazo: null, area: null, descricao: null },
      { id: 99, estado: 'concluida', responsavel: null, prazo: null, area: null, descricao: null },
    ],
    decisoes_novas: [{ texto: 'Feira no ginásio', mensagem_id: 'm2' }],
    questoes_em_aberto: [],
  }));
  assert.strictEqual(ev.tarefas[1].estado, 'concluida');
  assert.strictEqual(ev.tarefas[1].concluidaEm, '2026-11-12T10:00:00Z');
  assert.strictEqual(ev.tarefas[1].responsavel.email, CARLA.email);
  assert.strictEqual(ev.areas[0].membros[0].email, CARLA.email);
  assert.strictEqual(ev.questoes.length, 0);
  assert.strictEqual(ev.decisoes[0].de.email, CARLA.email);
  assert.strictEqual(notif.length, 0);

  // A mesma mensagem não é aplicada duas vezes.
  assert.deepStrictEqual(N.aplicarAnalise(ev, [m2], vazia({ tarefas_novas: [{ descricao: 'x', responsavel: null, prazo: null, area: null, ja_concluida: false, mensagem_id: 'm2' }] })), []);
  assert.strictEqual(ev.tarefas.length, 2);
  assert.strictEqual(ev.historico.length, 2);

  // Saída de uma pessoa.
  N.aplicarAnalise(ev, [msg('m3', '2026-11-13T10:00:00Z', ANA, 'O Rui saiu.')], vazia({ saidas: [{ nome: 'Rui Costa', email: '' }] }));
  assert.strictEqual(ev.areas[0].responsavel, null);
  assert.deepStrictEqual(N.papeisDe(ev, CARLA.email), ['Equipa de Logística']);
  assert.deepStrictEqual(N.papeisDe(ev, ANA.email), ['Responsável geral']);
});

test('pedidos à IA incluem estado e mensagens limpas', () => {
  const ev = N.novoEvento('Festa de Natal', '2026-11-10T09:00:00Z');
  const txt = N.pedidoAnalise(ev, [msg('m9', '2026-11-10T09:00:00Z', ANA, 'Olá\n> citado')], '2026-11-17');
  assert.match(txt, /Evento: Festa de Natal \(id: festa-de-natal\)/);
  assert.match(txt, /Mensagem id=m9/);
  assert.doesNotMatch(txt, /citado/);
  // Esquema estrito: todos os objetos com additionalProperties false e required completo.
  (function verificar(s) {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') {
      assert.strictEqual(s.additionalProperties, false);
      assert.deepStrictEqual(s.required.slice().sort(), Object.keys(s.properties).sort());
    }
    Object.values(s).forEach(verificar);
  })(N.ESQUEMA_ANALISE);
});
