import { EventEmitter } from 'node:events';

export type LiveEvent =
  | { type: 'message'; conversationId: string; message: unknown }
  | { type: 'typing'; conversationId: string; active: boolean; steps?: string[] }
  | { type: 'conversation'; conversationId: string };

/** Pub/sub em memória: um tópico por conversa (chat do funcionário) e um tópico "console" (todos os analistas). */
export class Broker {
  private readonly em = new EventEmitter().setMaxListeners(0);

  publishConversation(conversationId: string, event: LiveEvent): void {
    this.em.emit(`conv:${conversationId}`, event);
    this.em.emit('console', event);
  }

  subscribeConversation(conversationId: string, fn: (e: LiveEvent) => void): () => void {
    return this.on(`conv:${conversationId}`, fn);
  }

  subscribeConsole(fn: (e: LiveEvent) => void): () => void {
    return this.on('console', fn);
  }

  private on(topic: string, fn: (e: LiveEvent) => void): () => void {
    this.em.on(topic, fn);
    return () => this.em.off(topic, fn);
  }
}
