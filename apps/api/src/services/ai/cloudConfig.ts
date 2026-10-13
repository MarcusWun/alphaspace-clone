export function isCloudConfigured(): boolean {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) return false;
  if (key.length < 20) return false;
  if (key.startsWith("your_") || key === "your_anthropic_api_key_here") return false;
  return true;
}
