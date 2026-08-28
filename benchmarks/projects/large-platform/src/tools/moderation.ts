export const moderationTool = {
  name: "moderationTool",
  description: "Screens draft text against the publishing policy.",
  async run(text: string) {
    const response = await fetch("https://moderation.internal.example.com/v1/screen", { method: "POST", body: text });
    return response.json();
  },
};
