const socket = io();

const joinArea = document.getElementById('joinArea');
const gameArea = document.getElementById('gameArea');
const playerNameInput = document.getElementById('playerName');
const joinBtn = document.getElementById('joinBtn');
const joinMessage = document.getElementById('joinMessage');
const connectionStatus = document.getElementById('connectionStatus');
const playersArea = document.getElementById('playersArea');
const baralhoDiv = document.getElementById('baralho');
const descarteDiv = document.getElementById('descarte');
const maoDiv = document.getElementById('maoJogador');
const statusDiv = document.getElementById('status');

if (connectionStatus && window.location.protocol === 'file:') {
  connectionStatus.textContent = 'Abra a página usando http://localhost:3000, não direto do arquivo.';
}
const jogadorInfo = document.getElementById('jogadorInfo');
const comprarBaralhoBtn = document.getElementById('comprarBaralho');
const comprarDescarteBtn = document.getElementById('comprarDescarte');
const baterBtn = document.getElementById('baterBtn');
const startGameBtn = document.getElementById('startGameBtn');
const meldsJogadorDiv = document.getElementById('meldsJogador');
const resetBtn = document.getElementById('resetBtn');
resetBtn.addEventListener('click', () => {
  socket.emit('reset-room');
});
let myId = null;
let meuNome = '';
let meuHand = [];
let currentState = null;
let cartaSelecionada = null;
let discarding = false;
let selectedForMeld = new Set();
let detectedMelds = [];
let localStatusMessage = '';
let currentMeldHighlight = -1;

function criarCartaElemento(carta, onClick) {
  const div = document.createElement('div');
  div.classList.add('carta');
  div.textContent = carta;
  const naipe = carta.trim().slice(-1);
  if (naipe === '♥' || naipe === '♦') {
    div.classList.add('vermelha');
  } else {
    div.classList.add('preta');
  }
  if (carta === cartaSelecionada) {
    div.classList.add('selecionada');
  }
  if (selectedForMeld.has(carta)) div.classList.add('selecionada-meld');
  div.addEventListener('click', (e) => onClick(carta, e));
  return div;
}

function criarMeldElemento(meld, index) {
  const box = document.createElement('div');
  box.classList.add('conjunto');
  box.dataset.meldIndex = index;

  const header = document.createElement('div');
  header.classList.add('conjunto-header');
  header.textContent = `Conjunto ${index + 1}`;
  box.appendChild(header);

  const row = document.createElement('div');
  row.classList.add('conjunto-cards');
  meld.forEach((carta) => {
    const cartaEl = criarCartaElemento(carta, () => {});
    cartaEl.classList.add('carta-meld');
    if (meld.length > 3) {
      const remover = document.createElement('button');
      remover.classList.add('retornar-carta');
      remover.textContent = '↶';
      remover.title = 'Retornar carta à mão';
      remover.addEventListener('click', (event) => {
        event.stopPropagation();
        returnCardFromMeld(index, carta);
      });
      cartaEl.appendChild(remover);
    }
    row.appendChild(cartaEl);
  });
  box.appendChild(row);

  return box;
}

function atualizaUI(state) {
  currentState = state;
  jogadorInfo.textContent = `Sua mão: ${state.myHand.length} cartas`;

  if (state.privateMessage) {
    statusDiv.textContent = state.privateMessage;
  } else if (localStatusMessage) {
    statusDiv.textContent = localStatusMessage;
  } else if (state.winner) {
   statusDiv.textContent = state.message || 'Fim de jogo';

statusDiv.classList.remove('vitoria', 'normal');

if (state.winner) {
  statusDiv.classList.add('vitoria');
} else {
  statusDiv.classList.add('normal');
}
  } else if (state.started) {
    if (state.currentTurnPlayerId === myId) {
      statusDiv.textContent = 'Sua vez';
    } else {
      const currentPlayer = state.players.find((p) => p.id === state.currentTurnPlayerId);
      statusDiv.textContent = currentPlayer ? `Vez de ${currentPlayer.name}` : state.message || 'Aguardando...';
    }
  } else {
    statusDiv.textContent = state.message || 'Aguardando...';
  }

  playersArea.innerHTML = '';
  state.players.forEach((player) => {
    const card = document.createElement('div');
    card.classList.add('player-card');
    if (player.id === state.currentTurnPlayerId) card.classList.add('current');
    if (player.id === myId) card.classList.add('meu-jogador');
    let inner = `<strong>${player.name}</strong>`;
    inner += `<span>Cartas: ${player.handCount}</span>`;
    inner += `<span>Cadeira: ${player.seat + 1}</span>`;
    if (state.winner && player.publicHand) {
      inner += `<div class="small-hand">${player.publicHand.map((c) => `<span class="mini-carta">${c}</span>`).join('')}</div>`;
    }
    card.innerHTML = inner;
    playersArea.appendChild(card);
  });

  baralhoDiv.innerHTML = '';
  const baralhoCarta = document.createElement('div');
  baralhoCarta.classList.add('carta');
  baralhoCarta.textContent = state.started ? '??' : '';
  baralhoCarta.style.cursor = state.started ? 'pointer' : 'default';
  baralhoDiv.appendChild(baralhoCarta);

  descarteDiv.innerHTML = '';
  if (state.discardTop) {
    descarteDiv.appendChild(criarCartaElemento(state.discardTop, () => {}));
  }

  maoDiv.innerHTML = '';
  state.myHand.forEach((carta) => {
    maoDiv.appendChild(criarCartaElemento(carta, handleCartaClique));
  });

  meldsJogadorDiv.innerHTML = '';
  const meusMelds = state.players.find((p) => p.id === myId)?.melds || [];
  if (meusMelds.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.classList.add('conjunto-empty');
    emptyMessage.textContent = 'Nenhuma trinca formada ainda.';
    meldsJogadorDiv.appendChild(emptyMessage);
  } else {
    meusMelds.forEach((meld, index) => {
      meldsJogadorDiv.appendChild(criarMeldElemento(meld, index));
    });
    // if we previously had a highlighted meld index, reapply bounds
    const total = meusMelds.length;
    if (currentMeldHighlight >= total) currentMeldHighlight = -1;
    if (currentMeldHighlight !== -1) highlightMeld(currentMeldHighlight);
  }

  comprarBaralhoBtn.disabled = !state.started || state.currentTurnPlayerId !== myId || state.winner || state.currentPlayerHasDrawn;
  comprarDescarteBtn.disabled = !state.started || state.currentTurnPlayerId !== myId || state.winner || !state.discardTop || state.currentPlayerHasDrawn;
  baterBtn.disabled = !state.started || state.currentTurnPlayerId !== myId || state.winner || !state.currentPlayerHasDrawn;
  startGameBtn.classList.toggle('hidden', state.hostId !== myId || state.started);

  // show reset button when there's a winner
  if (resetBtn) resetBtn.classList.toggle('hidden', !state.winner);
}

function highlightMeld(index) {
  // remove existing highlights
  const boxes = Array.from(meldsJogadorDiv.querySelectorAll('.conjunto'));
  boxes.forEach((b) => b.classList.remove('conjunto-highlight'));
  if (!boxes.length) return;
  const target = boxes.find((b) => Number(b.dataset.meldIndex) === index) || boxes[0];
  if (target) {
    target.classList.add('conjunto-highlight');
    currentMeldHighlight = Number(target.dataset.meldIndex);
  }
}


function toggleMeldSelection(carta) {
  if (selectedForMeld.has(carta)) selectedForMeld.delete(carta);
  else selectedForMeld.add(carta);
  localStatusMessage = selectedForMeld.size > 0 ? `Selecionadas ${selectedForMeld.size} carta(s) para meld.` : '';
  atualizaUI(currentState);
}

function handleCartaClique(carta, e) {
  if (!currentState || !currentState.started) return;

  if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    toggleMeldSelection(carta);
    return;
  }

  if (currentState.currentTurnPlayerId !== myId || !currentState.currentPlayerHasDrawn) {
    toggleMeldSelection(carta);
    return;
  }

  if (cartaSelecionada === carta) {
    socket.emit('discard-card', carta);
    cartaSelecionada = null;
    localStatusMessage = '';
    return;
  }

  cartaSelecionada = carta;
  localStatusMessage = 'Clique novamente na carta selecionada para descartar.';
  atualizaUI(currentState);
}

function parseCartaClient(carta) {
  const s = String(carta).trim();
  const naipe = s.slice(-1);
  const valor = s.slice(0, -1);
  const valores = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return { valor, naipe, label: carta, index: valores.indexOf(valor) };
}

function validarMeldClient(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const parsed = cards.map(parseCartaClient);
  const sameRank = parsed.every((c) => c.valor === parsed[0].valor);
  if (sameRank) return true;
  const sameSuit = parsed.every((c) => c.naipe === parsed[0].naipe);
  if (!sameSuit) return false;
  const indices = parsed.map((c) => c.index).sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  return true;
}

function detectarMeldsNaMao() {
  const hand = [...meuHand];
  const encontrados = [];

  // trincas por valor
  const byValue = {};
  hand.forEach((c) => {
    const p = parseCartaClient(c);
    byValue[p.valor] = byValue[p.valor] || [];
    byValue[p.valor].push(c);
  });
  Object.values(byValue).forEach((arr) => {
    if (arr.length >= 3) {
      encontrados.push(arr.slice(0, arr.length));
    }
  });

  // sequências por naipe
  const bySuit = {};
  hand.forEach((c) => {
    const p = parseCartaClient(c);
    bySuit[p.naipe] = bySuit[p.naipe] || [];
    bySuit[p.naipe].push({ label: c, index: p.index });
  });
  Object.values(bySuit).forEach((arr) => {
    arr.sort((a, b) => a.index - b.index);
    let run = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].index === arr[i - 1].index + 1) {
        run.push(arr[i]);
      } else {
        if (run.length >= 3) encontrados.push(run.map((r) => r.label));
        run = [arr[i]];
      }
    }
    if (run.length >= 3) encontrados.push(run.map((r) => r.label));
  });

  // remove overlapping by preferring trincas then sequences
  const used = new Set();
  const final = [];
  encontrados.forEach((meld) => {
    const anyUsed = meld.some((c) => used.has(c));
    if (!anyUsed) {
      meld.forEach((c) => used.add(c));
      final.push(meld);
    }
  });

  detectedMelds = final;
  selectedForMeld.clear();
  final.forEach((m) => m.forEach((c) => selectedForMeld.add(c)));
  atualizaUI(currentState);
  statusDiv.textContent = final.length > 0 ? `Detectados ${final.length} conjunto(s).` : 'Nenhum conjunto detectado.';
  return final;
}

function autoDeclararMelds() {
  if (selectedForMeld.size > 0) {
    const cards = Array.from(selectedForMeld);
    if (!validarMeldClient(cards)) {
      localStatusMessage = 'Seleção inválida para conjunto. Use trinca ou sequência.';
      atualizaUI(currentState);
      return;
    }
    socket.emit('declare-meld', cards);
    selectedForMeld.clear();
    localStatusMessage = 'Enviando conjunto selecionado...';
    atualizaUI(currentState);
    return;
  }

  const melds = detectedMelds.length > 0 ? detectedMelds : detectarMeldsNaMao();
  if (melds.length === 0) {
    localStatusMessage = 'Nenhum conjunto para declarar.';
    atualizaUI(currentState);
    return;
  }
  melds.forEach((m) => {
    socket.emit('declare-meld', m);
  });
  selectedForMeld.clear();
  detectedMelds = [];
  localStatusMessage = 'Enviando conjuntos detectados...';
  atualizaUI(currentState);
}

function returnCardFromMeld(meldIndex, carta) {
  socket.emit('return-meld-card', { meldIndex, card: carta });
}

function reordenarMao(oldIndex, newIndex) {
  if (oldIndex === newIndex) return;
  const carta = meuHand.splice(oldIndex, 1)[0];
  meuHand.splice(newIndex, 0, carta);
  atualizaUI({ ...currentState, myHand: meuHand });
}

function habilitaArea() {
  joinArea.classList.add('hidden');
  gameArea.classList.remove('hidden');
}

function preservarOrdemDaMao(oldHand, newHand) {
  const ordem = new Map();
  oldHand.forEach((carta, index) => ordem.set(carta, index));
  return [...newHand].sort((a, b) => {
    const ia = ordem.has(a) ? ordem.get(a) : Infinity;
    const ib = ordem.has(b) ? ordem.get(b) : Infinity;
    return ia - ib;
  });
}

joinBtn.addEventListener('click', () => {
  const nome = playerNameInput.value.trim();
  if (!nome) {
    joinMessage.textContent = 'Digite seu nome.';
    return;
  }
  if (!socket.connected) {
    joinMessage.textContent = 'Sem conexão com o servidor. Inicie o servidor e abra pelo endereço correto.';
    return;
  }
  socket.emit('join', nome, (res) => {
    if (!res.success) {
      joinMessage.textContent = res.message;
      return;
    }
    meuNome = nome;
    habilitaArea();
    joinMessage.textContent = '';
  });
});

comprarBaralhoBtn.addEventListener('click', () => {
  socket.emit('draw-card', 'deck');
  localStatusMessage = '';
});

comprarDescarteBtn.addEventListener('click', () => {
  socket.emit('draw-card', 'discard');
  localStatusMessage = '';
});

baterBtn.addEventListener('click', () => {
  socket.emit('bat');
  localStatusMessage = '';
});

startGameBtn.addEventListener('click', () => {
  socket.emit('start-game');
});

const declararMeldBtn = document.getElementById('declararMeldBtn');
declararMeldBtn.addEventListener('click', () => {
  const cards = Array.from(selectedForMeld);
  if (cards.length < 3) {
    localStatusMessage = 'Selecione pelo menos 3 cartas para declarar um conjunto.';
    atualizaUI(currentState);
    return;
  }
  if (!validarMeldClient(cards)) {
    localStatusMessage = 'Seleção inválida para conjunto. Use trinca ou sequência.';
    atualizaUI(currentState);
    return;
  }
  socket.emit('declare-meld', cards);
  selectedForMeld.clear();
  cartaSelecionada = null;
  localStatusMessage = 'Declarando conjunto...';
  atualizaUI(currentState);
});

const autoDeclararBtn = document.getElementById('autoDeclararBtn');
autoDeclararBtn.addEventListener('click', () => autoDeclararMelds());

new Sortable(maoDiv, {
  animation: 150,
  direction: 'horizontal',
  ghostClass: 'sortable-ghost',
  chosenClass: 'sortable-chosen',
  group: {
    name: 'mao',
    put: false,
  },
  onEnd: (evt) => {
    if (evt.to === maoDiv) {
      reordenarMao(evt.oldIndex, evt.newIndex);
    }
  }
});

new Sortable(descarteDiv, {
  animation: 150,
  ghostClass: 'sortable-ghost',
  group: {
    name: 'mao',
    pull: false,
    put: true,
  },
  onMove: () => {
    return currentState && currentState.currentTurnPlayerId === myId && currentState.started && !currentState.winner && currentState.currentPlayerHasDrawn && !discarding;
  },
  onAdd: (evt) => {
    const carta = evt.item.textContent;
    if (evt.from === maoDiv) {
      discarding = true;
      if (currentState) {
        currentState.currentPlayerHasDrawn = false;
        atualizaUI(currentState);
      }
    }
    socket.emit('discard-card', carta);
    cartaSelecionada = null;
  }
});

socket.on('state', (state) => {
  discarding = false;
  myId = state.myId;
  localStatusMessage = '';
  detectedMelds = [];
  if (meuHand.length > 0 && state.myHand && state.myHand.length > 0) {
    state.myHand = preservarOrdemDaMao(meuHand, state.myHand);
  }
  meuHand = state.myHand;
  if (!meuHand.includes(cartaSelecionada)) cartaSelecionada = null;
  atualizaUI(state);
});

socket.on('connect', () => {
  if (connectionStatus) connectionStatus.textContent = 'Conectado ao servidor.';
  if (myId) {
    socket.emit('request-state');
  }
});

socket.on('disconnect', () => {
  if (connectionStatus) connectionStatus.textContent = 'Desconectado do servidor.';
});

socket.on('connect_error', () => {
  if (connectionStatus) connectionStatus.textContent = 'Erro ao conectar ao servidor.';
});
