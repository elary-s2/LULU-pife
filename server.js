const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const room = {
  players: [],
  deck: [],
  discard: [],
  currentTurn: 0,
  playerHasDrawn: {},
  hands: {},
  melds: {},
  started: false,
  winner: null,
  hostId: null,
  message: 'Aguardando jogadores...',
  privateMessages: {}
};

app.use(express.static(__dirname));

function criarBaralho() {
  const naipes = ['♠', '♥', '♦', '♣'];
  const valores = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const naipe of naipes) {
    for (const valor of valores) {
      deck.push(`${valor}${naipe}`);
    }
  }
  return deck;
}

function embaralhar(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function buildPublicState() {
  const currentPlayerId = room.players[room.currentTurn]?.id || null;
  return {
    players: room.players.map((player, index) => ({
      id: player.id,
      name: player.name,
      handCount: room.hands[player.id]?.length || 0,
      melds: room.melds[player.id] || [],
      publicHand: room.winner ? (room.hands[player.id] || []) : null,
      seat: index
    })),
    currentTurn: room.currentTurn,
    currentTurnPlayerId: currentPlayerId,
    currentPlayerHasDrawn: Boolean(room.playerHasDrawn[currentPlayerId]),
    discardTop: room.discard.length > 0 ? room.discard[room.discard.length - 1] : null,
    started: room.started,
    winner: room.winner,
    hostId: room.hostId,
    message: room.message,
    maxPlayers: MAX_PLAYERS
  };
}

function sendStateTo(socketId) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  const privateMessage = room.privateMessages[socketId] || null;
  delete room.privateMessages[socketId];
  socket.emit('state', {
    ...buildPublicState(),
    myId: socketId,
    myHand: room.hands[socketId] || [],
    privateMessage
  });
}

function broadcastState() {
  room.players.forEach((player) => sendStateTo(player.id));
}

function nextPlayerIndex() {
  if (room.players.length === 0) return 0;
  return (room.currentTurn + 1) % room.players.length;
}

function startGame() {
  room.deck = criarBaralho();
  embaralhar(room.deck);
  room.discard = [];
  room.currentTurn = 0;
  room.winner = null;
  room.started = true;
  room.message = `Turno de ${room.players[room.currentTurn].name}`;

  room.players.forEach((player) => {
    room.hands[player.id] = [];
    room.melds[player.id] = [];
    room.playerHasDrawn[player.id] = false;
  });

  for (let i = 0; i < 9; i++) {
    room.players.forEach((player) => {
      room.hands[player.id].push(room.deck.pop());
    });
  }

  room.discard.push(room.deck.pop());
  broadcastState();
}

function parseCarta(carta) {
  const naipe = carta.slice(-1);
  const valor = carta.slice(0, -1);
  const valores = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return { valor, naipe, label: carta, index: valores.indexOf(valor) };
}

function verificarBater(hand) {
  const parsed = hand.map(parseCarta);
  const naipes = ['♠', '♥', '♦', '♣'];
  const ordenado = [...parsed].sort((a, b) => {
    if (a.naipe === b.naipe) return a.index - b.index;
    return naipes.indexOf(a.naipe) - naipes.indexOf(b.naipe);
  });

  function recusar(cartas) {
    if (cartas.length === 0) return [];
    const first = cartas[0];
    const igualRank = cartas.filter((c) => c.valor === first.valor);
    if (igualRank.length >= 3) {
      const resto = cartas.filter((c) => c.valor !== first.valor);
      const proximo = recusar(resto);
      if (proximo) return [[...igualRank.map((c) => c.label)], ...proximo];
    }

    const mesmosNaipe = cartas.filter((c) => c.naipe === first.naipe);
    const indices = mesmosNaipe.map((c) => c.index);
    for (let start = 0; start < indices.length; start++) {
      for (let end = start + 3; end <= indices.length; end++) {
        const slice = indices.slice(start, end);
        if (slice.length < 3) continue;
        let valido = true;
        for (let i = 1; i < slice.length; i++) {
          if (slice[i] !== slice[i - 1] + 1) {
            valido = false;
            break;
          }
        }
        if (!valido) continue;
        const meld = mesmosNaipe.slice(start, end);
        const restantes = cartas.filter((c) => !meld.includes(c));
        const proximo = recusar(restantes);
        if (proximo) return [[...meld.map((c) => c.label)], ...proximo];
      }
    }
    return null;
  }

  const ensamblado = recusar(ordenado);
  return {
    success: Boolean(ensamblado),
    melds: ensamblado || []
  };
}

function validarMeld(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const parsed = cards.map(parseCarta);
  // all same rank (trinca)
  const sameRank = parsed.every((c) => c.valor === parsed[0].valor);
  if (sameRank) return true;
  // or same suit and consecutive (sequência)
  const sameSuit = parsed.every((c) => c.naipe === parsed[0].naipe);
  if (!sameSuit) return false;
  const indices = parsed.map((c) => c.index).sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  return true;
}

function getPlayerIndex(socketId) {
  return room.players.findIndex((player) => player.id === socketId);
}

function getCurrentPlayerId() {
  return room.players[room.currentTurn]?.id;
}

function jogadorTemMeldCompleto(socketId) {
  const melds = room.melds[socketId] || [];
  const totalCartas = melds.reduce((sum, meld) => sum + (Array.isArray(meld) ? meld.length : 0), 0);
  return totalCartas >= 9;
}

io.on('connection', (socket) => {
  socket.on('join', (name, callback) => {
    if (room.started) {
      callback({ success: false, message: 'Jogo já em andamento.' });
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      callback({ success: false, message: 'Sala cheia.' });
      return;
    }
    if (!name || typeof name !== 'string') {
      callback({ success: false, message: 'Nome inválido.' });
      return;
    }

    room.players.push({ id: socket.id, name: name.trim().substring(0, 16) });
    room.hands[socket.id] = [];
    room.melds[socket.id] = [];
    room.playerHasDrawn[socket.id] = false;
    socket.join('main');

    if (!room.hostId) {
      room.hostId = socket.id;
    }

    room.message = `${name} entrou na sala.`;
    broadcastState();
    callback({ success: true });

    if (room.players.length === MAX_PLAYERS) {
      room.message = 'Máximo de jogadores atingido. Iniciando o jogo...';
      startGame();
    }
  });

  socket.on('start-game', () => {
    if (socket.id !== room.hostId) return;
    if (room.started) return;
    if (room.players.length < 2) {
      room.message = 'É preciso ao menos 2 jogadores para iniciar.';
      broadcastState();
      return;
    }
    startGame();
  });

  socket.on('draw-card', (source) => {
    if (!room.started || room.winner) return;
    if (socket.id !== getCurrentPlayerId()) return;
    if (room.playerHasDrawn[socket.id]) return;

    if (source === 'deck') {
      if (room.deck.length === 0) {
        room.privateMessages[socket.id] = 'O baralho acabou.';
        sendStateTo(socket.id);
        return;
      }
      const carta = room.deck.pop();
      room.hands[socket.id].push(carta);
      room.playerHasDrawn[socket.id] = true;
      room.privateMessages[socket.id] = `Você comprou ${carta} do baralho.`;
      room.message = `Turno de ${room.players[room.currentTurn].name}`;
      broadcastState();
      return;
    }

    if (source === 'discard') {
      if (room.discard.length === 0) return;
      const carta = room.discard.pop();
      room.hands[socket.id].push(carta);
      room.playerHasDrawn[socket.id] = true;
      room.privateMessages[socket.id] = `Você comprou ${carta} do descarte.`;
      room.message = `Turno de ${room.players[room.currentTurn].name}`;
      broadcastState();
      return;
    }
  });

  socket.on('discard-card', (card) => {
    if (!room.started || room.winner) return;
    if (socket.id !== getCurrentPlayerId()) return;
    if (!room.playerHasDrawn[socket.id]) return;
    const hand = room.hands[socket.id];
    const index = hand.indexOf(card);
    if (index === -1) return;

    hand.splice(index, 1);
    room.discard.push(card);
    room.playerHasDrawn[socket.id] = false;
    room.currentTurn = nextPlayerIndex();
    room.message = `Turno de ${room.players[room.currentTurn].name}`;
    room.privateMessages[socket.id] = `Você descartou ${card}.`;
    broadcastState();
  });

  socket.on('declare-meld', (cards) => {
    if (!room.started || room.winner) return;
    if (!Array.isArray(cards) || cards.length < 3) {
      room.message = 'Selecione pelo menos 3 cartas para formar um conjunto.';
      broadcastState();
      return;
    }
    if (!validarMeld(cards)) {
      room.message = 'Conjunto inválido.';
      broadcastState();
      return;
    }

    const hand = room.hands[socket.id];
    // verify ownership
    for (const c of cards) {
      if (hand.indexOf(c) === -1) {
        room.message = 'Você não possui todas as cartas selecionadas.';
        broadcastState();
        return;
      }
    }

    // remove cards from hand and add meld (can be declared outside turn)
    for (const c of cards) {
      const idx = hand.indexOf(c);
      hand.splice(idx, 1);
    }
    room.melds[socket.id].push(cards);
    room.privateMessages[socket.id] = 'Você formou um conjunto.';
    room.message = `Turno de ${room.players[room.currentTurn].name}`;
    broadcastState();
  });

  socket.on('return-meld-card', ({ meldIndex, card }) => {
    if (!room.started || room.winner) return;
    const melds = room.melds[socket.id] || [];
    if (!Array.isArray(melds[meldIndex]) || melds[meldIndex].length <= 3) {
      room.message = 'Somente conjuntos com mais de 3 cartas podem devolver uma carta.';
      broadcastState();
      return;
    }
    const meld = melds[meldIndex];
    const cardIdx = meld.indexOf(card);
    if (cardIdx === -1) {
      room.message = 'Carta não encontrada no conjunto.';
      broadcastState();
      return;
    }
    meld.splice(cardIdx, 1);
    room.hands[socket.id].push(card);
    room.privateMessages[socket.id] = `Você devolveu ${card} para a mão.`;
    room.message = `Turno de ${room.players[room.currentTurn].name}`;
    broadcastState();
  });

  socket.on('bat', () => {
    if (!room.started || room.winner) return;
    if (socket.id !== getCurrentPlayerId()) return;
    // allow bat if player has drawn OR already has all cards in melds
    if (!room.playerHasDrawn[socket.id] && !jogadorTemMeldCompleto(socket.id)) return;

    const hand = room.hands[socket.id];
    const resultado = verificarBater(hand);
    const podeBaterComMelds = jogadorTemMeldCompleto(socket.id);
    if (resultado.success || podeBaterComMelds) {
      room.winner = socket.id;
      room.message = `${room.players[room.currentTurn].name} bateu e venceu!`;
      if (resultado.success) {
        room.melds[socket.id] = resultado.melds;
      }
      broadcastState();
    } else {
      room.message = 'Ainda não é possível bater.';
      broadcastState();
    }
  });

  socket.on('request-state', () => {
    sendStateTo(socket.id);
  });

socket.on('reset-room', () => {
  console.log('reset-room requested by', socket.id, 'room.winner=', room.winner);

  if (!room.winner) {
    room.privateMessages[socket.id] = 'Não é possível reiniciar: nenhum vencedor atual.';
    sendStateTo(socket.id);
    return;
  }

  room.started = false;
  room.winner = null;
  room.deck = [];
  room.discard = [];
  room.currentTurn = 0;

  room.players.forEach((p) => {
    room.hands[p.id] = [];
    room.melds[p.id] = [];
    room.playerHasDrawn[p.id] = false;
  });

  room.message = 'Aguardando jogadores...';
  broadcastState();
});
  socket.on('disconnect', () => {
    const index = getPlayerIndex(socket.id);
    if (index !== -1) {
      room.players.splice(index, 1);
      delete room.hands[socket.id];
      delete room.melds[socket.id];
      delete room.playerHasDrawn[socket.id];
      if (room.hostId === socket.id) {
        room.hostId = room.players[0]?.id || null;
      }
      if (room.currentTurn >= room.players.length) {
        room.currentTurn = 0;
      }
      room.message = 'Um jogador saiu da sala.';
      if (room.players.length === 0) {
        room.started = false;
        room.winner = null;
        room.deck = [];
        room.discard = [];
        room.currentTurn = 0;
      }
      broadcastState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
