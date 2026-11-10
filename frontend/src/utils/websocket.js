export function connectToRoom(roomId, playerId, onMessage, onOpen, onError) {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const websocketUrl = apiUrl.replace(/^http/, "ws");
  const socket = new WebSocket(`${websocketUrl}/ws/${roomId}/${playerId}`);
  socket.addEventListener("open", onOpen);
  socket.addEventListener("message", (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch (error) {
      console.error("Could not read the game update.", error);
    }
  });
  socket.addEventListener("error", onError);
  return socket;
}
