/**
 * Type declarations for the nodepccc library.
 * nodepccc is a pure JavaScript PCCC-over-EtherNet/IP implementation without TypeScript types.
 */
declare module 'nodepccc' {
  interface ConnectionParams {
    host: string;
    port?: number;
    routing?: number[];
  }

  type ConnectCallback = (err: any) => void;
  type ReadCallback = (anythingBad: boolean, values: unknown[]) => void;
  type TranslationCallback = (tag: string) => string;

  interface ItemObject {
    value: unknown;
    quality: 'OK' | 'BAD 255';
  }

  class NodePCCC {
    constructor();

    /** Initiate a connection to the PLC. */
    initiateConnection(params: ConnectionParams, callback: ConnectCallback): void;

    /** Drop the connection to the PLC. */
    dropConnection(): void;

    /** Set a translation callback for tag names to PCCC addresses. */
    setTranslationCB(cb: TranslationCallback): void;

    /** Add items (PCCC file addresses) to the polling list. */
    addItems(items: string | string[]): void;

    /** Remove items from the polling list. */
    removeItems(items: string | string[]): void;

    /** Read all items currently in the polling list. */
    readAllItems(callback: ReadCallback): void;

    /** Find an item's value after reading. */
    findItem(address: string): ItemObject;
  }

  export = NodePCCC;
}
