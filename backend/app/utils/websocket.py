from fastapi import WebSocket
from typing import Dict, List
import json


class ConnectionManager:
    def __init__(self):
        self.active: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room: str = "global"):
        await websocket.accept()
        self.active.setdefault(room, []).append(websocket)

    def disconnect(self, websocket: WebSocket, room: str = "global"):
        self.active.get(room, []).remove(websocket)

    async def broadcast(self, data: dict, room: str = "global"):
        dead = []
        for ws in self.active.get(room, []):
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.get(room, []).remove(ws)

    async def send_event(self, event: str, payload: dict, room: str = "global"):
        await self.broadcast({"event": event, "data": payload}, room)


ws_manager = ConnectionManager()
