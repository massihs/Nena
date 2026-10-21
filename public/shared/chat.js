import { h, mount, modal, icon, toastError } from './ui.js';
import { jTime } from './fa.js';

// In-ride chat between rider and driver.
export function openChat({ api, socket, ride, myId, otherLabel, quickReplies }) {
  const log = h('div', { class: 'chat-log' });
  const input = h('input', { class: 'input grow', placeholder: 'پیام بنویسید...', maxlength: 500 });
  const seen = new Set();

  const add = (m) => {
    if (m.ride_id !== ride.id || seen.has(m.id)) return;
    seen.add(m.id);
    log.append(h('div', { class: `msg ${m.sender_id === myId ? 'mine' : ''}` }, m.text, h('time', {}, jTime(m.created_at))));
    log.scrollTop = log.scrollHeight;
  };
  const send = async (text) => {
    text = text.trim();
    if (!text) return;
    input.value = '';
    try { add((await api.post(`/rides/${ride.id}/messages`, { text })).message); } catch (err) { toastError(err); }
  };

  const m = modal((close) => h('div', { class: 'chat' },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, `گفتگو با ${otherLabel}`), h('button', { class: 'btn btn-icon flat', onclick: close, 'aria-label': 'بستن' }, icon('close'))),
    h('p', { class: 'tiny muted' }, 'برای حفظ امنیت، اطلاعات مالی خود را در گفتگو ارسال نکنید.'),
    log,
    h('div', { class: 'quick-replies' }, quickReplies.map((q) => h('button', { class: 'chip', onclick: () => send(q) }, q))),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); send(input.value); } },
      input, h('button', { class: 'btn btn-primary btn-icon', style: { boxShadow: 'none' }, 'aria-label': 'ارسال' }, icon('send')))));

  socket.on('chat:message', add);
  m.onClose = () => socket.off('chat:message', add);
  api.get(`/rides/${ride.id}/messages`).then(({ messages }) => { mount(log); messages.forEach(add); }).catch(toastError);
  setTimeout(() => input.focus(), 100);
  return m;
}
