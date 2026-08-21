async function handleSubmit(requirement: string) {
  const response = await fetch("/api/generate", {
    method: "POST",
    body: JSON.stringify({ requirement }),
  });
  return response.json();
}

export default function CreatePage() {
  return <button onClick={() => handleSubmit("A launch video")}>Generate</button>;
}
