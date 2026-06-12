import { ChatMessage, trimHistory } from '../agent.service';

function msg(role: 'user' | 'assistant', i: number): ChatMessage {
  return { role, content: `${role}-${i}` };
}

describe('trimHistory', () => {
  it('returns short histories unchanged', () => {
    const history = [msg('user', 1), msg('assistant', 1), msg('user', 2)];
    expect(trimHistory(history, 8)).toBe(history);
  });

  it('keeps only the most recent N messages', () => {
    const history: ChatMessage[] = [];
    for (let i = 1; i <= 6; i++) {
      history.push(msg('user', i), msg('assistant', i));
    }
    history.push(msg('user', 7));
    const out = trimHistory(history, 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual(msg('user', 5));
    expect(out[out.length - 1]).toEqual(msg('user', 7));
  });

  it('drops a leading assistant message so the model sees a user-first conversation', () => {
    const history = [
      msg('user', 1),
      msg('assistant', 1),
      msg('user', 2),
      msg('assistant', 2),
      msg('user', 3),
    ];
    const out = trimHistory(history, 4);
    expect(out[0].role).toBe('user');
    expect(out).toHaveLength(3);
  });

  it('treats 0 as "no cap"', () => {
    const history = [msg('user', 1), msg('assistant', 1), msg('user', 2)];
    expect(trimHistory(history, 0)).toBe(history);
  });
});
