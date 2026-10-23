const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function createApi(app) {
  const key = `nena_token_${app}`;
  let token = store.get(key);

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('اتصال به اینترنت برقرار نیست');
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && token) {
      setToken(null);
      location.reload();
    }
    if (!res.ok) {
      const err = new Error(data.error || 'خطا در ارتباط با سرور');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function setToken(t) {
    token = t;
    store.set(key, t);
  }

  return {
    app,
    get token() { return token; },
    setToken,
    get: (p) => request('GET', p),
    post: (p, b = {}) => request('POST', p, b),
    put: (p, b = {}) => request('PUT', p, b),
    patch: (p, b = {}) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    // The server skips push notifications while this app is visible on screen.
    connect: () => {
      const visible = () => document.visibilityState === 'visible';
      const socket = window.io({ auth: { token, app, visible: visible() }, transports: ['websocket', 'polling'] });
      document.addEventListener('visibilitychange', () => socket.emit('visibility', visible()));
      socket.on('connect', () => socket.emit('visibility', visible()));
      return socket;
    },
    store,
  };
}
