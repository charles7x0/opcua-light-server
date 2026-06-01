/**
 * Type declarations for the nodes7 library.
 * nodes7 is a pure JavaScript S7 protocol implementation without TypeScript types.
 */
declare module 'nodes7' {
  interface NodeS7Options {
    silent?: boolean;
    debug?: boolean;
  }

  interface ConnectionParams {
    host: string;
    port?: number;
    rack?: number;
    slot?: number;
    timeout?: number;
    localTSAP?: number;
    remoteTSAP?: number;
    connection_name?: string;
    doNotOptimize?: boolean;
  }

  type ConnectCallback = (err: any) => void;
  type ReadCallback = (err: any, values: Record<string, any>) => void;
  type WriteCallback = (err: any) => void;
  type DropCallback = () => void;
  type TranslationCallback = (tag: string) => string;

  class NodeS7 {
    constructor(opts?: NodeS7Options);

    /** Initiate a connection to the PLC. */
    initiateConnection(params: ConnectionParams, callback: ConnectCallback): void;

    /** Drop the connection to the PLC. */
    dropConnection(callback: DropCallback): void;

    /** Set a translation callback for tag names to S7 addresses. */
    setTranslationCB(cb: TranslationCallback): void;

    /** Add items (PLC addresses) to the polling list. */
    addItems(items: string | string[]): void;

    /** Remove items from the polling list. Pass undefined to remove all. */
    removeItems(items?: string | string[]): void;

    /** Read all items currently in the polling list. */
    readAllItems(callback: ReadCallback): void;

    /** Write values to PLC addresses. */
    writeItems(items: string | string[], values: any | any[], callback: WriteCallback): void;
  }

  export = NodeS7;
}
