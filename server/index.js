import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors'; // <-- ADICIONADO
import { rooms, createRoom, deleteRoom, addBroadcaster, removeBroadcaster } from './rooms.js';
import { generateToken, verifyToken } from './tokens.js';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { // <-- ADICIONADO
    origin: ['https://discord.com', 'https://discordapp.com', 'https://discord-screen-production.up.railway.app'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// <-- ADICIONADO: Configuração CORS para requisições HTTP
app.use(cors({
  origin: ['https://discord.com', 'https://discordapp.com', 'https://discord-screen-production.up.railway.app'],
  credentials: true,
}));

app.use(express.json());
app.use(express.static('public'));

// Rota de saúde (healthcheck)
app.get('/', (req, res) => {
  res.send('Servidor funcionando!');
});

// Rota para criar sala (exemplo)
app.post('/api/room', (req, res) => {
  const { name, broadcaster } = req.body;
  const roomId = createRoom(name, broadcaster);
  res.json({ roomId });
});

// Rota para obter informações da sala
app.get('/api/room/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada' });
  res.json(room);
});

// Socket.IO
io.on('connection', (socket) => {
  console.log(`Socket conectado: ${socket.id}`);

  socket.on('join-room', ({ roomId, username }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', 'Sala não existe');
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username;

    // Adiciona o usuário à sala
    if (!room.users) room.users = [];
    room.users.push({ id: socket.id, username });

    // Notifica os outros na sala
    socket.to(roomId).emit('user-joined', { username });
    socket.emit('room-joined', { roomId, users: room.users });

    console.log(`${username} entrou na sala ${roomId}`);
  });

  socket.on('start-stream', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.isStreaming = true;
    addBroadcaster(roomId, socket.id);
    socket.to(roomId).emit('stream-started', { broadcaster: socket.id });
    console.log(`Stream iniciada na sala ${roomId} por ${socket.data.username}`);
  });

  socket.on('stop-stream', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.isStreaming = false;
    removeBroadcaster(roomId, socket.id);
    socket.to(roomId).emit('stream-stopped');
    console.log(`Stream finalizada na sala ${roomId}`);
  });

  socket.on('disconnect', () => {
    const { roomId, username } = socket.data;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.users = room.users.filter(u => u.id !== socket.id);
        if (room.broadcaster === socket.id) {
          room.isStreaming = false;
          removeBroadcaster(roomId, socket.id);
          socket.to(roomId).emit('broadcaster-left');
        }
        socket.to(roomId).emit('user-left', { username });

        // Fecha a sala se estiver vazia após um tempo (AUMENTADO PARA 2 MINUTOS)
        if (room.users.length === 0) {
          setTimeout(() => {
            if (room.users.length === 0 && !room.isStreaming) {
              deleteRoom(roomId);
              console.log(`[room ${roomId}] fechada por inatividade`);
            }
          }, 120000); // <-- ALTERADO de 30000 para 120000 (2 minutos)
        }
      }
    }
    console.log(`Socket desconectado: ${socket.id}`);
  });
});

// Inicia o servidor na porta definida
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Endereço público: ${process.env.PUBLIC_ORIGIN || 'http://localhost:' + PORT}`);
});
