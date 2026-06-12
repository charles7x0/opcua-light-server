# Product Overview

OPC UA Light Server is a lightweight OPC UA server system with three main components:

1. **Node.js/Express Control API** — REST API for managing the OPC UA address space, server lifecycle, security, and S7 PLC connections
2. **open62541 C Runtime** — The actual OPC UA server process, spawned and managed by the Control API
3. **React Web UI** — Browser-based dashboard for administration

The C runtime runs as a separate OS process for crash isolation. Communication between the API and runtime uses a JSON configuration file and stdin IPC for real-time value updates. SQLite provides persistence with zero external infrastructure.

## Key Capabilities

- CRUD for namespaces, object nodes, and OPC UA nodes
- Server lifecycle management (start/stop/hot-reload with automatic config regeneration)
- Security configuration (None / Sign / SignAndEncrypt)
- Self-signed certificate generation with SAN support (DNS names, IP addresses)
- Certificate export (DER/PEM download via API and Web UI)
- Certificate health monitoring (remaining days indicator in status bar)
- Server-side file browser for certificate/key path selection
- Siemens S7 PLC integration with automatic polling, reconnection, and value piping to runtime
- API key or JWT authentication on mutating endpoints
- Real-time dashboard with server status, uptime, client count, and system logs
- Auto-reload: address space mutations trigger runtime config regeneration and hot-reload

## Supported OPC UA Data Types

Boolean, Int16, Int32, Int64, UInt16, UInt32, UInt64, Float, Double, String, DateTime, ByteString

## Architecture Notes

- The Control API always uses plain HTTP. The OPC UA security mode (None/Sign/SignAndEncrypt) applies to OPC UA client connections via the runtime, not to the REST API transport.
- S7 value updates flow: S7 Connector → stdin IPC → C runtime (real-time node value updates)
- The runtime writes `status.json` for connected client count reporting.
