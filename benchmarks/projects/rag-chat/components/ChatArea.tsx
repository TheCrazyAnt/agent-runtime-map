export default function ChatArea() {
  async function sendMessage(text: string) {
    const response = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: text }], model: "claude-sonnet-5" }),
    });
    return response.json();
  }
  return <button onClick={() => void sendMessage("hi")}>Send</button>;
}
