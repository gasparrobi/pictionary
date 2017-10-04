const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const uuid = require('node-uuid');

app.use(express.static('public'));
app.get('/', (req, res) => {
  console.log(`${__dirname}/index.html`);

  res.sendFile(`${__dirname}/index.html`);
});

const lengthOfRound = 100 * 1000; // ms

const strokes = new Map(); // room name to array of strokes
const messages = new Map(); // room name to array of messages
const roomData = new Map(); // room name to object containing game state

const sessionData = new Map();
const socketIDtoSessionID = new Map();
// sessionData doesn't store the socket id, so we seperate it out.
const sessionIDtoSocketID = new Map();

// This function is what we use instead of socket.on(eventname, callback)
// It keeps track of the last time a session was accessed
function on(socket, eventname, callback) {
  function wrappedCallback(...args) {
    if (socketIDtoSessionID.has(socket.id)) {
      // Update the 'freshness' of this clients session.
      const session = sessionData.get(socketIDtoSessionID.get(socket.id));
      if (session) session.accessTime = Date.now();
    }
    return callback.apply(this, args);
  }

  socket.on(eventname, wrappedCallback);
}

// This function returns a session object given a socketID
// We could also add functions to safely set values in the session
function getSession(socketID) {
  const sessionID = socketIDtoSessionID.get(socketID);
  if (sessionID === undefined) return null;
  const session = sessionData.get(sessionID);
  return session;
}

function sendScores(roomID) {
  const room = roomData.get(roomID);
  const scores = [];
  for (const [key, value] of room.scores.entries()) {
    scores.push([key, value]);
  }
  io.to(roomID).emit('scores', scores);
}

function clearRoom(roomID) {
  if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
  strokes.set(roomID, []);
  io.to(roomID).emit('clear');
  console.log('clearing');
}

// Starts a round of pictionary in a given room.
function startRound(roomID) {
  console.log(`Room : ${roomID}`);
  const room = roomData.get(roomID);
  clearRoom(roomID);

  room.started = true;
  room.artist = room.playerList[room.turn]; // We pick the first player
  room.startTime = Date.now();
  room.word = 'Hot Dog'; // Todo, get this word from somewhere.
  room.timer = setTimeout(endRound, lengthOfRound, roomID);

  const currentplayers = room.playerList.slice(); // Copy of array
  currentplayers.splice(room.turn, 1); // The other players.
  room.playersToFinish = currentplayers;

  io.to(roomID).emit('startRound', { artist: room.artist });
  const artistSocketID = sessionIDtoSocketID.get(room.artist);
  console.log(`Releasing the game word to client with id: ${room.artist}`);
  io.to(artistSocketID).emit('gameWord', room.word);

  room.turn += 1;
}

function endRound(roomID) {
  const room = roomData.get(roomID);
  clearTimeout(room.timer);
  if (room.turn >= room.playerList.length) room.turn = 0;
  clearOldSessions(roomID);
  sendScores(roomID);
  if (room.started) startRound(roomID);
}

function leaveRoom(playerID, roomID) {
  if (!roomData.has(roomID)) return; // Very basic guard lol
  const index = roomData.get(roomID).playerList.indexOf(playerID);
  roomData.get(roomID).playerList.splice(index, 1);
  roomData.get(roomID).scores.delete(playerID);
  if (roomData.get(roomID).playerList.length <= 1) {
    roomData.get(roomID).started = false;
    endRound(roomID);
  }
  if (roomData.get(roomID).playerList.length === 0) {
    roomData.delete(roomID);
  }
}

function clearOldSessions(roomID) {
  sessionData.forEach((value, key) => {
    if (value.room === roomID && Date.now() - value.accessTime > 2 * 60 * 1000) {
      socketIDtoSessionID.delete(sessionIDtoSocketID.get(key));
      sessionIDtoSocketID.delete(key);
      sessionData.delete(key);
      leaveRoom(key, value.room);
    }
  });
}

function initialiseRoom(roomID) {
  roomData.set(roomID, {
    scores: new Map(),
    started: false,
    artist: null,
    word: '',
    playerList: [],
    playersToFinish: [],
    startTime: null,
    turn: 0,
  });
  messages.set(roomID, []);
  strokes.set(roomID, []);
}


io.on('connection', (socket) => {
  on(socket, 'getCurrentStroke', () => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    socket.emit('currentStroke', strokes.get(roomID).length - 1);
  });

  on(socket, 'getCurrentMessage', () => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    socket.emit('currentMessage', messages.get(roomID).length - 1);
  });

  on(socket, 'getNicks', () => {
    const nicks = [];
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    for (const [key, value] of sessionData.entries()) {
      // There's a small problem with this. If a person leaves a room, their
      // Nick is no longer avaliable for late joiners. I think we have to pick
      // Our battles with this one though.
      if (value.room === roomID) nicks.push([key, value.nick]);
    }
    socket.emit('nicks', nicks);
  });

  on(socket, 'getStroke', (id) => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    if (strokes.get(roomID)[id]) {
      socket.emit('draw', strokes.get(roomID)[id]);
    }
  });

  on(socket, 'getMessage', (id) => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    if (messages.get(roomID)[id]) {
      socket.emit('message', messages.get(roomID)[id]);
    }
  });

  on(socket, 'getStrokes', (data) => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    const roomStrokes = strokes.get(roomID);

    if (roomStrokes[data.start] && roomStrokes[data.end - 1]) {
      socket.emit('drawStrokes', roomStrokes.slice(data.start, data.end));
    }
  });

  on(socket, 'getMessages', (data) => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    const roomMessages = messages.get(roomID);
    if (roomMessages[data.start] && roomMessages[data.end - 1]) {
      socket.emit('messages', roomMessages.slice(data.start, data.end));
    }
  });


  on(socket, 'drawClick', (data) => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    const roomStrokes = strokes.get(roomID);
    // Only allow drawing if this is the artist.
    if (socketIDtoSessionID.get(socket.id) === roomData.get(roomID).artist) {
      const id = roomStrokes.push(data) - 1;
      roomStrokes[id].id = id;

      console.log(id, roomStrokes[id]);

      socket.emit('drawReceived', { id, data });
      socket.broadcast.to(roomID).emit('draw', roomStrokes[id]);
    }
  });

  on(socket, 'clear', () => {
    const roomID = getSession(socket.id).room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
    if (socketIDtoSessionID.get(socket.id) === roomData.get(roomID).artist) {
      clearRoom(roomID);
    }
  });

  on(socket, 'message', (data) => {
    const session = getSession(socket.id);
    const roomID = session.room;
    if (!roomID) return; // very basic gaurd. A bit simple and repetitive.

    // Prevent the artist from sending messages.
    if (socketIDtoSessionID.get(socket.id) !== roomData.get(roomID).artist) {
      const roomMessages = messages.get(roomID);
      const id = roomMessages.length;

      console.log(id, roomMessages[id]);
      const room = roomData.get(roomID);

      if (data === room.word) { // is the guess correct, if so:
        if (room.playersToFinish.includes(session.id)) {
          // Update their score
          let score = room.scores.get(session.id);
          const miliscore = lengthOfRound - (Date.now() - room.startTime);
          score += Math.round(miliscore / 1000);
          room.scores.set(session.id, score);
          // Remove the player from list of those to finish
          const index = room.playersToFinish.indexOf(session.id);
          room.playersToFinish.splice(index, 1);
          if (room.playersToFinish.length === 0) {
            endRound(roomID);
          }
        }
      } else {
        // Publish the message
        roomMessages.push({
          id,
          sessionID: session.id,
          data,
        });
        io.to(roomID).emit('message', roomMessages[id]);
      }
    }
  });

  on(socket, 'sessionID', (id) => {
    console.log(`Connection from client with id: ${id}`);
    if (id === null || !sessionIDtoSocketID.has(id)) {
      // Give them a new session ID.
      const sessionID = uuid.v4();
      console.log(`issuing new session id: ${sessionID}`);

      socket.emit('setSessionID', sessionID);

      socketIDtoSessionID.set(socket.id, sessionID);
      sessionIDtoSocketID.set(sessionID, socket.id);
      // Initialise data.
      sessionData.set(sessionID, { accessTime: Date.now(), id: sessionID });
    } else {
      /* Update their session ID.
       * We don't unset the old socket.id => session id, which is a
       * memory leak, but I don't think it will lead to issues
       * (at least logic ones) currently.
       */
      socketIDtoSessionID.set(socket.id, id);
      sessionIDtoSocketID.set(id, socket.id);
    }
  });

  on(socket, 'requestNick', (nick) => {
    // check if nick is unique.
    let unique = true;
    for (const value of sessionData.values()) {
      if (nick === value.nick) {
        unique = false;
        break;
      }
    }

    const sessionID = socketIDtoSessionID.get(socket.id);

    if (unique && sessionID) {
      // Notify them their nick was accepted
      socket.emit('nickStatus', true);

      // We now set their nick.
      sessionData.get(sessionID).nick = nick;

      // Notify everyone that the nick has been set.
      const roomID = getSession(socket.id).room;
      if (!roomID) return; // very basic gaurd. A bit simple and repetitive.
      io.to(roomID).emit('nick', { sessionID, nick });
    } else {
      // Notify them that their nick was not allowed.
      socket.emit('nickStatus', false);
    }
  });

  on(socket, 'joinRoom', (roomID) => {
    const session = getSession(socket.id);
    // This should keep the socket in it's default room but remove the
    // one it's been added to.
    for (const otherRoomID of Object.keys(socket.rooms)) {
      if (otherRoomID !== socket.id) {
        socket.leave(otherRoomID);
        leaveRoom(session.id, otherRoomID);
      }
    }
    socket.join(roomID);

    session.room = roomID;

    // if the room doesn't exist, initialise it.
    if (!roomData.has(roomID)) {
      console.log(`Initialising room: ${roomID}`);
      initialiseRoom(roomID);
    }
    const room = roomData.get(roomID);
    room.playerList.push(session.id);
    room.scores.set(session.id, 0);

    if (room.playerList.length > 1 && room.started === false) {
      startRound(roomID);
    }

    console.log(`Client joined room: ${roomID}`);
    socket.emit('joinedRoom');

    // We emit this message to notify people in the room of our nick
    io.to(roomID).emit('nick', { sessionID: session.id, nick: session.nick });
  });

  on(socket, 'leaveRoom', () => {
    const session = getSession(socket.id);
    const roomID = session.room;
    if (roomID) {
      socket.leave(roomID);
      leaveRoom(session.id, roomID);
    }
  });
});

http.listen(4000, () => {
  console.log('listening on *:4000');
});
