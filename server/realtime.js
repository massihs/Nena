import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { db } from './db.js';
import { updateDriverLocation } from './services/drivers.js';

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, { serveClient: true });

  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    if (user.is_admin && socket.handshake.auth?.app === 'admin') socket.join('admins');

    // Drivers stream their GPS position over the socket.
    socket.on('driver:location', (pos) => {
      const isDriver = db.prepare("SELECT 1 FROM drivers WHERE user_id = ? AND status = 'approved'").get(user.id);
      if (isDriver) updateDriverLocation(user.id, pos || {});
    });
  });
  return io;
}

export function emitTo(userId, event, data) {
  io?.to(`user:${userId}`).emit(event, data);
}

export function emitAdmins(event, data) {
  io?.to('admins').emit(event, data);
}

export function closeRealtime() {
  return new Promise((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
