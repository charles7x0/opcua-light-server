# Product Overview

OPC UA Light Server is a lightweight OPC UA server system with three main components:

1. **Node.js/Express Control API** — REST API for managing the OPC UA address space, server lifecycle, security, and S7 PLC connections
2. **open62541 C Runtime** — The actual OPC UA server process, spawned and managed by the Control API
3. **React Web UI** — Browser-based dashboard for administration

The C runtime runs as a separate OS process for crash isolation. Communication between the API and runtime uses a JSON configuration file. SQLite provides persistence with zero external infrastructure.

## Key Capabilities

- CRUD for namespaces, folders, and OPC UA nodes
- Server lifecycle management (start/stop/hot-reload)
- Security configuration (None / Sign / SignAndEncrypt)
- Siemens S7 PLC integration with automatic polling and reconnection
- API key or JWT authentication on mutating endpoints
- Real-time dashboard with server status, uptime, and client count

## Supported OPC UA Data Types

Boolean, Int16, Int32, Int64, UInt16, UInt32, UInt64, Float, Double, String, DateTime, ByteString
