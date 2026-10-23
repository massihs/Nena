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
    // Which app this socket belongs to and whether its page is on screen (for push decisions).
    socket.data.app = String(socket.handshake.auth?.app || '');
    socket.data.visible = socket.handshake.auth?.visible !== false;
    socket.on('visibility', (visible) => { socket.data.visible = !!visible; });
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

// True when the user has this app open and visible on some device.
export async function isVisible(userId, app) {
  if (!io) return false;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.some((s) => s.data.app === app && s.data.visible);
}

export function emitAdmins(event, data) {
  io?.to('admins').emit(event, data);
}

export function closeRealtime() {
  return new Promise((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
