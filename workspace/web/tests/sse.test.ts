import { describe, expect, it } from 'vitest';
import { createSseParser, parseEventData, parseSseTranscript } from '@/lib/sse';
import { createEventDeduper } from '@/lib/event-stream';

describe('SSE parser', () => {
  it('parses a framed event with id, type and data', () => {
    const frames = parseSseTranscript('id: evt-1\nevent: run.completed\ndata: {"a":1}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 'evt-1', event: 'run.completed', data: '{"a":1}' });
  });

  it('joins multi-line data with newlines, as the wire format requires', () => {
    const frames = parseSseTranscript('data: line one\ndata: line two\n\n');
    expect(frames[0]?.data).toBe('line one\nline two');
  });

  it('strips exactly one leading space after the colon', () => {
    const frames = parseSseTranscript('data:  two spaces\n\n');
    expect(frames[0]?.data).toBe(' two spaces');
  });

  it('ignores comment heartbeat frames but still reports them', () => {
    const frames = parseSseTranscript(': heartbeat 2026-08-01T10:00:00Z\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.comment).toBe(true);
    expect(frames[0]?.data).toBe('');
  });

  it('handles CRLF line endings and a missing trailing blank line', () => {
    const frames = parseSseTranscript('event: a\r\ndata: 1\r\n\r\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ event: 'a', data: '1' });
  });

  it('keeps a frame with no event field as the default message type', () => {
    const frames = parseSseTranscript('data: hello\n\n');
    expect(frames[0]?.event).toBe('message');
  });

  it('ignores unknown fields rather than failing the frame', () => {
    const frames = parseSseTranscript('foo: bar\ndata: kept\n\n');
    expect(frames[0]?.data).toBe('kept');
  });

  it('tracks retry only when it is a number', () => {
    expect(parseSseTranscript('retry: 2500\ndata: x\n\n')[0]?.retry).toBe(2500);
    expect(parseSseTranscript('retry: soon\ndata: x\n\n')[0]?.retry).toBeUndefined();
  });

  it('reassembles a frame split across chunks', () => {
    const parser = createSseParser();
    expect(parser.push('id: e1\nevent: run.')).toEqual([]);
    const frames = parser.push('started\ndata: {"seq":1}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 'e1', event: 'run.started', data: '{"seq":1}' });
  });

  it('flushes a trailing frame that was never terminated by a blank line', () => {
    const parser = createSseParser();
    parser.push('data: trailing');
    const frames = parser.flush();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('trailing');
  });

  it('produces no frame for an empty dispatch', () => {
    expect(parseSseTranscript('\n\n\n')).toHaveLength(0);
  });

  it('does not lose the id of an ignored frame', () => {
    const frames = parseSseTranscript('id: keep-me\n: comment only\n\nid: next\ndata: v\n\n');
    // The comment frame consumes the id; the following frame reports its own.
    expect(frames[1]?.id).toBe('next');
  });
});

describe('parseEventData', () => {
  it('parses the JSON payload of a durable event', () => {
    const payload = parseEventData({
      id: 'e1',
      event: 'run.started',
      data: JSON.stringify({ id: 'e1', runId: 'r1', sequence: 3, eventType: 'run.started', version: 1, payload: {}, createdAt: 'now' }),
    });
    expect(payload).toMatchObject({ id: 'e1', sequence: 3 });
  });

  it('returns null instead of throwing on malformed data', () => {
    expect(parseEventData({ id: null, event: 'message', data: '{not json' })).toBeNull();
    expect(parseEventData({ id: null, event: 'message', data: '' })).toBeNull();
  });
});

describe('event de-duplication', () => {
  it('accepts an event once and rejects its replay', () => {
    const deduper = createEventDeduper();
    expect(deduper.accept('evt-1')).toBe(true);
    expect(deduper.accept('evt-1')).toBe(false);
    expect(deduper.accept('evt-2')).toBe(true);
    expect(deduper.size()).toBe(2);
  });

  it('accepts an event with no id, because it cannot be identified twice', () => {
    const deduper = createEventDeduper();
    expect(deduper.accept(null)).toBe(true);
    expect(deduper.accept(null)).toBe(true);
    expect(deduper.size()).toBe(0);
  });

  it('bounds memory while still rejecting recent replays', () => {
    const deduper = createEventDeduper(3);
    for (const id of ['a', 'b', 'c', 'd']) expect(deduper.accept(id)).toBe(true);
    expect(deduper.size()).toBe(3);
    // The oldest id was evicted, but everything within the window is still caught.
    expect(deduper.accept('d')).toBe(false);
    expect(deduper.accept('a')).toBe(true);
  });
});
