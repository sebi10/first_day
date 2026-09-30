// Free push notifications with zero backend: ntfy.sh topics. Each friend
// installs the ntfy app (iOS/Android) and subscribes to the island's topic.
// Quiet hours 22:00–08:00: messages are scheduled for 08:00 instead.
export async function ntfy(topic: string | undefined, title: string, message: string) {
  if (!topic) return;
  const headers: Record<string, string> = { Title: title, Tags: 'palm_tree' };
  const now = new Date();
  const h = now.getHours();
  if (h >= 22 || h < 8) {
    const at = new Date(now);
    if (h >= 22) at.setDate(at.getDate() + 1);
    at.setHours(8, 0, 0, 0);
    headers.At = String(Math.floor(at.getTime() / 1000));
  }
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', body: message, headers });
  } catch {
    /* notifications are best-effort */
  }
}
