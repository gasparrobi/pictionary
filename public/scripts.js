document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = $('select option:selected')[0].value;

  let nicks = new Map();
  const socket = io('http://localhost:4000');

  let strokes = {};
  let currentStroke = 0;

  let messages = {};
  let currentMessage = 0;

  // Game state
  const Game = {};
  Game.artist = '';
  Game.players = [];
  Game.scores = new Map();

  function draw(x, y, type, colour, size) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = size;
    if (type === 'dragstart') {
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else if (type === 'drag') {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.closePath();
    }
    ctx.strokeStyle = $('select option:selected')[0].value;
    ctx.lineWidth = $('#size')[0].value;
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function clearMessages() {
    $('#messages').empty();
  }

  function showMessage(sessionID, message) {
    const username = nicks.get(sessionID);
    $('#messages').append($('<div>').text(`${username} : ${message}`));
    $('#messages').scrollTop($('#messages')[0].scrollHeight);
  }

  function getSessionID() {
    return localStorage.getItem('sessionID');
  }

  socket.emit('sessionID', getSessionID());


  function requestMissing(name, list, currentPos) {
    const keys = Object.getOwnPropertyNames(list).map(Number);

    if (keys[0] != 0) {
      keys.unshift(-1);
    }

    if (keys[keys.length - 1] != currentPos) {
      keys.push(currentPos + 1);
    }

    for (var i = 0; i < keys.length - 1; i++) {
      if (keys[i + 1] - keys[i] == 2) {
        socket.emit('get'+ name, keys[i] + 1);
      } else if (keys[i + 1] - keys[i] > 2) {
        socket.emit('get' + name + 's', {
          start: keys[i] + 1,
          end: keys[i + 1],
        });
      }
    }
  }

  function requestMissingStrokes() {
    requestMissing('Stroke', strokes, currentStroke);
  }

  function requestMissingMessages() {
    requestMissing('Message', messages, currentMessage);
  }

  socket.on('joinedRoom', () => {
    // Clear display
    clear();
    clearMessages();

    // Clear out local data.
    nicks = new Map();
    strokes = {};
    currentStroke = 0;
    messages = {};
    currentMessage = 0;

    // Request it from server.
    socket.emit('getNicks');
    socket.emit('getCurrentStroke');
    socket.emit('getCurrentMessage');

    /* We could have remembered old rooms data, but we shouldn't be
     * switching often, so resending all the data from the server is
     * fine.
     */
  });

  socket.on('setSessionID', (data) => {
    localStorage.setItem('sessionID', data);
  });

  socket.on('currentMessage', (data) => {
    currentMessage = data;
    // window.console.log(currentMessage);

    if (messages.length != currentMessage) {
      requestMissingMessages();
    }
  });

  socket.on('currentStroke', (data) => {
    currentStroke = data;
    // window.console.log(currentStroke);

    if (strokes.length != currentStroke) {
      requestMissingStrokes();
    }
  });

  socket.on('draw', (data) => {
    strokes[data.id] = data;
    return draw(data.x, data.y, data.type, data.colour, data.size);
  });

  socket.on('drawStrokes', (data) => {
    console.log("told to draw strokes");
    for (var i in data) {
      strokes[data[i].id] = data[i];
      draw(data[i].x, data[i].y, data[i].type, data[i].colour, data[i].size);
    }
  });


  socket.on('messages', (data) => {
    console.log("told to traw messages");
    for (var i in data) {
      messages[data[i].id] = data[i];
      showMessage(data[i].sessionID, data[i].data);
    }
  });


  socket.on('drawReceived', (data) => {
    strokes[data.id] = data.data;
  });

  socket.on('clear', () => {
    clear();
    strokes = {};
  });

  socket.on('message', (data) => {
    messages[data.id] = data;
    showMessage(data.sessionID, data.data);
  });

  socket.on('nick', (data) => {
    nicks.set(data.sessionID, data.nick);
  });

  socket.on('nicks', (data) => {
    // We receive a list of key value pairs. We then add this to our map.
    data.forEach((entry) => {
      nicks.set(entry[0], entry[1]);
    });
  });

  socket.on('scores', (data) => {
    // We receive a list of key value pairs. We then add this to our map.
    $('#scores').empty();
    data.forEach((entry) => {
      Game.scores.set(entry[0], entry[1]);
      $('#scores').append($('<div>').text(`${nicks.get(entry[0])} : ${entry[1]}`));
    });
  });

  socket.on('nickStatus', (accepted) => {
    if (accepted) {
      $('#nick').val('Your Nick is now set.');
    } else {
      $('#nick').val('Nick already taken!');
    }
  });

  socket.on('gameWord', (word) => {
    $('#gameStatus').text(`You are drawing ${word}`);
  });

  socket.on('startRound', (data) => {
    if (data.artist !== getSessionID()) {
      $('#gameStatus').text('You are guessing');
    } else {
      // TODO any changes for artist aside from gameWord message.
    }
  });

  $('canvas').on('drag dragstart dragend', (e) => {
    const colour = ctx.strokeStyle;
    const size = ctx.lineWidth;
    const type = e.handleObj.type;
    const offset = $('canvas').offset();
    const x = e.pageX - offset.left;
    const y = e.pageY - offset.top;
    draw(x, y, type, colour, size);
    socket.emit('drawClick', { x, y, type, colour, size });
  });

  $('#clear').on('click', () => {
    clear();
    socket.emit('clear');
  });

  $('select').change(() => {
    ctx.strokeStyle = $('select option:selected')[0].value;
  });

  $('#size').change(() => {
    ctx.lineWidth = $('#size')[0].value;
  });


  $('form').submit(() => {
    socket.emit('message', $('#m').val());
    $('#m').val('');
    return false;
  });

  $('#requestNick').on('click', () => {
    socket.emit('requestNick', $('#nick').val());
    $('#nick').val('');
    return false;
  });

  $('#joinRoom').on('click', () => {
    socket.emit('joinRoom', $('#room').val());
    $('#room').val('');
    return false;
  });

  $('#leaveRoom').on('click', () => {
    socket.emit('leaveRoom');
  });

  window.onbeforeunload = () => {
    socket.emit('leaveRoom');
  };
});
