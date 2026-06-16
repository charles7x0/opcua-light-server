# Stress Tests

Manual stress tests for the OPC UA Light Server. These test server stability under heavy load.

## Prerequisites

1. Control API running: `npm run dev`
2. Set security to None (requires restart):
   ```bash
   curl -X PUT http://localhost:3100/api/security/policy -H "Content-Type: application/json" -d "{\"mode\": \"None\"}"
   curl -X POST http://localhost:3100/api/server/stop
   curl -X POST http://localhost:3100/api/server/start
   ```
3. Runtime started with None security (verify no Sign/SignAndEncrypt only endpoints)

## Available Tests

### Concurrent Clients

Spawns N OPC UA clients simultaneously, each performing continuous reads.

```bash
npm run stress:clients               # 10 clients, 30s
npm run stress:clients -- 50 60      # 50 clients, 60s
```

### Many Variables

Creates N nodes via API, reloads the runtime, then stress-tests read/write.

```bash
npm run stress:variables             # 100 vars, 5 clients, 30s
npm run stress:variables -- 500 10 60  # 500 vars, 10 clients, 60s
```

### Connection Churn

Rapidly connect/disconnect to stress session lifecycle and cleanup.

```bash
npm run stress:churn                 # 50 connections, 10 concurrent, 500ms hold
npm run stress:churn -- 200 20 200   # 200 connections, 20 concurrent, 200ms hold
```

### Combined (Full Load)

Everything at once: many nodes, many clients, API polling, connection churn.

```bash
npm run stress:combined              # 20 clients, 200 vars, 60s
npm run stress:combined -- 50 500 120  # 50 clients, 500 vars, 2min
```

## What Gets Tested

| Scenario | What It Stresses |
|----------|-----------------|
| Many clients | Session management, memory, file descriptor limits |
| Many variables | Address space size, browse performance, reload speed |
| Connection churn | Session create/destroy race conditions, cleanup |
| API under load | Express concurrency while OPC UA is busy |
| Dashboard polling | /api/server/clients under load |

## Interpreting Results

- **Read latency >100ms**: Server struggling under load
- **Connection failures**: Hit OS or open62541 session limits
- **API errors**: Control API thread blocked or crashed
- **Sessions not cleaned up**: open62541 session timeout not firing

## Tips

- Start with small numbers and increase gradually
- Monitor RAM usage of the runtime process during tests
- On Windows, the default socket limit may cap around 50-100 concurrent connections
- Set security to None for stress testing (avoids TLS handshake overhead)
