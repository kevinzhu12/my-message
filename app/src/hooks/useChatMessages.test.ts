import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { mergeIncomingMessages } from "./useChatMessages";

const createMessage = (overrides: Partial<Message>): Message => ({
  id: 1,
  text: "test",
  time: 0,
  is_from_me: false,
  handle: "+123",
  contact_name: null,
  reactions: [],
  attachments: [],
  ...overrides,
});

describe("mergeIncomingMessages", () => {
  it("returns incoming when previous is empty", () => {
    const incoming = [createMessage({ id: 10, time: 100 })];
    const result = mergeIncomingMessages([], incoming);
    expect(result).toEqual(incoming);
  });

  it("returns previous when incoming is empty", () => {
    const prev = [createMessage({ id: 5, time: 50 })];
    const result = mergeIncomingMessages(prev, []);
    expect(result).toEqual(prev);
  });

  it("preserves older loaded messages and drops optimistic ids", () => {
    const prev = [
      createMessage({ id: 1, time: 100 }),
      createMessage({ id: 2, time: 200 }),
      createMessage({ id: 1700000000001, time: 300 }),
    ];
    const incoming = [
      createMessage({ id: 3, time: 250 }),
      createMessage({ id: 4, time: 260 }),
    ];

    const result = mergeIncomingMessages(prev, incoming);

    expect(result).toEqual([
      createMessage({ id: 1, time: 100 }),
      createMessage({ id: 2, time: 200 }),
      createMessage({ id: 3, time: 250 }),
      createMessage({ id: 4, time: 260 }),
    ]);
  });
});
